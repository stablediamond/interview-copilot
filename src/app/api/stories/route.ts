import { prisma } from "@/lib/db";
import { handleRouteError, jsonOk, parseBody } from "@/lib/api";
import { storyInputSchema } from "@/lib/schemas";
import { serializeStory } from "@/lib/repo";

export const runtime = "nodejs";

export async function GET() {
  try {
    const rows = await prisma.story.findMany({ orderBy: { updatedAt: "desc" } });
    return jsonOk(rows.map(serializeStory));
  } catch (err) {
    return handleRouteError(err);
  }
}

export async function POST(request: Request) {
  const { data, error } = await parseBody(request, storyInputSchema);
  if (error) return error;

  try {
    const row = await prisma.story.create({
      data: {
        title: data.title,
        category: data.category,
        shortVersion: data.shortVersion,
        starVersion: data.starVersion,
        technicalVersion: data.technicalVersion,
        keywordsJson: JSON.stringify(data.keywords),
        evidenceJson: JSON.stringify(data.evidence),
      },
    });
    return jsonOk(serializeStory(row));
  } catch (err) {
    return handleRouteError(err);
  }
}
