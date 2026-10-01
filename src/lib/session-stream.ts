/** Minimal Server-Sent Events reader for the shared session stream. */
export interface SseEvent { event: string; data: string }

/** Incremental SSE parser: feed text chunks, receive complete events (comments are ignored). */
export function createSseParser(onEvent: (event: SseEvent) => void) {
  let buffer = "";
  return (chunk: string) => {
    buffer += chunk;
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      let event = "message";
      const data: string[] = [];
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith(":")) continue;
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
      }
      if (data.length) onEvent({ event, data: data.join("\n") });
    }
  };
}

export interface SessionStreamOptions<T> {
  url: string;
  token: string | null;
  signal: AbortSignal;
  onSnapshot: (snapshot: T) => void;
  onOpen?: () => void;
}

/**
 * Reads one stream connection until it ends. Resolves when the server asks the
 * client to reconnect (bounded stream lifetime); rejects when the connection
 * fails or the server reports an error, so the caller can back off and fall back to polling.
 */
export async function readSessionStream<T>({ url, token, signal, onSnapshot, onOpen }: SessionStreamOptions<T>): Promise<void> {
  const response = await fetch(url, {
    headers: { Accept: "text/event-stream", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    cache: "no-store", signal,
  });
  if (!response.ok || !response.body) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Live updates unavailable (HTTP ${response.status}).`);
  }
  onOpen?.();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let failure: Error | null = null;
  const parse = createSseParser(({ event, data }) => {
    let payload: unknown;
    try { payload = JSON.parse(data); } catch { return; }
    if (event === "snapshot") onSnapshot(payload as T);
    else if (event === "error") failure = new Error((payload as { message?: string })?.message || "Live updates failed.");
  });
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      parse(decoder.decode(value, { stream: true }));
      if (failure) throw failure;
    }
  } finally { void reader.cancel().catch(() => {}); }
  if (failure) throw failure;
}
