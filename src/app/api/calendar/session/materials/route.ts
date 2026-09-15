import { z } from "zod";
import { handleRouteError, jsonError, jsonOk, parseBody } from "@/lib/api";
import { assertAccess } from "@/lib/access";
import {
  loadSessionMaterialsByEvent,
  saveSessionMaterials,
} from "@/lib/job-track-session-profiles";

export const runtime = "nodejs";

const saveMaterialsSchema = z.object({
  eventId: z.string().optional(),
  candidateProfileId: z.string().optional(),
  jobProfileId: z.string().optional(),
  candidateName: z.string().optional(),
  jobRole: z.string().optional(),
  jobCompany: z.string().optional(),
  resumeText: z.string(),
  jobDescription: z.string(),
  basePrompts: z.string(),
});

const emptyMaterials = {
  candidateProfileId: "",
  jobProfileId: "",
  candidateLabel: "",
  jobLabel: "",
  resumeText: "",
  jobDescription: "",
  basePrompts: "",
  jobRole: "",
  jobCompany: "",
};

/** Load saved resume, JD, and base prompts for this event (or the standalone session). */
export async function GET(request: Request) {
  try {
    await assertAccess(request);
    const eventId =
      new URL(request.url).searchParams.get("eventId")?.trim() ?? "";
    const loaded = await loadSessionMaterialsByEvent(eventId);
    return jsonOk(loaded ?? emptyMaterials);
  } catch (err) {
    return handleRouteError(err);
  }
}

/** Persist edited resume, JD, and base prompts. Works without a linked application. */
export async function POST(request: Request) {
  const { data, error } = await parseBody(request, saveMaterialsSchema);
  if (error) return error;

  try {
    await assertAccess(request);
    const saved = await saveSessionMaterials({
      eventId: data.eventId?.trim() || undefined,
      candidateProfileId: data.candidateProfileId?.trim() || undefined,
      jobProfileId: data.jobProfileId?.trim() || undefined,
      candidateName: data.candidateName,
      jobRole: data.jobRole,
      jobCompany: data.jobCompany,
      resumeText: data.resumeText,
      jobDescription: data.jobDescription,
      basePrompts: data.basePrompts,
    });
    return jsonOk({
      candidateProfileId: saved.candidateProfileId,
      jobProfileId: saved.jobProfileId,
      candidateLabel: saved.candidateLabel,
      jobLabel: saved.jobLabel,
      resumeText: saved.materials.resumeText,
      jobDescription: saved.materials.jobDescription,
      basePrompts: saved.materials.basePrompts,
      jobRole: saved.materials.jobRole,
      jobCompany: saved.materials.jobCompany,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("not found")) {
      return jsonError(err.message, 404);
    }
    return handleRouteError(err);
  }
}
