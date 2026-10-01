import { handleRouteError, jsonError } from "@/lib/api";
import { assertAccess } from "@/lib/access";
import { getJobTrackUrl, isJobTrackConfigured } from "@/lib/job-track";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Pass-through of Job Track's Server-Sent Events stream (the bearer token never appears in a URL). */
export async function GET(request: Request) {
  try {
    await assertAccess(request);
    const authorization = request.headers.get("authorization");
    if (!isJobTrackConfigured() || !authorization?.match(/^Bearer\s+\S+$/i)) return jsonError("Sign in to Job Track to join a shared session.", 401);
    const query = new URL(request.url).searchParams;
    const eventId = query.get("eventId")?.trim();
    if (!eventId || eventId.length > 200) return jsonError("A calendar event is required.", 400);
    const upstreamQuery = new URLSearchParams();
    for (const key of ["connectionId", "after", "afterChange"]) upstreamQuery.set(key, query.get(key) ?? "");
    // Time out only the connection attempt; the stream itself is long-lived.
    const controller = new AbortController();
    const connectTimer = setTimeout(() => controller.abort(), 15000);
    const abortUpstream = () => controller.abort();
    request.signal.addEventListener("abort", abortUpstream);
    let upstream: Response;
    try {
      upstream = await fetch(`${getJobTrackUrl()}/api/event-sessions/${encodeURIComponent(eventId)}/stream?${upstreamQuery}`, {
        headers: { Authorization: authorization, Accept: "text/event-stream" }, cache: "no-store", signal: controller.signal,
      });
    } catch (error) {
      request.signal.removeEventListener("abort", abortUpstream);
      throw error;
    } finally { clearTimeout(connectTimer); }
    if (!upstream.ok || !upstream.body) {
      request.signal.removeEventListener("abort", abortUpstream);
      const data = await upstream.json().catch(() => null);
      return jsonError(data?.message || data?.error || "Live updates are unavailable. Deploy the latest Job Track server.", upstream.ok ? 502 : upstream.status);
    }
    return new Response(upstream.body, {
      headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform", "X-Accel-Buffering": "no" },
    });
  } catch (error) { return handleRouteError(error); }
}
