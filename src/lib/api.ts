import { NextResponse } from "next/server";
import { ZodError, type z } from "zod";
import { LlmError } from "./llm";
import { AccessError } from "./access";

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

/**
 * Validate a request body against a Zod schema, returning a typed value or a
 * ready-to-return error response.
 */
export async function parseBody<S extends z.ZodTypeAny>(
  request: Request,
  schema: S
): Promise<
  { data: z.output<S>; error: null } | { data: null; error: NextResponse }
> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { data: null, error: jsonError("Request body must be valid JSON.", 400) };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return { data: null, error: jsonError(message, 422) };
  }
  return { data: parsed.data, error: null };
}

/**
 * Stream an async iterable of text chunks as a plain-text HTTP response. If the
 * source throws mid-stream (after headers are sent), an `---ERROR---` marker is
 * appended so the client can surface it.
 */
export function streamTextResponse(source: AsyncIterable<string>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const chunk of source) {
          if (chunk) controller.enqueue(encoder.encode(chunk));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Streaming failed.";
        controller.enqueue(encoder.encode(`\n\n---ERROR---\n${message}`));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

/**
 * Convert thrown errors (LLM, Zod, generic) into a consistent JSON response.
 */
export function handleRouteError(err: unknown): NextResponse {
  if (err instanceof AccessError) {
    return jsonError(err.message, err.status);
  }
  if (err instanceof LlmError) {
    return jsonError(err.message, err.status);
  }
  if (err instanceof ZodError) {
    const message = err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    return jsonError(message, 422);
  }
  if (err instanceof Error) {
    return jsonError(err.message, 500);
  }
  return jsonError("Unexpected server error.", 500);
}
