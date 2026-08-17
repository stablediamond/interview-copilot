import { handleRouteError, jsonError, parseBody, streamTextResponse } from "@/lib/api";
import { generateAnswerRequestSchema } from "@/lib/schemas";
import { streamGenerateAnswer } from "@/lib/llm-tasks";
import {
  loadAllStories,
  loadCandidateStructured,
  loadJobStructured,
  loadPositioningBrief,
} from "@/lib/repo";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { assertAccess } from "@/lib/access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { data, error } = await parseBody(request, generateAnswerRequestSchema);
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

  const [{ candidate, rawResumeText }, job, stories, positioning] = await Promise.all([
    loadCandidateStructured(data.candidateProfileId),
    loadJobStructured(data.jobProfileId),
    loadAllStories(),
    loadPositioningBrief(data.candidateProfileId, data.jobProfileId),
  ]);

  const generator = await streamGenerateAnswer({
    detectedQuestion: data.detectedQuestion,
    questionType: data.questionType,
    recentTranscript: data.recentTranscript,
    focusHint: data.focusHint,
    candidate,
    job,
    stories,
    positioning,
    answerMode: data.answerMode,
    interviewStage: data.interviewStage,
    answerLanguage: data.answerLanguage,
    maxSentences: data.maxSentences,
    boldKeywords: data.boldKeywords,
    allowInventedDetails: data.allowInventedDetails,
    rawResumeFallback: candidate ? undefined : rawResumeText || undefined,
    priorTurns: data.priorTurns,
  });

  return streamTextResponse(generator);
}
