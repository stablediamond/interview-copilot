import { prisma } from "@/lib/db";
import { handleRouteError, jsonOk } from "@/lib/api";

export const runtime = "nodejs";

export async function GET() {
  try {
    const [candidates, jobs] = await Promise.all([
      prisma.candidateProfile.findMany({
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          name: true,
          targetTitle: true,
          structuredProfileJson: true,
          rawResumeText: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.jobProfile.findMany({
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          company: true,
          roleTitle: true,
          structuredJobJson: true,
          rawJobDescription: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);

    return jsonOk({ candidates, jobs });
  } catch (err) {
    return handleRouteError(err);
  }
}
