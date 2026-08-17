import OpenAI from "openai";
import { z } from "zod";
import { getRuntimeConfig, type ReasoningEffortTier } from "./runtime-config";

export class LlmError extends Error {
  status: number;
  constructor(message: string, status = 500) {
    super(message);
    this.name = "LlmError";
    this.status = status;
  }
}

const DEFAULT_TIMEOUT_MS = 30_000;

// Cache the client per API key so changing the key in Settings rebuilds it.
let cached: { key: string; client: OpenAI } | null = null;

/**
 * Build (or reuse) an OpenAI client from the active runtime config. The key may
 * come from the Settings UI (DB) or the environment.
 */
export async function getClient(): Promise<OpenAI> {
  const { openaiApiKey } = await getRuntimeConfig();
  if (!openaiApiKey) {
    throw new LlmError(
      "OpenAI API key is not configured. Add it on the Settings page (or set OPENAI_API_KEY).",
      503
    );
  }
  if (!cached || cached.key !== openaiApiKey) {
    cached = {
      key: openaiApiKey,
      client: new OpenAI({
        apiKey: openaiApiKey,
        timeout: DEFAULT_TIMEOUT_MS,
        maxRetries: 0, // we manage retries ourselves
      }),
    };
  }
  return cached.client;
}

/**
 * Attempt to extract a JSON object from a model response that may contain
 * code fences or stray prose, then repair common issues before parsing.
 */
function extractJson(raw: string): unknown {
  const text = raw.trim();

  // Strip markdown code fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : text;

  const tryParse = (input: string): unknown | undefined => {
    try {
      return JSON.parse(input);
    } catch {
      return undefined;
    }
  };

  const direct = tryParse(candidate);
  if (direct !== undefined) return direct;

  // Fall back to the first {...} or [...] block in the string.
  const firstBrace = candidate.indexOf("{");
  const firstBracket = candidate.indexOf("[");
  let start = -1;
  if (firstBrace === -1) start = firstBracket;
  else if (firstBracket === -1) start = firstBrace;
  else start = Math.min(firstBrace, firstBracket);

  if (start !== -1) {
    const openChar = candidate[start];
    const closeChar = openChar === "{" ? "}" : "]";
    const end = candidate.lastIndexOf(closeChar);
    if (end > start) {
      const slice = candidate.slice(start, end + 1);
      const parsed = tryParse(slice);
      if (parsed !== undefined) return parsed;

      // Light repair: remove trailing commas.
      const repaired = slice.replace(/,\s*([}\]])/g, "$1");
      const reparsed = tryParse(repaired);
      if (reparsed !== undefined) return reparsed;
    }
  }

  throw new LlmError("The model returned a response that was not valid JSON.", 502);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface JsonCallOptions<S extends z.ZodTypeAny> {
  model: string;
  system: string;
  user: string;
  schema: S;
  temperature?: number;
  /** Override the request timeout. Heavy extraction tasks need more than 30s. */
  timeoutMs?: number;
  /** Override the output token cap (e.g. for large structured results). */
  maxOutputTokens?: number;
  /**
   * Override the reasoning-effort tier. Defaults to the "analysis" tier (one
   * step above the live tier) since these JSON calls aren't latency-sensitive.
   */
  reasoningTier?: ReasoningEffortTier;
}

/**
 * Reasoning models (o-series and the gpt-5 family) don't accept a custom
 * `temperature` on the Responses API — passing one returns a 400. The
 * non-reasoning chat variant (gpt-5-chat-*) still does.
 */
function isReasoningModel(model: string): boolean {
  const l = model.toLowerCase();
  if (/^o\d/.test(l)) return true;
  if (/^gpt-5/.test(l) && !l.includes("chat")) return true;
  return false;
}

/**
 * "Pro" reasoning models (gpt-5-pro, gpt-5.5-pro, o1-pro, o3-pro, …) run
 * extended reasoning. They ONLY accept reasoning.effort "high" — "minimal",
 * "low", and "medium" all return a 400 — and they can take minutes to respond,
 * so they need a much larger timeout + output budget than ordinary reasoning
 * models. Getting either wrong looks like "analysis just doesn't work".
 */
