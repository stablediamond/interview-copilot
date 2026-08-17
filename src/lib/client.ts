import { getValidAccessToken } from "./supabase-auth";

export interface ApiSuccess<T> {
  ok: true;
  data: T;
}

export interface ApiFailure {
  ok: false;
  error: string;
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

/**
 * Typed fetch helper for the local JSON API. Throws an Error with the server's
 * message on failure so callers can surface it in a toast.
 */
export async function apiFetch<T>(
  input: string,
  init?: RequestInit
): Promise<T> {
  const token = await getValidAccessToken();
  const res = await fetch(input, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
  });

  let payload: ApiResponse<T> | null = null;
  try {
    payload = (await res.json()) as ApiResponse<T>;
  } catch {
    payload = null;
  }

  if (!res.ok || !payload || payload.ok === false) {
    const message =
      payload && payload.ok === false
        ? payload.error
        : `Request failed with status ${res.status}`;
    throw new Error(message);
  }

  return payload.data;
}

/**
 * Fetch a plain-text streaming endpoint, invoking `onChunk` with the accumulated
 * text as it arrives, and returning the full text when done. Non-OK responses
 * (which carry a JSON error body) are thrown with the server's message.
 */
export async function streamFetch(
  input: string,
  init: RequestInit,
  onChunk: (accumulated: string) => void
): Promise<string> {
  const token = await getValidAccessToken();
  const res = await fetch(input, {
    ...init,
    headers: {
      ...(init.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });

  if (!res.ok || !res.body) {
    let message = `Request failed with status ${res.status}`;
    try {
      const payload = (await res.json()) as ApiResponse<unknown>;
      if (payload && payload.ok === false) message = payload.error;
    } catch {
      // non-JSON error body; keep the status message
    }
    throw new Error(message);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    full += decoder.decode(value, { stream: true });
    onChunk(full);
  }
  full += decoder.decode();
  return full;
}
