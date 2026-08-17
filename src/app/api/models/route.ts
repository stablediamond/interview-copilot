import OpenAI from "openai";
import { z } from "zod";
import { handleRouteError, jsonError, jsonOk, parseBody } from "@/lib/api";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { recommendModels } from "@/lib/models";

export const runtime = "nodejs";

const bodySchema = z.object({
  // Optional: test a not-yet-saved key. Falls back to the stored/env key.
  openaiApiKey: z.string().optional(),
});

/**
 * Lists the chat + transcription models the provided/active key can access, and
 * recommends sensible defaults. Using a POST lets the Settings UI test a key
 * before saving it.
 */
export async function POST(request: Request) {
  const { data, error } = await parseBody(request, bodySchema);
  if (error) return error;

  try {
    const apiKey = data.openaiApiKey?.trim() || (await getRuntimeConfig()).openaiApiKey;
    if (!apiKey) {
      return jsonError("No OpenAI API key provided or configured.", 400);
    }

    const client = new OpenAI({ apiKey, timeout: 20_000, maxRetries: 1 });

    let ids: string[];
    try {
      const list = await client.models.list();
      ids = list.data.map((m) => m.id);
    } catch (err) {
      if (err instanceof OpenAI.APIError && err.status === 401) {
        return jsonError("OpenAI rejected this API key.", 401);
      }
      return jsonError(
        err instanceof Error ? err.message : "Could not list models.",
        502
      );
    }

    return jsonOk(recommendModels(ids));
  } catch (err) {
    return handleRouteError(err);
  }
}
