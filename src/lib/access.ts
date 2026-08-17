/**
 * Server-side access gate backed by Supabase Auth.
 *
 * Protected API routes call `assertAccess(request)`, which checks the caller's
 * bearer token (issued by Supabase when the user signed in) against Supabase's
 * /auth/v1/user endpoint. Only users that exist in your project's Authentication
 * → Users can use the app; delete or ban a user to revoke them.
 *
 * When Supabase isn't configured (blank URL/key in src/lib/supabase.ts), the
 * gate is OFF and every request is allowed, so local dev isn't blocked.
 *
 * Only public values are used here (anon key). The service_role key is never
 * referenced.
 */
import {
  SUPABASE_ANON_KEY,
  authBaseUrl,
  isSupabaseConfigured,
} from "./supabase";

// Cache token verifications briefly to avoid a Supabase round-trip per request.
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

async function verifyToken(token: string): Promise<boolean> {
  const now = Date.now();
  const cached = verifyCache.get(token);
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.ok;

  try {
    const res = await fetch(`${authBaseUrl()}/user`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    const ok = res.ok;
    verifyCache.set(token, { ok, at: now });
    return ok;
  } catch {
    // Network failure: trust a recent successful verification if we have one, so
    // a brief outage doesn't kick out a signed-in user mid-interview.
    if (cached?.ok) return true;
    return false;
  }
}

/**
 * Throw AccessError if the request isn't from a valid signed-in Supabase user.
 * No-op when Supabase auth isn't configured.
 */
export async function assertAccess(request?: Request): Promise<void> {
  if (!isSupabaseConfigured()) return;

  const token = extractToken(request);
  if (!token) {
    throw new AccessError("Please sign in to use this app.", 401);
  }

  const ok = await verifyToken(token);
  if (!ok) {
    throw new AccessError("Your session is invalid or has been revoked.", 401);
  }
}
