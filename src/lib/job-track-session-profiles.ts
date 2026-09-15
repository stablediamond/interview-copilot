import { prisma } from "@/lib/db";
import type { CandidateProfileDto, JobProfileDto } from "@/lib/types";

export type SessionMaterials = {
  resumeText: string;
  jobDescription: string;
  basePrompts: string;
  jobRole: string;
  jobCompany: string;
  materialsSaved: boolean;
};

type JobTrackCandidate = {
  id: string;
  name: string;
  targetTitle: string;
  resumeText: string;
  basePrompts: string;
  precombinedBrief?: string;
};

type JobTrackJob = {
  id: string;
  role: string;
  company: string;
  description: string;
  candidateId: string;
};

function serializeCandidate(row: {
  id: string;
  name: string;
  targetTitle: string;
  structuredProfileJson: string;
  rawResumeText: string;
  createdAt: Date;
  updatedAt: Date;
}): CandidateProfileDto {
  return {
    id: row.id,
    name: row.name,
    targetTitle: row.targetTitle,
    structuredProfileJson: row.structuredProfileJson,
    rawResumeText: row.rawResumeText,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeJob(row: {
  id: string;
  company: string;
  roleTitle: string;
  structuredJobJson: string;
  rawJobDescription: string;
  createdAt: Date;
  updatedAt: Date;
}): JobProfileDto {
  return {
    id: row.id,
    company: row.company,
    roleTitle: row.roleTitle,
    structuredJobJson: row.structuredJobJson,
    rawJobDescription: row.rawJobDescription,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStructured(json: string | undefined): Record<string, unknown> {
  if (!json) return {};
  try {
    const parsed = JSON.parse(json) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function materialsWereSaved(json: string | undefined): boolean {
  return parseStructured(json).sessionMaterialsSaved === true;
}

export function readBasePrompts(json: string | undefined): string {
  const value = parseStructured(json).basePrompts;
  return typeof value === "string" ? value : "";
}

export function readPrecombinedBrief(json: string | undefined): string {
  const value = parseStructured(json).precombinedBrief;
  return typeof value === "string" ? value : "";
}

function mergeStructuredJson(
  existingJson: string | undefined,
  extra: Record<string, unknown>,
): string {
  return JSON.stringify({ ...parseStructured(existingJson), ...extra });
}

export function jobProfileLabel(
  role: string | undefined,
  company: string | undefined,
): string {
  const title = role?.trim() ?? "";
  const employer = company?.trim() ?? "";
  if (title && employer) return `${title} @ ${employer}`;
  return title || employer;
}

export function materialsFromLocalProfiles(
  candidate: {
    rawResumeText: string;
    structuredProfileJson: string;
  } | null,
  job: {
    rawJobDescription: string;
    roleTitle: string;
    company: string;
  } | null,
): SessionMaterials {
  return {
    resumeText: candidate?.rawResumeText ?? "",
    jobDescription: job?.rawJobDescription ?? "",
    basePrompts: readBasePrompts(candidate?.structuredProfileJson),
    jobRole: job?.roleTitle ?? "",
    jobCompany: job?.company ?? "",
    materialsSaved: materialsWereSaved(candidate?.structuredProfileJson),
  };
}

export function sessionEventKey(eventId?: string | null): string {
  return eventId?.trim() || "standalone";
}

function eventNeedle(eventId?: string | null): string {
  return `"sessionEventId":"${sessionEventKey(eventId)}"`;
}

async function findCandidateByEvent(eventId?: string | null) {
  return prisma.candidateProfile.findFirst({
    where: { structuredProfileJson: { contains: eventNeedle(eventId) } },
    orderBy: { updatedAt: "desc" },
  });
}

async function findJobByEvent(eventId?: string | null) {
  return prisma.jobProfile.findFirst({
    where: { structuredJobJson: { contains: eventNeedle(eventId) } },
    orderBy: { updatedAt: "desc" },
  });
}

export async function loadSessionMaterialsByEvent(eventId?: string | null) {
  const [candidateRow, jobRow] = await Promise.all([
    findCandidateByEvent(eventId),
    findJobByEvent(eventId),
  ]);
  if (!candidateRow && !jobRow) return null;
  const materials = materialsFromLocalProfiles(candidateRow, jobRow);
  return {
    candidateProfileId: candidateRow?.id ?? "",
    jobProfileId: jobRow?.id ?? "",
    candidateLabel: candidateRow?.name?.trim() || "",
    jobLabel: jobProfileLabel(jobRow?.roleTitle, jobRow?.company),
    resumeText: materials.resumeText,
    jobDescription: materials.jobDescription,
    basePrompts: materials.basePrompts,
    jobRole: materials.jobRole,
    jobCompany: materials.jobCompany,
  };
}

export async function upsertJobTrackSessionProfiles(input: {
  candidate: JobTrackCandidate | null;
  job: JobTrackJob | null;
  eventId?: string;
}): Promise<{
  candidateProfileId: string;
  jobProfileId: string;
  candidate: CandidateProfileDto | null;
  job: JobProfileDto | null;
}> {
  const eventId = input.eventId?.trim() || undefined;
  let candidateRow: Awaited<
    ReturnType<typeof prisma.candidateProfile.create>
  > | null = null;

  if (input.candidate) {
    const needle = `"jobTrackCandidateId":"${input.candidate.id}"`;
    const existing =
      (await prisma.candidateProfile.findFirst({
        where: { structuredProfileJson: { contains: needle } },
      })) ?? (eventId ? await findCandidateByEvent(eventId) : null);
    const saved = materialsWereSaved(existing?.structuredProfileJson);
    const existingResume = existing?.rawResumeText?.trim() ?? "";
    const incomingResume = input.candidate.resumeText.trim();
    const data = {
      name: input.candidate.name,
      targetTitle: input.candidate.targetTitle,
      rawResumeText: incomingResume || existingResume,
      structuredProfileJson: mergeStructuredJson(
        existing?.structuredProfileJson,
        {
          jobTrackCandidateId: input.candidate.id,
          ...(eventId ? { sessionEventId: sessionEventKey(eventId) } : {}),
          ...(saved
            ? {}
            : {
                basePrompts: input.candidate.basePrompts,
                ...(input.candidate.basePrompts
                  ? { precombinedBrief: "" }
                  : input.candidate.precombinedBrief
                    ? { precombinedBrief: input.candidate.precombinedBrief }
                    : {}),
              }),
        },
      ),
    };
    candidateRow = existing
      ? await prisma.candidateProfile.update({
          where: { id: existing.id },
          data,
        })
      : await prisma.candidateProfile.create({ data });
  }

  let jobRow: Awaited<ReturnType<typeof prisma.jobProfile.create>> | null =
    null;

  if (input.job) {
    const existing =
      (await prisma.jobProfile.findFirst({
        where: {
          AND: [
            {
              structuredJobJson: {
                contains: `"jobTrackJobId":"${input.job.id}"`,
              },
            },
            {
              structuredJobJson: {
                contains: `"jobTrackCandidateId":"${input.job.candidateId}"`,
              },
            },
          ],
        },
      })) ?? (eventId ? await findJobByEvent(eventId) : null);
    const saved = materialsWereSaved(existing?.structuredJobJson);
    const data = {
      company: input.job.company || existing?.company || "",
      roleTitle: input.job.role || existing?.roleTitle || "",
      rawJobDescription: saved
        ? (existing?.rawJobDescription ?? input.job.description)
        : input.job.description,
      structuredJobJson: mergeStructuredJson(existing?.structuredJobJson, {
        jobTrackJobId: input.job.id,
        jobTrackCandidateId: input.job.candidateId,
        ...(eventId ? { sessionEventId: sessionEventKey(eventId) } : {}),
      }),
    };
    jobRow = existing
      ? await prisma.jobProfile.update({ where: { id: existing.id }, data })
      : await prisma.jobProfile.create({ data });
  }

  if (!candidateRow && eventId) {
    candidateRow = await findCandidateByEvent(eventId);
  }

  if (!jobRow && candidateRow) {
    const jtCandidateId = parseStructured(candidateRow.structuredProfileJson)
      .jobTrackCandidateId;
    if (typeof jtCandidateId === "string" && jtCandidateId) {
      jobRow = await prisma.jobProfile.findFirst({
        where: {
          structuredJobJson: {
            contains: `"jobTrackCandidateId":"${jtCandidateId}"`,
          },
        },
        orderBy: { updatedAt: "desc" },
      });
    }
  }

  if (!jobRow && eventId) {
    jobRow = await findJobByEvent(eventId);
  }

  return {
    candidateProfileId: candidateRow?.id ?? "",
    jobProfileId: jobRow?.id ?? "",
    candidate: candidateRow ? serializeCandidate(candidateRow) : null,
    job: jobRow ? serializeJob(jobRow) : null,
  };
}

export async function saveSessionMaterials(input: {
  eventId?: string;
  candidateProfileId?: string;
  jobProfileId?: string;
  candidateName?: string;
  jobRole?: string;
  jobCompany?: string;
  resumeText: string;
  jobDescription: string;
  basePrompts: string;
}): Promise<{
  candidateProfileId: string;
  jobProfileId: string;
  candidateLabel: string;
  jobLabel: string;
  materials: SessionMaterials;
}> {
  const eventKey = sessionEventKey(input.eventId);
  const candidateName = input.candidateName?.trim() || "Candidate";
  const jobRole = input.jobRole?.trim() ?? "";
  const jobCompany = input.jobCompany?.trim() ?? "";

  const existingCandidate = input.candidateProfileId
    ? await prisma.candidateProfile.findUnique({
        where: { id: input.candidateProfileId },
      })
    : await findCandidateByEvent(input.eventId);

  if (input.candidateProfileId && !existingCandidate) {
    throw new Error("Candidate profile was not found.");
  }

  const candidateRow = existingCandidate
    ? await prisma.candidateProfile.update({
        where: { id: existingCandidate.id },
        data: {
          rawResumeText: input.resumeText,
          structuredProfileJson: mergeStructuredJson(
            existingCandidate.structuredProfileJson,
            {
              basePrompts: input.basePrompts,
              sessionMaterialsSaved: true,
              sessionEventId: eventKey,
            },
          ),
        },
      })
    : await prisma.candidateProfile.create({
        data: {
          name: candidateName,
          targetTitle: jobRole || "Candidate",
          rawResumeText: input.resumeText,
          structuredProfileJson: JSON.stringify({
            basePrompts: input.basePrompts,
            sessionMaterialsSaved: true,
            sessionEventId: eventKey,
          }),
        },
      });

  const existingJob = input.jobProfileId
    ? await prisma.jobProfile.findUnique({
        where: { id: input.jobProfileId },
      })
    : await findJobByEvent(input.eventId);

  if (input.jobProfileId && !existingJob) {
    throw new Error("Job profile was not found.");
  }

  const jtCandidateId = parseStructured(candidateRow.structuredProfileJson)
    .jobTrackCandidateId;

  const jobRow = existingJob
    ? await prisma.jobProfile.update({
        where: { id: existingJob.id },
        data: {
          rawJobDescription: input.jobDescription,
          ...(jobRole ? { roleTitle: jobRole } : {}),
          ...(jobCompany ? { company: jobCompany } : {}),
          structuredJobJson: mergeStructuredJson(existingJob.structuredJobJson, {
            sessionMaterialsSaved: true,
            sessionEventId: eventKey,
            ...(typeof jtCandidateId === "string" && jtCandidateId
              ? { jobTrackCandidateId: jtCandidateId }
              : {}),
          }),
        },
      })
    : await prisma.jobProfile.create({
        data: {
          company: jobCompany,
          roleTitle: jobRole,
          rawJobDescription: input.jobDescription,
          structuredJobJson: JSON.stringify({
            sessionMaterialsSaved: true,
            sessionEventId: eventKey,
            ...(typeof jtCandidateId === "string" && jtCandidateId
              ? { jobTrackCandidateId: jtCandidateId }
              : {}),
          }),
        },
      });

  const materials = materialsFromLocalProfiles(candidateRow, jobRow);
  return {
    candidateProfileId: candidateRow.id,
    jobProfileId: jobRow.id,
    candidateLabel: candidateRow.name || "",
    jobLabel: jobProfileLabel(jobRow.roleTitle, jobRow.company),
    materials,
  };
}
