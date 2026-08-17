import {
  SUPABASE_ANON_KEY,
  authBaseUrl,
  isSupabaseConfigured,
} from "./supabase";

// Client-side Supabase Auth via the GoTrue REST API (no SDK dependency). The
// session is persisted in localStorage and refreshed on demand.

const STORAGE_KEY = "interview-coach.supabase.session";

export interface StoredSession {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
  email: string;
}

function readSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function writeSession(session: StoredSession | null) {
  if (typeof window === "undefined") return;
  try {
    if (session) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // ignore quota/availability errors
  }
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user?: { email?: string };
}

function toSession(data: TokenResponse, fallbackEmail: string): StoredSession {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
    email: data.user?.email ?? fallbackEmail,
  };
}

export function getStoredEmail(): string | null {
  return readSession()?.email ?? null;
}

export function hasSession(): boolean {
  return Boolean(readSession());
}

/** Sign in with email + password. Throws with a readable message on failure. */
export async function signIn(email: string, password: string): Promise<void> {
  const res = await fetch(`${authBaseUrl()}/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });

  if (!res.ok) {
    let message = "Sign in failed.";
    try {
      const body = (await res.json()) as {
        error_description?: string;
        msg?: string;
        message?: string;
      };
      message = body.error_description || body.msg || body.message || message;
    } catch {
      // keep default
    }
    throw new Error(message);
  }

  const data = (await res.json()) as TokenResponse;
  writeSession(toSession(data, email));
}

export async function signOut(): Promise<void> {
  const session = readSession();
  writeSession(null);
  if (!session) return;
  try {
    await fetch(`${authBaseUrl()}/logout`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.accessToken}`,
      },
    });
  } catch {
    // best effort; local session is already cleared
  }
}

async function refresh(session: StoredSession): Promise<StoredSession | null> {
  try {
    const res = await fetch(`${authBaseUrl()}/token?grant_type=refresh_token`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: session.refreshToken }),
    });
    if (!res.ok) {
      writeSession(null);
      return null;
    }
    const data = (await res.json()) as TokenResponse;
    const next = toSession(data, session.email);
    writeSession(next);
    return next;
  } catch {
    // network error — keep the stored session so a transient blip doesn't log out
    return session;
  }
}

/**
 * Return a currently-valid access token, refreshing if it's near expiry. Returns
 * null when there's no session or the refresh was rejected (revoked/expired).
 */
export async function getValidAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const session = readSession();
  if (!session) return null;
  if (Date.now() < session.expiresAt - 60_000) return session.accessToken;
  const refreshed = await refresh(session);
  return refreshed?.accessToken ?? null;
}
