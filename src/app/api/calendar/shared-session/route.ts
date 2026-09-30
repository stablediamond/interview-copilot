import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { assertAccess } from "@/lib/access";
import { getJobTrackUrl, isJobTrackConfigured } from "@/lib/job-track";
export const runtime = "nodejs";
async function forward(request: Request) {
  try {
    await assertAccess(request);
    const authorization = request.headers.get("authorization");
    if (!isJobTrackConfigured() || !authorization?.match(/^Bearer\s+\S+$/i)) return jsonError("Sign in to Job Track to join a shared session.", 401);
    const eventId = new URL(request.url).searchParams.get("eventId")?.trim();
    if (!eventId || eventId.length > 200) return jsonError("A calendar event is required.", 400);
    const response = await fetch(`${getJobTrackUrl()}/api/event-sessions/${encodeURIComponent(eventId)}`, {
      method: request.method,
      headers: { Authorization: authorization, "Content-Type": "application/json" },
      ...(request.method === "POST" ? { body: await request.text() } : {}),
      cache: "no-store", signal: AbortSignal.timeout(15000),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) return jsonError(data?.message || data?.error || "Shared sessions are unavailable. Deploy the latest Job Track server.", response.status);
    if (!data) return jsonError("Job Track returned an invalid session response.", 502);
    return jsonOk(data);
  } catch (error) { return handleRouteError(error); }
}
export const GET = forward;
export const POST = forward;