function isProModel(model: string): boolean {
  return model.toLowerCase().includes("-pro");
}

type ReasoningEffortValue = NonNullable<
  OpenAI.Responses.ResponseCreateParams["reasoning"]
>["effort"];

// Maps the user's effort tier to a concrete API value, clamped to what the
// model accepts. "Fast" wants the cheapest/quickest: the original gpt-5 line
// (gpt-5, gpt-5-mini, gpt-5-nano) supports "minimal", but versioned variants
// like gpt-5.5 reject it (supported: none/low/medium/high/xhigh) and the
// o-series bottoms out at "low" — so both get "low". Balanced/Thorough use
// medium/high, which every reasoning model accepts. Cast because some SDK
// versions don't yet list "minimal" even though the API accepts it.
// The global reasoning-effort tier is tuned for LIVE answers (latency matters).
// Analysis/prep tasks (resume, JD, stories, brief, review) aren't latency-
// sensitive, so they think one step harder for better quality.
function analysisTier(liveTier: ReasoningEffortTier): ReasoningEffortTier {
  if (liveTier === "fast") return "balanced";
  return "thorough";
}

function reasoningEffort(
  model: string,
  tier: ReasoningEffortTier
): ReasoningEffortValue {
  // Pro models reject everything except "high", so ignore the tier for them.
  if (isProModel(model)) return "high" as ReasoningEffortValue;
  if (tier === "balanced") return "medium" as ReasoningEffortValue;
  if (tier === "thorough") return "high" as ReasoningEffortValue;

  // tier === "fast"
  const l = model.toLowerCase();
  // `gpt-5`, `gpt-5-mini`, etc. match, but `gpt-5.5` (dot after the 5) does not.
  return (/^gpt-5(?:-|$)/.test(l) ? "minimal" : "low") as ReasoningEffortValue;
}

/**
 * Recover from a 400 caused by an unsupported request parameter by adjusting
 * `params` in place and retrying once. Handles the two cases models disagree
 * on: `temperature` (reasoning models reject it) and `reasoning.effort` (pro
 * models only accept "high"; some models reject reasoning entirely). Anything
 * else re-throws so real errors still surface.
 */
async function recoverFromParamError<T>(
  err: unknown,
  params: OpenAI.Responses.ResponseCreateParams,
  retry: () => Promise<T>
): Promise<T> {
  if (!(err instanceof OpenAI.APIError) || err.status !== 400) throw err;
  const msg = err.message;

  if (/temperature/i.test(msg) && params.temperature != null) {
    delete params.temperature;
    return retry();
  }

  if (
    params.reasoning &&
    /(reasoning|effort|minimal|not supported|unsupported value)/i.test(msg)
  ) {
    // Step down: try "high" (accepted by every reasoning model incl. pro),
    // then drop reasoning altogether if even that is rejected.
    if (params.reasoning.effort !== "high") {
      params.reasoning = { effort: "high" as ReasoningEffortValue };
    } else {
      delete params.reasoning;
    }
    return retry();
  }

  throw err;
}

/**
 * Call the OpenAI Responses API and parse + validate a JSON result.
 * Retries once on transient failures, with JSON-repair fallback.
 */
