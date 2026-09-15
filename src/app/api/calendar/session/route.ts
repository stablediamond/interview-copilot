import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { AccessError, assertAccess } from "@/lib/access";
import { getJobTrackUrl, isJobTrackConfigured } from "@/lib/job-track";
import {
  jobProfileLabel,
  materialsFromLocalProfiles,
  upsertJobTrackSessionProfiles,
} from "@/lib/job-track-session-profiles";
import {
  formatResumeJsonAsPlainText,
  resumeTextLooksLikeJson,
} from "@/lib/resume-plain-text";

export const runtime = "nodejs";

type JobTrackSessionBody = {
  ok?: boolean;
  error?: string;
  message?: string;
  privilege?: string;
  event?: { id?: string; title?: string };
  candidate?: {
    id?: string;
    name?: string;
    targetTitle?: string;
    resumeText?: string;
    profileText?: string;
  } | null;
  job?: {
    id?: string;
    role?: string;
    company?: string;
    description?: string;
  } | null;
  resumeContentJson?: unknown;
  basePrompts?: string;
  chatgptPrompt?: string | null;
  chatgptPromptError?: string | null;
};

function extractToken(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

function asPlainResume(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    if (resumeTextLooksLikeJson(trimmed)) {
      return formatResumeJsonAsPlainText(trimmed);
    }
    return trimmed;
  }
  return formatResumeJsonAsPlainText(value);
}

async function fetchJobTrackSession(
  token: string,
  eventId: string,
): Promise<{ res: Response; parsed: JobTrackSessionBody | null }> {
  const target = `${getJobTrackUrl()}/api/calendar/events/${encodeURIComponent(eventId)}/session`;
  const res = await fetch(target, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
    cache: "no-store",
  });
  let parsed: JobTrackSessionBody | null = null;
  try {
    parsed = (await res.json()) as JobTrackSessionBody;
  } catch {
    parsed = null;
  }
  return { res, parsed };
}

async function readJsonBody(res: Response): Promise<unknown> {
  try {
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

async function fetchApplicationResumeJson(
  token: string,
  jobId: string,
  candidateId: string,
): Promise<unknown> {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  const encodedJob = encodeURIComponent(jobId);
  const encodedCandidate = encodeURIComponent(candidateId);
  const getUrl = `${getJobTrackUrl()}/api/jobs/${encodedJob}/resume?candidateId=${encodedCandidate}`;
  const getRes = await fetch(getUrl, { headers, cache: "no-store" });
  if (getRes.ok) return readJsonBody(getRes);

  const postRes = await fetch(
    `${getJobTrackUrl()}/api/jobs/${encodedJob}/resume`,
    {
      method: "POST",
      headers: {
        ...headers,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ candidateId }),
      cache: "no-store",
    },
  );
  if (!postRes.ok) return null;
  return readJsonBody(postRes);
}

function jobTrackUnavailable(res: Response, parsed: JobTrackSessionBody | null) {
  if (res.status === 404) {
    return jsonError(
      parsed?.message ||
        "Job Track session context is not available on the server yet. Deploy the latest Job Track app.",
      parsed?.error === "not_found" ? 404 : 502,
    );
  }
  const status = res.status === 401 || res.status === 403 ? res.status : 502;
  return jsonError(
    parsed?.message || parsed?.error || "Could not load this calendar event.",
    status,
  );
}

/**
 * Prefill Interview Copilot from a Job Track calendar event: local candidate
 * and job profiles plus editable resume, JD, and base prompts.
 */
export async function GET(request: Request) {
  try {
    await assertAccess(request);
  } catch (err) {
    return handleRouteError(err);
  }

  if (!isJobTrackConfigured()) {
    return jsonError(
      "Job Track is not configured, so this event cannot start a session.",
      503,
    );
  }

  const token = extractToken(request);
  if (!token) {
    return jsonError("Please sign in to use this app.", 401);
  }

  const eventId = new URL(request.url).searchParams.get("eventId")?.trim() ?? "";
  if (!eventId) {
    return jsonError("Pick a calendar event first.", 400);
  }

  try {
    const { res, parsed } = await fetchJobTrackSession(token, eventId);
    if (!res.ok || !parsed?.ok) {
      return jobTrackUnavailable(res, parsed);
    }

    let resumeText = asPlainResume(parsed.resumeContentJson);
    if (parsed.job?.id && parsed.candidate?.id) {
      const downloaded = asPlainResume(
        await fetchApplicationResumeJson(
          token,
          parsed.job.id,
          parsed.candidate.id,
        ),
      );
      if (downloaded) resumeText = downloaded;
    }
    if (!resumeText) {
      const fromCandidate = parsed.candidate?.resumeText ?? "";
      if (fromCandidate && resumeTextLooksLikeJson(fromCandidate)) {
        resumeText = asPlainResume(fromCandidate);
      }
    }

    const candidate =
      parsed.candidate?.id && parsed.candidate.name
        ? {
            id: parsed.candidate.id,
            name: parsed.candidate.name,
            targetTitle: parsed.candidate.targetTitle || "Candidate",
            resumeText,
            basePrompts: "",
            precombinedBrief: "",
          }
        : null;
    const job =
      parsed.job?.id
        ? {
            id: parsed.job.id,
            role: parsed.job.role || "Role",
            company: parsed.job.company || "Company",
            description: parsed.job.description || "",
            candidateId: parsed.candidate?.id || "unknown",
          }
        : null;

    const profiles = await upsertJobTrackSessionProfiles({
      candidate,
      job,
      eventId,
    });
    const materials = materialsFromLocalProfiles(
      profiles.candidate,
      profiles.job,
    );

    return jsonOk({
      privilege: parsed.privilege ?? "",
      sessionTitle: parsed.event?.title?.trim() || "Untitled interview",
      candidateProfileId: profiles.candidateProfileId,
      jobProfileId: profiles.jobProfileId,
      candidateLabel: candidate?.name?.trim() || "",
      jobLabel: job
        ? jobProfileLabel(job.role, job.company)
        : "",
      jobRole: materials.jobRole,
      jobCompany: materials.jobCompany,
      resumeText: resumeText || materials.resumeText,
      jobDescription: job?.description || materials.jobDescription,
      basePrompts: materials.basePrompts,
      missingCandidate: !candidate,
      missingJob: !job,
    });
  } catch (err) {
    if (err instanceof AccessError) return handleRouteError(err);
    if (err instanceof TypeError) {
      return jsonError(
        "Could not reach Job Track. Check your connection and try again.",
        502,
      );
    }
    return handleRouteError(err);
  }
}
