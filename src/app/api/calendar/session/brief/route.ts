import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { assertAccess } from "@/lib/access";
import { prisma } from "@/lib/db";
import { buildInterviewBriefPrompt } from "@/lib/interview-prompt";
import { looksLikeResumeWriterPrompt } from "@/lib/interview-prompts";
import {
  readBasePrompts,
  readPrecombinedBrief,
} from "@/lib/job-track-session-profiles";

export const runtime = "nodejs";

/**
 * Combine saved base interview prompts + resume + JD for ChatGPT.
 */
export async function GET(request: Request) {
  try {
    await assertAccess(request);

    const params = new URL(request.url).searchParams;
    const candidateProfileId = params.get("candidateProfileId")?.trim() ?? "";
    const jobProfileId = params.get("jobProfileId")?.trim() ?? "";

    if (!candidateProfileId && !jobProfileId) {
      return jsonError(
        "Save resume, JD, and base prompts first, then build the brief.",
        400,
      );
    }

    const [candidate, job] = await Promise.all([
      candidateProfileId
        ? prisma.candidateProfile.findUnique({
            where: { id: candidateProfileId },
          })
        : null,
      jobProfileId
        ? prisma.jobProfile.findUnique({ where: { id: jobProfileId } })
        : null,
    ]);

    if (candidateProfileId && !candidate) {
      return jsonError("Candidate profile was not found.", 404);
    }
    if (jobProfileId && !job) {
      return jsonError("Job profile was not found.", 404);
    }

    try {
      const prompt = buildInterviewBriefPrompt(
        readBasePrompts(candidate?.structuredProfileJson),
        candidate?.rawResumeText ?? "",
        job?.rawJobDescription ?? "",
        job?.roleTitle,
        job?.company,
      );
      return jsonOk({ prompt });
    } catch (err) {
      const fallback = readPrecombinedBrief(candidate?.structuredProfileJson);
      if (fallback.trim() && !looksLikeResumeWriterPrompt(fallback)) {
        return jsonOk({ prompt: fallback });
      }
      if (err instanceof Error) {
        return jsonError(err.message, 400);
      }
      throw err;
    }
  } catch (err) {
    return handleRouteError(err);
  }
}
