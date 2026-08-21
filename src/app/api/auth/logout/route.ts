import { jsonOk } from "@/lib/api";
import { getJobTrackUrl, isJobTrackConfigured } from "@/lib/job-track";

export const runtime = "nodejs";

function extractToken(request: Request): string | null {
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

/** Best-effort revoke of the Job Track session behind this bearer token. */
export async function POST(request: Request) {
  const token = extractToken(request);
  if (token && isJobTrackConfigured()) {
    try {
      await fetch(`${getJobTrackUrl()}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
    } catch {
      // local session is cleared by the client regardless
    }
  }
  return jsonOk({ signedOut: true });
}
