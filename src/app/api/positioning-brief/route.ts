import { handleRouteError, jsonError, jsonOk, parseBody } from "@/lib/api";
import { positioningBriefRequestSchema } from "@/lib/schemas";
import { generatePositioningBrief } from "@/lib/llm-tasks";
import {
  loadCandidateStructured,
  loadJobStructured,
  loadPositioningBrief,
  savePositioningBrief,
} from "@/lib/repo";
import { getRuntimeConfig } from "@/lib/runtime-config";
import { assertAccess } from "@/lib/access";

export const runtime = "nodejs";

/** Fetch the cached positioning brief for a (candidate, job) pair, if any. */
export async function GET(request: Request) {
  try {
    await assertAccess(request);
    const { searchParams } = new URL(request.url);
    const candidateProfileId = searchParams.get("candidateProfileId");
    const jobProfileId = searchParams.get("jobProfileId");
    const brief = await loadPositioningBrief(candidateProfileId, jobProfileId);
    return jsonOk({ brief });
  } catch (err) {
    return handleRouteError(err);
  }
}

/** Generate (or regenerate) and cache the positioning brief for the pair. */
export async function POST(request: Request) {
  const { data, error } = await parseBody(request, positioningBriefRequestSchema);
  if (error) return error;

  try {
    await assertAccess(request);

    const cfg = await getRuntimeConfig();
    if (!cfg.openaiApiKey) {
      return jsonError(
        "OpenAI API key is not configured. Add it on the Settings page.",
        503
      );
    }

    const [{ candidate, rawResumeText }, job] = await Promise.all([
      loadCandidateStructured(data.candidateProfileId),
      loadJobStructured(data.jobProfileId),
    ]);

    if (!candidate) {
      return jsonError(
        "Analyze the candidate's resume first (on Setup) before building a positioning brief.",
        422
      );
    }
    if (!job) {
      return jsonError(
        "Analyze the job description first (on Setup) before building a positioning brief.",
        422
      );
    }

    const brief = await generatePositioningBrief({
      candidate,
      rawResumeText,
      job,
    });

    await savePositioningBrief(data.candidateProfileId, data.jobProfileId, brief);

    return jsonOk({ brief });
  } catch (err) {
    return handleRouteError(err);
  }
}
