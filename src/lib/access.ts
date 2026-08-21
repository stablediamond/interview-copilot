/**
 * Server-side access gate backed by Job Track Auth.
 *
 * Protected API routes call `assertAccess(request)`, which checks the caller's
 * bearer token (issued after a Job Track email/password login) against
 * Job Track's /api/auth/me endpoint. Pending, suspended, and revoked accounts
 * are rejected the same way as the Job Track web app.
 *
 * When JOB_TRACK_URL is set to an empty string, the gate is OFF and every
 * request is allowed.
 */
import { getJobTrackUrl, isJobTrackConfigured } from "./job-track";

const CACHE_TTL_MS = 5 * 60 * 1000;

const verifyCache = new Map<string, { ok: boolean; at: number }>();

export class AccessError extends Error {
  readonly status: number;
  constructor(message = "Please sign in to use this app.", status = 401) {
    super(message);
    this.name = "AccessError";
    this.status = status;
  }
}

function extractToken(request?: Request): string | null {
  if (!request) return null;
  const header = request.headers.get("authorization") || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : null;
}

async function verifyToken(token: string): Promise<{ ok: boolean; message?: string; status?: number }> {
  const now = Date.now();
  const cached = verifyCache.get(token);
  if (cached && now - cached.at < CACHE_TTL_MS) {
    return { ok: cached.ok };
  }

  try {
    const res = await fetch(`${getJobTrackUrl()}/api/auth/me`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const ok = res.ok;
    verifyCache.set(token, { ok, at: now });
    if (ok) return { ok: true };

    let message = "Your session is invalid or has been revoked.";
    try {
      const body = (await res.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // keep default
    }
    return { ok: false, message, status: res.status === 403 ? 403 : 401 };
  } catch {
    // Network failure: trust a recent successful verification if we have one, so
    // a brief outage doesn't kick out a signed-in user mid-interview.
    if (cached?.ok) return { ok: true };
    return { ok: false, message: "Could not reach Job Track to verify your session." };
  }
}

/**
 * Throw AccessError if the request isn't from a valid signed-in Job Track user.
 * No-op when Job Track auth isn't configured.
 */
export async function assertAccess(request?: Request): Promise<void> {
  if (!isJobTrackConfigured()) return;

  const token = extractToken(request);
  if (!token) {
    throw new AccessError("Please sign in to use this app.", 401);
  }

  const result = await verifyToken(token);
  if (!result.ok) {
    throw new AccessError(
      result.message || "Your session is invalid or has been revoked.",
      result.status ?? 401,
    );
  }
}
