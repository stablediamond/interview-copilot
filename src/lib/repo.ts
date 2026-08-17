import { prisma } from "./db";
import { safeJsonParse } from "./utils";
import {
  candidateStructuredSchema,
  jobStructuredSchema,
  positioningBriefSchema,
  type CandidateStructured,
  type JobStructured,
  type PositioningBrief,
} from "./schemas";
import type { StoryLike } from "./context";

export async function loadCandidateStructured(
  id: string | null | undefined
): Promise<{ candidate: CandidateStructured | null; rawResumeText: string }> {
  if (!id) return { candidate: null, rawResumeText: "" };
  const row = await prisma.candidateProfile.findUnique({ where: { id } });
  if (!row) return { candidate: null, rawResumeText: "" };
  const parsed = candidateStructuredSchema.safeParse(
    safeJsonParse(row.structuredProfileJson, {})
  );
  return {
    candidate: parsed.success ? parsed.data : null,
    rawResumeText: row.rawResumeText,
  };
}

export async function loadJobStructured(
  id: string | null | undefined
): Promise<JobStructured | null> {
  if (!id) return null;
  const row = await prisma.jobProfile.findUnique({ where: { id } });
  if (!row) return null;
  const parsed = jobStructuredSchema.safeParse(safeJsonParse(row.structuredJobJson, {}));
  return parsed.success ? parsed.data : null;
}

/** Load the cached positioning brief for a (candidate, job) pair, if any. */
export async function loadPositioningBrief(
  candidateProfileId: string | null | undefined,
  jobProfileId: string | null | undefined
): Promise<PositioningBrief | null> {
  if (!candidateProfileId || !jobProfileId) return null;
  const row = await prisma.positioningBrief.findUnique({
    where: {
      candidateProfileId_jobProfileId: { candidateProfileId, jobProfileId },
    },
  });
  if (!row) return null;
  const parsed = positioningBriefSchema.safeParse(safeJsonParse(row.briefJson, {}));
  return parsed.success ? parsed.data : null;
}

/** Create or replace the positioning brief for a (candidate, job) pair. */
export async function savePositioningBrief(
  candidateProfileId: string,
  jobProfileId: string,
  brief: PositioningBrief
): Promise<void> {
  const briefJson = JSON.stringify(brief);
  await prisma.positioningBrief.upsert({
    where: {
      candidateProfileId_jobProfileId: { candidateProfileId, jobProfileId },
    },
    create: { candidateProfileId, jobProfileId, briefJson },
    update: { briefJson },
  });
}

export interface StoryDto {
  id: string;
  title: string;
  category: string;
  shortVersion: string;
  starVersion: string;
  technicalVersion: string;
  keywords: string[];
  evidence: string[];
  createdAt: Date;
  updatedAt: Date;
}

export function serializeStory(row: {
  id: string;
  title: string;
  category: string;
  shortVersion: string;
  starVersion: string;
  technicalVersion: string;
  keywordsJson: string;
  evidenceJson: string;
  createdAt: Date;
  updatedAt: Date;
}): StoryDto {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    shortVersion: row.shortVersion,
    starVersion: row.starVersion,
    technicalVersion: row.technicalVersion,
    keywords: safeJsonParse<string[]>(row.keywordsJson, []),
    evidence: safeJsonParse<string[]>(row.evidenceJson, []),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export async function loadAllStories(): Promise<StoryLike[]> {
  const rows = await prisma.story.findMany({ orderBy: { updatedAt: "desc" } });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    category: r.category,
    shortVersion: r.shortVersion,
    starVersion: r.starVersion,
    technicalVersion: r.technicalVersion,
    keywords: safeJsonParse<string[]>(r.keywordsJson, []),
  }));
}
