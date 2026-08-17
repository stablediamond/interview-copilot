import { z } from "zod";
import { handleRouteError, jsonOk, parseBody } from "@/lib/api";
import { getRuntimeConfig, maskKey, saveAppConfig } from "@/lib/runtime-config";

export const runtime = "nodejs";

const settingsPatchSchema = z.object({
  // null clears the stored key (falls back to env); undefined leaves unchanged.
  openaiApiKey: z.string().nullable().optional(),
  strongModel: z.string().nullable().optional(),
  fastModel: z.string().nullable().optional(),
  transcriptionModel: z.string().nullable().optional(),
  reasoningEffort: z.enum(["fast", "balanced", "thorough"]).nullable().optional(),
});

async function status() {
  const cfg = await getRuntimeConfig();
  return {
    hasKey: Boolean(cfg.openaiApiKey),
    keySource: cfg.openaiKeySource,
    keyMasked: cfg.openaiApiKey ? maskKey(cfg.openaiApiKey) : "",
    strongModel: cfg.strongModel,
    fastModel: cfg.fastModel,
    transcriptionModel: cfg.transcriptionModel,
    reasoningEffort: cfg.reasoningEffort,
  };
}

export async function GET() {
  try {
    return jsonOk(await status());
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: Request) {
  const { data, error } = await parseBody(request, settingsPatchSchema);
  if (error) return error;

  try {
    await saveAppConfig(data);
    return jsonOk(await status());
  } catch (err) {
    return handleRouteError(err);
  }
}
