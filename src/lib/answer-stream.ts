import { answerMetaSchema, type AnswerMeta } from "./schemas";

// Markers the streaming answer endpoint uses to separate the spoken answer body
// from its trailing metadata, and to report a mid-stream error.
export const META_DELIM = "---META---";
export const ERROR_DELIM = "---ERROR---";

export interface ParsedAnswerStream {
  body: string;
  meta: AnswerMeta | null;
  error: string | null;
}

/**
 * Split a (possibly partial) streamed answer into its visible body, parsed
 * metadata, and any error. Safe to call on every chunk while streaming.
 */
export function parseAnswerStream(full: string): ParsedAnswerStream {
  let text = full;
  let error: string | null = null;

  const errIdx = text.indexOf(ERROR_DELIM);
  if (errIdx !== -1) {
    error = text.slice(errIdx + ERROR_DELIM.length).trim() || "Streaming failed.";
    text = text.slice(0, errIdx);
  }

  let meta: AnswerMeta | null = null;
  const metaIdx = text.indexOf(META_DELIM);
  let body = text;
  if (metaIdx !== -1) {
    body = text.slice(0, metaIdx);
    meta = parseMeta(text.slice(metaIdx + META_DELIM.length));
  } else {
    // Hide a partially-streamed delimiter so it doesn't flash in the UI.
    body = trimPartialDelimiter(body);
  }

  return { body: body.trim(), meta, error };
}

function parseMeta(raw: string): AnswerMeta | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const json = JSON.parse(raw.slice(start, end + 1));
    const parsed = answerMetaSchema.safeParse(json);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function trimPartialDelimiter(s: string): string {
  for (const marker of [META_DELIM, ERROR_DELIM]) {
    for (let k = marker.length - 1; k > 0; k -= 1) {
      if (s.endsWith(marker.slice(0, k))) return s.slice(0, s.length - k);
    }
  }
  return s;
}

/** A short plain-text gist of a Markdown answer, for session memory. */
export function answerGist(markdown: string, max = 200): string {
  return markdown
    .replace(/\*\*/g, "")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