export async function callJson<S extends z.ZodTypeAny>({
  model,
  system,
  user,
  schema,
  temperature = 0.5,
  timeoutMs,
  maxOutputTokens,
  reasoningTier,
}: JsonCallOptions<S>): Promise<z.output<S>> {
  const openai = await getClient();
  const { reasoningEffort: liveTier } = await getRuntimeConfig();
  // Analysis calls think one step harder than the live-tuned tier by default.
  const effortTier = reasoningTier ?? analysisTier(liveTier);

  // The Responses API requires the literal word "json" in the input messages
  // when using a json_object text format. Guarantee it for every call.
  const jsonInput = /json/i.test(user)
    ? user
    : `${user}\n\nReturn the result as a JSON object only.`;

  const reasoning = isReasoningModel(model);
  const pro = isProModel(model);

  const run = async (): Promise<z.output<S>> => {
    const params: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
      model,
      instructions: system,
      input: jsonInput,
      text: { format: { type: "json_object" } },
    };
    if (reasoning) {
      // Reasoning models reject `temperature`; effort comes from the user's tier.
      params.reasoning = { effort: reasoningEffort(model, effortTier) };
      // CRITICAL: reasoning tokens are billed against the output budget. Without
      // a generous cap the model can spend the whole budget "thinking" and
      // return an empty/truncated body — which looks like "GPT-5 doesn't work"
      // for resume/JD/story extraction. Pro models think the hardest, so give
      // them the most room; other reasoning models get an ample default.
      params.max_output_tokens = maxOutputTokens ?? (pro ? 32000 : 16000);
    } else {
      params.temperature = temperature;
      if (maxOutputTokens) params.max_output_tokens = maxOutputTokens;
    }

    // Reasoning models are slower; give them more headroom than the client
    // default. Pro models can take minutes, so they get much longer still.
    // Callers can override for heavy structured tasks.
    const timeout =
      timeoutMs ?? (pro ? 300_000 : reasoning ? 90_000 : DEFAULT_TIMEOUT_MS);
    const requestOptions = { timeout };

    let response;
    try {
      response = await openai.responses.create(params, requestOptions);
    } catch (err) {
      response = await recoverFromParamError(err, params, () =>
        openai.responses.create(params, requestOptions)
      );
    }

    const raw = response.output_text;
    if (!raw || !raw.trim()) {
      // Reasoning models that hit the output cap stop with status "incomplete"
      // and no message text. Surface a clearer, retryable error.
      const incomplete =
        response.status === "incomplete"
          ? ` (stopped early: ${response.incomplete_details?.reason ?? "incomplete"})`
          : "";
      throw new LlmError(`The model returned an empty response${incomplete}.`, 502);
    }

    const json = extractJson(raw);
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new LlmError(
        `The model response did not match the expected format: ${parsed.error.issues
          .map((i) => i.path.join(".") + " " + i.message)
          .join("; ")}`,
        502
      );
    }
    return parsed.data;
  };

  try {
    return await run();
  } catch (err) {
    if (shouldRetry(err)) {
      await delay(600);
      try {
        return await run();
      } catch (retryErr) {
        throw normalizeError(retryErr);
      }
    }
    throw normalizeError(err);
  }
}

interface StreamTextOptions {
  model: string;
  system: string;
  user: string;
  temperature?: number;
  /**
   * Optional image inputs (data URLs or https URLs) for vision tasks like the
   * coding copilot. When present, the user message becomes a text+image content
   * array instead of a plain string.
   */
  images?: string[];
  /** Detail level for image inputs. "high" is needed to read code screenshots. */
  imageDetail?: "auto" | "low" | "high";
  /** Override the reasoning-effort tier (defaults to the live tier from config). */
  reasoningTier?: ReasoningEffortTier;
  /** Override the output-token cap (reasoning models only; others are uncapped). */
  maxOutputTokens?: number;
}

/**
 * Stream a free-text (Markdown) response from the Responses API as an async
 * iterable of text deltas. Used for live interview answers so the candidate sees
 * words appear immediately. Errors are normalized to LlmError.
 */
