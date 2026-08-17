import { prisma } from "@/lib/db";
import { handleRouteError, jsonOk, parseBody } from "@/lib/api";
import { analyzeResumeRequestSchema } from "@/lib/schemas";
import { extractCandidateProfile } from "@/lib/llm-tasks";
import { assertAccess } from "@/lib/access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { data, error } = await parseBody(request, analyzeResumeRequestSchema);
  if (error) return error;

  try {
    await assertAccess(request);
    const structured = await extractCandidateProfile(data.rawResumeText);

    const profile = await prisma.candidateProfile.create({
      data: {
        name: structured.name || "Unnamed candidate",
        targetTitle: structured.target_titles[0] || structured.seniority || "",
        rawResumeText: data.rawResumeText,
        structuredProfileJson: JSON.stringify(structured),
      },
    });

    return jsonOk({ profile, structured });
  } catch (err) {
    return handleRouteError(err);
  }
}
