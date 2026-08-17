import OpenAI from "openai";
import { getClient, LlmError } from "@/lib/llm";
import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import {
  FALLBACK_TRANSCRIPTION_MODEL,
  getRuntimeConfig,
} from "@/lib/runtime-config";
import { assertAccess } from "@/lib/access";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024; // OpenAI audio upload limit

/**
 * Transcribe a short audio segment with OpenAI. The Session page records the
 * meeting/mic in ~5s segments and posts each one here, giving near-live
 * transcription using only an OpenAI key (no Deepgram required).
 */
export async function POST(request: Request) {
  try {
    await assertAccess(request);
    const form = await request.formData();
    const file = form.get("file");

    if (!(file instanceof File)) {
      return jsonError("No audio segment was provided.", 422);
    }
    if (file.size === 0) {
      return jsonOk({ text: "" });
    }
    if (file.size > MAX_BYTES) {
      return jsonError("Audio segment is too large (max 25MB).", 413);
    }

    const client = await getClient();
    const { transcriptionModel } = await getRuntimeConfig();

    const langRaw = form.get("language");
    const language =
      typeof langRaw === "string" && langRaw.trim() && langRaw !== "auto"
        ? langRaw.trim()
        : undefined;

    const buffer = Buffer.from(await file.arrayBuffer());
    const filename = file.name || "segment.webm";

    const text = await transcribeWith(
      client,
      buffer,
      filename,
      transcriptionModel,
      language
    );
    return jsonOk({ text: text.trim() });
  } catch (err) {
    return handleRouteError(err);
  }
}

async function transcribeWith(
  client: OpenAI,
  buffer: Buffer,
  filename: string,
  model: string,
  language?: string
): Promise<string> {
  const run = async (m: string) => {
    const uploadable = await OpenAI.toFile(buffer, filename);
    const result = await client.audio.transcriptions.create({
      file: uploadable,
      model: m,
      response_format: "text",
      ...(language ? { language } : {}),
    });
    // With response_format "text" the SDK returns a string.
    return typeof result === "string" ? result : (result as { text?: string }).text ?? "";
  };

  try {
    return await run(model);
  } catch (err) {
    // If the configured model is unavailable, retry once with whisper-1.
    if (
      model !== FALLBACK_TRANSCRIPTION_MODEL &&
      err instanceof OpenAI.APIError &&
      (err.status === 404 || err.status === 400)
    ) {
      return run(FALLBACK_TRANSCRIPTION_MODEL);
    }
    if (err instanceof OpenAI.APIError) {
      throw new LlmError(`Transcription failed: ${err.message}`, err.status ?? 502);
    }
    throw err;
  }
}
