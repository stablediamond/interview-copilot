import { prisma } from "@/lib/db";
import { handleRouteError, jsonOk, parseBody } from "@/lib/api";
import { analyzeJobRequestSchema } from "@/lib/schemas";
import { extractJobProfile } from "@/lib/llm-tasks";
import { assertAccess } from "@/lib/access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { data, error } = await parseBody(request, analyzeJobRequestSchema);
  if (error) return error;

  try {
    await assertAccess(request);
    const structured = await extractJobProfile(data.rawJobDescription);

    const profile = await prisma.jobProfile.create({
      data: {
        company: structured.company || "Unknown company",
        roleTitle: structured.role_title || "Role",
        rawJobDescription: data.rawJobDescription,
        structuredJobJson: JSON.stringify(structured),
      },
    });

    return jsonOk({ profile, structured });
  } catch (err) {
    return handleRouteError(err);
  }
}
