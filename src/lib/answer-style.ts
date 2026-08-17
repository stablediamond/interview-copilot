/**
 * Pure, dependency-free style checks for a generated spoken answer. These mirror
 * the style rules in MASTER_ANSWER_PROMPT (banned corporate filler, short spoken
 * sentences) so we can flag when a live answer slipped past them — without a
 * second, latency-adding LLM pass. Used as a lightweight signal in the UI and in
 * tests; never mutates the answer.
 */

// Kept in sync with the "BANNED filler" list in MASTER_ANSWER_PROMPT. Matched
// case-insensitively on word boundaries so "leverages" / "leveraging" don't
// false-positive on "leverage".
export const BANNED_PHRASES: readonly string[] = [
  "passionate about",
  "synergy",
  "innovative mindset",
  "passionate problem solver",
  "leverage",
  "delve",
  "robust",
  "seamless",
  "in today's fast-paced",
  "i'm a strong believer",
  "excited to",
  "wide range of",
  "plays a key role",
  "plays a pivotal role",
  "at the end of the day",
  "it's all about",
  "spearheaded",
  "instrumental in",
  "aligns perfectly",
  "from a strategic perspective",
  "the key takeaway",
];

export type StyleFindingType = "banned_phrase" | "run_on";

export interface StyleFinding {
  type: StyleFindingType;
  /** The offending phrase (banned_phrase) or the flagged sentence (run_on). */
  detail: string;
}

const DEFAULT_MAX_WORDS_PER_SENTENCE = 32;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Strip a trailing ---META--- block and markdown list/number markers. */
function answerBodyOnly(text: string): string {
  const metaIdx = text.indexOf("---META---");
  const body = metaIdx === -1 ? text : text.slice(0, metaIdx);
  return body
    .split("\n")
    .map((line) => line.replace(/^\s*(?:[-*]\s+|\d+\.\s+)/, ""))
    .join("\n");
}

function countWords(s: string): number {
  const m = s.trim().match(/\S+/g);
  return m ? m.length : 0;
}

/** Split into rough spoken sentences on . ! ? and hard line breaks. */
function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Return every style issue found in an answer. `banned_phrase` findings are
 * high-precision (they should essentially never appear); `run_on` findings are
 * heuristic and better suited to dev/testing than a live badge.
 */
export function lintAnswerStyle(
  text: string,
  opts?: { maxWordsPerSentence?: number }
): StyleFinding[] {
  const body = answerBodyOnly(text);
  const findings: StyleFinding[] = [];

  const lower = body.toLowerCase();
  for (const phrase of BANNED_PHRASES) {
    const re = new RegExp(`\\b${escapeRegExp(phrase.toLowerCase())}\\b`);
    if (re.test(lower)) {
      findings.push({ type: "banned_phrase", detail: phrase });
    }
  }

  const maxWords = opts?.maxWordsPerSentence ?? DEFAULT_MAX_WORDS_PER_SENTENCE;
  for (const sentence of splitSentences(body)) {
    const commaClauses = (sentence.match(/,\s*(which|where|and|but|so)\b/gi) ?? []).length;
    if (countWords(sentence) > maxWords || commaClauses >= 3) {
      findings.push({ type: "run_on", detail: sentence });
    }
  }

  return findings;
}

/** The banned phrases present in an answer (deduped, original casing). */
export function bannedPhrasesIn(text: string): string[] {
  return lintAnswerStyle(text)
    .filter((f) => f.type === "banned_phrase")
    .map((f) => f.detail);
}

/**
 * A short, human note for the UI when a live answer used banned filler, or "".
 * Deliberately only surfaces high-precision banned-phrase hits to avoid noise.
 */
export function styleRiskNote(text: string): string {
  const phrases = bannedPhrasesIn(text);
  if (phrases.length === 0) return "";
  const quoted = phrases.map((p) => `“${p}”`).join(", ");
  return `Filler to avoid: ${quoted}. Rephrase in your own words before saying it.`;
}
