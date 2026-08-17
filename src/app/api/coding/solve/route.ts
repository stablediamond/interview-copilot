import { handleRouteError, jsonError, parseBody, streamTextResponse } from "@/lib/api";
import { codingSolveRequestSchema } from "@/lib/schemas";
import { streamCodingSolution } from "@/lib/llm-tasks";
import { loadCandidateStructured } from "@/lib/repo";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { assertAccess } from "@/lib/access";

export const runtime = "nodejs";
// Screenshots make request bodies large; allow generous execution time for the
// vision model to read them and stream a full solution.
export const maxDuration = 120;

export async function POST(request: Request) {
  const { data, error } = await parseBody(request, codingSolveRequestSchema);
  if (error) return error;

  try {
    await assertAccess(request);
  } catch (err) {
    return handleRouteError(err);
  }

  const cfg = await getRuntimeConfig();
  if (!cfg.openaiApiKey) {
    return jsonError(
      "OpenAI API key is not configured. Add it on the Settings page.",
      503
    );
  }

  const { candidate } = await loadCandidateStructured(data.candidateProfileId);

  const generator = await streamCodingSolution({
    images: data.images,
    pastedText: data.pastedText,
    transcript: data.transcript,
    language: data.language,
    mode: data.mode,
    priorProblem: data.priorProblem,
    currentCode: data.currentCode,
    candidate,
  });

  return streamTextResponse(generator);
}