export async function* streamText({
  model,
  system,
  user,
  temperature = 0.6,
  images,
  imageDetail = "high",
  reasoningTier,
  maxOutputTokens,
}: StreamTextOptions): AsyncGenerator<string> {
  const openai = await getClient();
  const { reasoningEffort: liveTier } = await getRuntimeConfig();
  const effortTier = reasoningTier ?? liveTier;
  const reasoning = isReasoningModel(model);
  const pro = isProModel(model);

  // With images, the Responses API needs a structured content array; otherwise
  // a plain string input is fine (and cheaper to build).
  const input: OpenAI.Responses.ResponseCreateParamsStreaming["input"] =
    images && images.length
      ? [
          {
            role: "user",
            content: [
              { type: "input_text" as const, text: user },
              ...images.map((url) => ({
                type: "input_image" as const,
                image_url: url,
                detail: imageDetail,
              })),
            ],
          },
        ]
      : user;

  const params: OpenAI.Responses.ResponseCreateParamsStreaming = {
    model,
    instructions: system,
    input,
    stream: true,
  };
  if (reasoning) {
    params.reasoning = { effort: reasoningEffort(model, effortTier) };
    // Leave room for reasoning tokens + the answer body so it isn't starved
    // (reasoning tokens count against the output budget). Pro models think much
    // harder, so give them more. Callers can override for longer output (code).
    params.max_output_tokens = maxOutputTokens ?? (pro ? 8000 : 4000);
  } else {
    params.temperature = temperature;
    if (maxOutputTokens) params.max_output_tokens = maxOutputTokens;
  }

  // Reasoning models are slower to first token; pro models slower still. Vision
  // requests (coding screenshots) also need more headroom than the 30s default.
  const requestOptions = pro
    ? { timeout: 300_000 }
    : reasoning
      ? { timeout: 90_000 }
      : images && images.length
        ? { timeout: 90_000 }
        : undefined;

  const open = () => openai.responses.create(params, requestOptions);

  // Open the stream, recovering once from an unsupported-param 400 (temperature
  // / reasoning effort). A transient failure here is retried by the loop below.
  const openStream = async () => {
    try {
      return await open();
    } catch (err) {
      return recoverFromParamError(err, params, open);
    }
  };

  // A dropped connection or transient 429/5xx at the worst possible moment
  // (mid-interview) shouldn't kill the answer. Retry ONCE, but only while no
  // token has been emitted yet — once the candidate is reading streamed text we
  // can't safely restart without duplicating or contradicting what's on screen.
  let attempt = 0;
  while (true) {
    let stream;
    try {
      stream = await openStream();
    } catch (err) {
      if (attempt === 0 && shouldRetry(err)) {
        attempt += 1;
        await delay(500);
        continue;
      }
      throw normalizeError(err);
    }

    let yieldedAny = false;
    try {
      for await (const event of stream) {
        if (event.type === "response.output_text.delta" && event.delta) {
          yieldedAny = true;
          yield event.delta;
        } else if (event.type === "response.failed") {
          throw new LlmError("The model failed while streaming the answer.", 502);
        }
      }
      return;
    } catch (err) {
      if (!yieldedAny && attempt === 0 && shouldRetry(err)) {
        attempt += 1;
        await delay(500);
        continue;
      }
      throw normalizeError(err);
    }
  }
}

function shouldRetry(err: unknown): boolean {
  if (err instanceof LlmError) {
    // Retry on bad-format / empty / gateway issues, not on auth/config errors.
    return err.status === 502;
  }
  if (err instanceof OpenAI.APIError) {
    const status = err.status ?? 0;
    return status === 429 || status >= 500;
  }
  // Network / timeout style errors.
  return true;
}

function normalizeError(err: unknown): LlmError {
  if (err instanceof LlmError) return err;

  if (err instanceof OpenAI.APIError) {
    const status = err.status ?? 500;
    if (status === 401) {
      return new LlmError("OpenAI rejected the API key. Check OPENAI_API_KEY.", 401);
    }
    if (status === 429) {
      return new LlmError(
        "OpenAI rate limit or quota reached. Please try again shortly.",
        429
      );
    }
    return new LlmError(`OpenAI request failed: ${err.message}`, status);
  }

  if (err instanceof Error) {
    if (err.name === "AbortError" || /timeout/i.test(err.message)) {
      return new LlmError("The model request timed out. Please try again.", 504);
    }
    return new LlmError(err.message, 500);
  }

  return new LlmError("Unknown error while calling the language model.", 500);
}
