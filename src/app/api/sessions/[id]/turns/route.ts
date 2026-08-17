import { prisma } from "@/lib/db";
import { handleRouteError, jsonError, jsonOk, parseBody } from "@/lib/api";
import { turnInputSchema } from "@/lib/schemas";
import { safeJsonParse } from "@/lib/utils";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { data, error } = await parseBody(request, turnInputSchema);
  if (error) return error;

  try {
    const session = await prisma.interviewSession.findUnique({ where: { id } });
    if (!session) return jsonError("Session not found.", 404);

    const turn = await prisma.interviewTurn.create({
      data: {
        sessionId: id,
        rawTranscript: data.rawTranscript,
        detectedQuestion: data.detectedQuestion,
        questionType: data.questionType,
        generatedAnswer: data.generatedAnswer,
        answerMode: data.answerMode,
        interviewStage: data.interviewStage,
        keywordsJson: JSON.stringify(data.keywords),
        confidence: data.confidence,
        riskNote: data.riskNote,
        possibleFollowUp: data.possibleFollowUp,
      },
    });

    // Touch the session so it sorts to the top of history.
    await prisma.interviewSession.update({
      where: { id },
      data: { updatedAt: new Date() },
    });

    return jsonOk({
      id: turn.id,
      rawTranscript: turn.rawTranscript,
      detectedQuestion: turn.detectedQuestion,
      questionType: turn.questionType,
      generatedAnswer: turn.generatedAnswer,
      answerMode: turn.answerMode,
      interviewStage: turn.interviewStage,
      keywords: safeJsonParse<string[]>(turn.keywordsJson, []),
      confidence: turn.confidence,
      riskNote: turn.riskNote,
      possibleFollowUp: turn.possibleFollowUp,
      createdAt: turn.createdAt,
    });
  } catch (err) {
    return handleRouteError(err);
  }
}
