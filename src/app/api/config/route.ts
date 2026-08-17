import { jsonOk } from "@/lib/api";
import { getRuntimeConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";

/**
 * Reports configuration status WITHOUT exposing any secret values. Used by the
 * Settings and Session pages to decide which features are available.
 */
export async function GET() {
  const cfg = await getRuntimeConfig();
  const deepgramConfigured = Boolean(
    process.env.DEEPGRAM_API_KEY && process.env.DEEPGRAM_API_KEY.trim()
  );

  return jsonOk({
    openaiConfigured: Boolean(cfg.openaiApiKey),
    openaiKeySource: cfg.openaiKeySource,
    deepgramConfigured,
    strongModel: cfg.strongModel,
    fastModel: cfg.fastModel,
    transcriptionModel: cfg.transcriptionModel,
    // OpenAI can transcribe audio too, so live audio is available whenever
    // OpenAI is configured, even without Deepgram.
    transcriptionAvailable: Boolean(cfg.openaiApiKey) || deepgramConfigured,
  });
}
