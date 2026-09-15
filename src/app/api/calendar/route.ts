import { handleRouteError, jsonError, jsonOk } from "@/lib/api";
import { assertAccess, AccessError } from "@/lib/access";
import { getJobTrackUrl, isJobTrackConfigured } from "@/lib/job-track";

export const runtime = "nodejs";

type JobTrackCalendarBody = {
  ok?: boolean;
  error?: string;
  message?: string;
  privilege?: string;
  mode?: string;
  applicationBasePath?: string;
  rangeStart?: string;
  rangeEnd?: string;
  events?: unknown;
};

function extractToken(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/**
 * Proxy Job Track's role-scoped calendar so the desktop overlay never talks
 * to Job Track from the renderer. Managers get their team calendar;
 * interviewers get events assigned to them.
 */
export async function GET(request: Request) {
  try {
    await assertAccess(request);
  } catch (err) {
    return handleRouteError(err);
  }

  if (!isJobTrackConfigured()) {
    return jsonError(
      "Job Track is not configured, so the calendar is unavailable.",
      503
    );
  }

  const token = extractToken(request);
  if (!token) {
    return jsonError("Please sign in to use this app.", 401);
  }

  const incoming = new URL(request.url);
  const target = new URL(`${getJobTrackUrl()}/api/calendar/interviewer`);
  const from = incoming.searchParams.get("from");
  const to = incoming.searchParams.get("to");
  if (from) target.searchParams.set("from", from);
  if (to) target.searchParams.set("to", to);

  try {
    const res = await fetch(target, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });

    let parsed: JobTrackCalendarBody | null = null;
    try {
      parsed = (await res.json()) as JobTrackCalendarBody;
    } catch {
      parsed = null;
    }

    if (res.status === 404) {
      return jsonError(
        "Job Track calendar is not available on the server yet. Deploy the latest Job Track app.",
        502
      );
    }

    if (!res.ok || !parsed?.ok) {
      const status =
        res.status === 401 || res.status === 403 ? res.status : 502;
      return jsonError(
        parsed?.message || parsed?.error || "Could not load calendar.",
        status
      );
    }

    const privilege = parsed.privilege ?? "interviewer";
    const mode =
      parsed.mode === "manager" || privilege === "manager"
        ? "manager"
        : "interviewer";

    return jsonOk({
      privilege,
      mode,
      applicationBasePath:
        parsed.applicationBasePath ||
        (mode === "manager"
          ? "/manager/applications"
          : "/interviewer/applications"),
      rangeStart: parsed.rangeStart ?? "",
      rangeEnd: parsed.rangeEnd ?? "",
      events: Array.isArray(parsed.events) ? parsed.events : [],
      jobTrackUrl: getJobTrackUrl(),
    });
  } catch (err) {
    if (err instanceof AccessError) return handleRouteError(err);
    if (err instanceof TypeError) {
      return jsonError(
        "Could not reach Job Track. Check your connection and try again.",
        502
      );
    }
    return handleRouteError(err);
  }
}
