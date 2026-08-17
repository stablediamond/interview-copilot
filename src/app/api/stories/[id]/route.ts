import { prisma } from "@/lib/db";
import { handleRouteError, jsonError, jsonOk, parseBody } from "@/lib/api";
import { storyInputSchema } from "@/lib/schemas";
import { serializeStory } from "@/lib/repo";

export const runtime = "nodejs";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { data, error } = await parseBody(request, storyInputSchema);
  if (error) return error;

  try {
    const existing = await prisma.story.findUnique({ where: { id } });
    if (!existing) return jsonError("Story not found.", 404);

    const row = await prisma.story.update({
      where: { id },
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

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const existing = await prisma.story.findUnique({ where: { id } });
    if (!existing) return jsonError("Story not found.", 404);
    await prisma.story.delete({ where: { id } });
    return jsonOk({ id });
  } catch (err) {
    return handleRouteError(err);
  }
}
