import { prisma } from "@/lib/db";
import { handleRouteError, jsonError, jsonOk, parseBody } from "@/lib/api";
import { improveStoryRequestSchema } from "@/lib/schemas";
import { improveStory } from "@/lib/llm-tasks";
import { serializeStory } from "@/lib/repo";
import { safeJsonParse } from "@/lib/utils";
import { assertAccess } from "@/lib/access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const { data, error } = await parseBody(request, improveStoryRequestSchema);
  if (error) return error;

  try {
    await assertAccess(request);
    const row = await prisma.story.findUnique({ where: { id: data.storyId } });
    if (!row) return jsonError("Story not found.", 404);

    const { stories } = await improveStory({
      title: row.title,
      category: row.category,
      shortVersion: row.shortVersion,
      starVersion: row.starVersion,
      technicalVersion: row.technicalVersion,
      keywords: safeJsonParse<string[]>(row.keywordsJson, []),
      evidence: safeJsonParse<string[]>(row.evidenceJson, []),
    });

    const improved = stories[0];
    if (!improved) {
      return jsonError("The model did not return an improved story.", 502);
    }

    const updated = await prisma.story.update({
      where: { id: row.id },
      data: {
        title: improved.title || row.title,
        // Keep the original category to avoid accidental recategorization.
        category: row.category,
        shortVersion: improved.short_version,
        starVersion: improved.star_version,
        technicalVersion: improved.technical_version,
        keywordsJson: JSON.stringify(improved.keywords),
        evidenceJson: JSON.stringify(improved.evidence),
      },
    });

    return jsonOk(serializeStory(updated));
  } catch (err) {
    return handleRouteError(err);
  }
}
