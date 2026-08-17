import { prisma } from "@/lib/db";
import { handleRouteError, jsonOk } from "@/lib/api";

export const runtime = "nodejs";

/**
 * Deletes ALL local data: turns, sessions, stories, and profiles. Irreversible.
 * Ordered to respect foreign keys (turns cascade with sessions, but we clear
 * explicitly for clarity).
 */
export async function POST() {
  try {
    await prisma.interviewTurn.deleteMany();
    await prisma.interviewSession.deleteMany();
    await prisma.story.deleteMany();
    await prisma.jobProfile.deleteMany();
    await prisma.candidateProfile.deleteMany();
    return jsonOk({ cleared: true });
  } catch (err) {
    return handleRouteError(err);
  }
}
