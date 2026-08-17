import { z } from "zod";
import { prisma } from "@/lib/db";
import { handleRouteError, jsonError, jsonOk, parseBody } from "@/lib/api";
import { safeJsonParse } from "@/lib/utils";

export const runtime = "nodejs";

const sessionPatchSchema = z.object({
  title: z.string().min(1).optional(),
  transcript: z.string().optional(),
});

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const session = await prisma.interviewSession.findUnique({
      where: { id },
      include: {
        candidateProfile: { select: { id: true, name: true, targetTitle: true } },
        jobProfile: { select: { id: true, company: true, roleTitle: true } },
        turns: { orderBy: { createdAt: "asc" } },
      },
    });

    if (!session) return jsonError("Session not found.", 404);

    return jsonOk({
      id: session.id,
      title: session.title,
      transcript: session.transcript,
      candidateProfile: session.candidateProfile,
      jobProfile: session.jobProfile,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      turns: session.turns.map((t) => ({
        id: t.id,
        rawTranscript: t.rawTranscript,
        detectedQuestion: t.detectedQuestion,
        questionType: t.questionType,
        generatedAnswer: t.generatedAnswer,
        answerMode: t.answerMode,
        interviewStage: t.interviewStage,
        keywords: safeJsonParse<string[]>(t.keywordsJson, []),
        confidence: t.confidence,
        riskNote: t.riskNote,
        possibleFollowUp: t.possibleFollowUp,
        createdAt: t.createdAt,
      })),
    });
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { data, error } = await parseBody(request, sessionPatchSchema);
  if (error) return error;

  try {
    const existing = await prisma.interviewSession.findUnique({ where: { id } });
    if (!existing) return jsonError("Session not found.", 404);

    const session = await prisma.interviewSession.update({
      where: { id },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.transcript !== undefined ? { transcript: data.transcript } : {}),
      },
    });
    return jsonOk(session);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const existing = await prisma.interviewSession.findUnique({ where: { id } });
    if (!existing) return jsonError("Session not found.", 404);
    await prisma.interviewSession.delete({ where: { id } });
    return jsonOk({ id });
  } catch (err) {
    return handleRouteError(err);
  }
}
