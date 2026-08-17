import { prisma } from "@/lib/db";
import { handleRouteError, jsonOk, parseBody } from "@/lib/api";
import { sessionInputSchema } from "@/lib/schemas";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.interviewSession.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        candidateProfile: { select: { name: true, targetTitle: true } },
        jobProfile: { select: { company: true, roleTitle: true } },
        _count: { select: { turns: true } },
      },
    });

    const sessions = rows.map((s) => ({
      id: s.id,
      title: s.title,
      candidateName: s.candidateProfile?.name ?? null,
      jobCompany: s.jobProfile?.company ?? null,
      jobRole: s.jobProfile?.roleTitle ?? null,
      turnCount: s._count.turns,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    return jsonOk(sessions);
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: Request) {
  const { data, error } = await parseBody(request, sessionInputSchema);
  if (error) return error;

  try {
    const session = await prisma.interviewSession.create({
      data: {
        title: data.title,
        candidateProfileId: data.candidateProfileId || null,
        jobProfileId: data.jobProfileId || null,
      },
    });
    return jsonOk(session);
  } catch (err) {
    return handleRouteError(err);
  }
}
