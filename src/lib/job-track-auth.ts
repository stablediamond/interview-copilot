import { isJobTrackConfigured } from "./job-track";

const STORAGE_KEY = "interview-coach.job-track.session";

export interface StoredSession {
  token: string;
  email: string;
  expiresAt: number;
  firstname?: string;
  lastname?: string;
  privilege?: string;
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

interface LoginSuccess {
  ok: true;
  data: {
    token: string;
    email: string;
    expiresIn: number;
    firstname?: string;
    lastname?: string;
    privilege?: string;
  };
}

interface LoginFailure {
  ok: false;
  error: string;
}

export function getStoredEmail(): string | null {
  return readSession()?.email ?? null;
}

export function hasSession(): boolean {
  return Boolean(readSession());
}

/** Sign in with a Job Track email + password. */
export async function signIn(email: string, password: string): Promise<void> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  let payload: LoginSuccess | LoginFailure | null = null;
  try {
    payload = (await res.json()) as LoginSuccess | LoginFailure;
  } catch {
    payload = null;
  }

  if (!res.ok || !payload || payload.ok === false) {
    const message =
      payload && payload.ok === false
        ? payload.error
        : "Sign in failed. Check your Job Track email and password.";
    throw new Error(message);
  }

  const { token, email: signedEmail, expiresIn, firstname, lastname, privilege } =
    payload.data;
  writeSession({
    token,
    email: signedEmail || email,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
    firstname,
    lastname,
    privilege,
  });
}

export async function signOut(): Promise<void> {
  const session = readSession();
  writeSession(null);
  if (!session) return;
  try {
    await fetch("/api/auth/logout", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` },
    });
  } catch {
    // best effort; local session is already cleared
  }
}

/**
 * Return the stored Job Track bearer token, or null if missing/expired.
 */
export async function getValidAccessToken(): Promise<string | null> {
  if (!isJobTrackConfigured()) return null;
  const session = readSession();
  if (!session) return null;
  if (Date.now() >= session.expiresAt) {
    writeSession(null);
    return null;
  }
  return session.token;
}
