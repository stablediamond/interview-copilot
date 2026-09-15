import { isJobTrackConfigured } from "./job-track";
import { getElectronAPI } from "./electron";

const STORAGE_KEY = "interview-coach.job-track.session";

export interface StoredSession {
  token: string;
  email: string;
  expiresAt: number;
  firstname?: string;
  lastname?: string;
  privilege?: string;
}

function readLocalSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredSession) : null;
  } catch {
    return null;
  }
}

function writeLocalSession(session: StoredSession | null) {
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

async function loadSession(): Promise<StoredSession | null> {
  const api = getElectronAPI();
  if (api?.jobTrack) {
    try {
      const stored = await api.jobTrack.getSession();
      if (stored && typeof stored.token === "string") {
        writeLocalSession(stored);
        return stored;
      }
    } catch {
      // Fall through to localStorage (browser / older shells).
    }
  }
  return readLocalSession();
}

async function persistSession(session: StoredSession | null) {
  writeLocalSession(session);
  const api = getElectronAPI();
  if (api?.jobTrack) {
    try {
      await api.jobTrack.setSession(session);
    } catch {
      // Disk write is best-effort; localStorage still holds the copy this run.
    }
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
  return readLocalSession()?.email ?? null;
}

export function getStoredPrivilege(): string | null {
  return readLocalSession()?.privilege ?? null;
}

/** Electron stores the session on disk; localStorage can lag behind. */
export async function resolveStoredPrivilege(): Promise<string> {
  const session = await loadSession();
  return (session?.privilege ?? readLocalSession()?.privilege ?? "")
    .trim()
    .toLowerCase();
}

export function hasSession(): boolean {
  return Boolean(readLocalSession());
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
  await persistSession({
    token,
    email: signedEmail || email,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
    firstname,
    lastname,
    privilege,
  });
}

export async function signOut(): Promise<void> {
  const session = (await loadSession()) ?? readLocalSession();
  await persistSession(null);
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
  const session = await loadSession();
  if (!session) return null;
  if (Date.now() >= session.expiresAt) {
    await persistSession(null);
    return null;
  }
  return session.token;
}
