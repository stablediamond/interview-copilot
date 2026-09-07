/**
 * Turns the rolling, self-revising text stream from Windows Live Captions into
 * a clean sequence of committed "final" fragments plus one "interim" fragment.
 *
 * Live Captions exposes a single rolling window it continuously rewrites: it
 * appends new words at the end, REVISES the last few words as it hears more
 * ("...how do you" -> "...how do you balance shipping"), and scrolls old text
 * off the front. Naively splitting each snapshot into sentences and de-duping by
 * text breaks the moment a word inside a "finished" sentence is revised — the
 * old and new spellings both get committed, which is the duplication users see.
 *
 * This module is pure (no React / DOM) so it can be unit-tested directly.
 */

// CJK ideographs (main block + extension A + compatibility). Chinese/Japanese
// text has no spaces, so we tokenize it per character for alignment.
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

export function isCjkChar(ch: string): boolean {
  return Boolean(ch) && CJK.test(ch);
}

// Split into sentences on both ASCII and full-width CJK terminators, keeping a
// trailing unpunctuated fragment as its own (in-progress) sentence.
export function splitSentences(text: string): string[] {
  const matches = text.match(/[^.!?。！？…]+[.!?。！？…]+|\S[^.!?。！？…]*$/gu);
  return matches ? matches.map((s) => s.trim()).filter(Boolean) : [];
}

// Tokenize for alignment + reconstruction: each CJK character is its own token
// (no spaces between them), while non-CJK text is split into whitespace-
// separated words. Whitespace is dropped here; rebuild text with joinTokens.
export function tokenize(text: string): string[] {
  return text.match(/[\u3400-\u9fff\uf900-\ufaff]|[^\s\u3400-\u9fff\uf900-\ufaff]+/g) ?? [];
}

// Rejoin tokens, inserting a space only between two non-CJK tokens so Chinese
// stays contiguous ("你好") while English keeps its spacing ("how are you").
export function joinTokens(tokens: string[]): string {
  let out = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (i === 0) {
      out = t;
      continue;
    }
    const glue = isCjkChar(tokens[i - 1].slice(-1)) || isCjkChar(t[0]) ? "" : " ";
    out += glue + t;
  }
  return out;
}

// Match key for a token: lowercase, strip punctuation. Unicode-aware so CJK
// characters survive (an [a-z0-9]-only form would normalize them all to "").
export function normWord(w: string): string {
  return w.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

export function sentenceKey(s: string): string {
  return tokenize(s).map(normWord).filter(Boolean).join(" ");
}

/**
 * Strip the leading tokens of `textTokens` that are already covered by the END
 * of the committed tail, comparing on the normalized form so revisions to
 * spacing/punctuation don't defeat it. Returns the remaining (new) tokens.
 *
 * This is the core reconciliation primitive: the most recently committed words
 * reappear at the START of the next snapshot (the window scrolled), so the
 * largest suffix-of-tail that equals a prefix-of-text is the already-seen part.
 * When nothing overlaps we return the whole input rather than guessing an
 * anchor from a single common token — dropping the start of genuinely new
 * speech is worse than a rare duplicate (which later dedup still catches).
 */
export function stripLeadingOverlap(
  tailNorm: readonly string[],
  textTokens: string[]
): string[] {
  if (tailNorm.length === 0 || textTokens.length === 0) return textTokens;
  const textNorm = textTokens.map(normWord);
  const maxOverlap = Math.min(tailNorm.length, textTokens.length);
  for (let o = maxOverlap; o >= 1; o--) {
    let ok = true;
    for (let i = 0; i < o; i++) {
      if (tailNorm[tailNorm.length - o + i] !== textNorm[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return textTokens.slice(o);
  }
  return textTokens;
}

/**
 * Drop every already-heard prefix from a Live Captions snapshot.
 * One overlap pass is not enough: the PowerShell bridge often concatenates a
 * finalized block with a live block that repeats it, so after Clear/Answer the
 * same sentence arrives twice (`phrase phrase and then new words`).
 */
export function remainingAfterConsumed(
  consumedNorm: readonly string[],
  snapTokens: string[],
  containPrefixMin = 8
): string[] {
  if (consumedNorm.length === 0 || snapTokens.length === 0) return snapTokens;
  const consumedKey = consumedNorm.filter(Boolean).join(" ");
  if (!consumedKey) return snapTokens;

  let remaining = snapTokens;
  for (let guard = 0; guard < 8; guard++) {
    const remKey = remaining.map(normWord).filter(Boolean).join(" ");
    if (!remKey || consumedKey.includes(remKey)) return [];
    const next = stripLeadingOverlap(consumedNorm, remaining);
    if (next.length === remaining.length) break;
    remaining = next;
  }

  const remKey = remaining.map(normWord).filter(Boolean).join(" ");
  if (!remKey || consumedKey.includes(remKey)) return [];

  if (containPrefixMin > 0 && containPrefixMin < Infinity) {
    const remNorm = remaining.map(normWord);
    let cut = 0;
    const max = remNorm.length;
    for (let i = max; i >= containPrefixMin; i--) {
      const prefix = remNorm.slice(0, i).filter(Boolean).join(" ");
      if (prefix && consumedKey.includes(prefix)) {
        cut = i;
        break;
      }
    }
    remaining = remaining.slice(cut);
  }

  const leftover = remaining.map(normWord).filter(Boolean).join(" ");
  if (!leftover || consumedKey.includes(leftover)) return [];
  return remaining;
}

// Tokens Live Captions may still revise — kept in the live region, never
// committed until more arrives after them.
const LIVE_MARGIN = 8;
// Once the live region grows past this with no sentence break, commit its
// stable prefix anyway. This is what makes Chinese work: Live Captions often
// emits Chinese with no sentence punctuation, so the sentence-based commit
// would otherwise never fire.
const LIVE_MAX = 24;
const TAIL_MAX = 80;

export class CaptionReconciler {
  // Bounded list of committed tokens, kept only to align the next snapshot.
  #committedTail: string[] = [];
  // Normalized text of every fragment already emitted — a hard dedup backstop.
  #seen = new Set<string>();
  #live = "";
  #lastSnap = "";
  // Full window at the last Clear/Answer — used so the next LC snapshot of the
  // same (or shorter) text is dropped instead of re-pasted into the textarea.
  #consumedNorm: string[] = [];

  reset() {
    this.#committedTail = [];
    this.#seen = new Set();
    this.#live = "";
    this.#lastSnap = "";
    this.#consumedNorm = [];
  }

  /**
   * Treat everything heard so far as already consumed. Later snapshots only
   * emit speech that starts after this point. Pass the textarea text so a
   * Clear/Answer cannot be undone by the next rolling-window snapshot.
   */
  checkpoint(extraText = "") {
    const pieces = [this.#lastSnap, this.#live, extraText]
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const tokens: string[] = [];
    for (const piece of pieces) tokens.push(...tokenize(piece));
    if (this.#committedTail.length) tokens.unshift(...this.#committedTail);

    if (tokens.length > 0) {
      this.#committedTail.push(...tokenize(this.#live), ...tokenize(extraText));
      if (this.#committedTail.length > TAIL_MAX) {
        this.#committedTail = this.#committedTail.slice(-TAIL_MAX);
      }
      const nextConsumed = tokens.map(normWord).filter(Boolean);
      this.#consumedNorm = [...this.#consumedNorm, ...nextConsumed];
      if (this.#consumedNorm.length > 400) {
        this.#consumedNorm = this.#consumedNorm.slice(-400);
      }
      const key = sentenceKey(pieces.join(" "));
      if (key) this.#seen.add(key);
    }
    this.#live = "";
  }

  push(snapshot: string): { finals: string[]; interim: string } {
    const snap = collapseRepeatedText(snapshot.replace(/\s+/g, " ").trim());
    if (!snap) return { finals: [], interim: this.#live };
    this.#lastSnap = snap;

    const finals: string[] = [];
    const snapTokens = tokenize(snap);
    if (this.#isAlreadyConsumed(snapTokens)) {
      this.#live = "";
      return { finals: [], interim: "" };
    }
    let remaining = this.#alignLive(snapTokens);

    // 1) Commit completed sentences: everything before the last sentence is
    //    stable because a newer sentence has started after it.
    const sentences = splitSentences(joinTokens(remaining));
    if (sentences.length > 1) {
      for (const sentence of sentences.slice(0, -1)) this.#commit(sentence, finals);
      remaining = tokenize(sentences[sentences.length - 1]);
    }

    // 2) Punctuation-independent fallback: once the still-live region is long,
    //    commit its stable prefix and keep a small revision margin live.
    while (remaining.length > LIVE_MAX) {
      const cut = remaining.length - LIVE_MARGIN;
      this.#commit(joinTokens(remaining.slice(0, cut)), finals);
      remaining = remaining.slice(cut);
    }

    const interim = joinTokens(remaining);
    this.#live = interim;
    return { finals, interim };
  }

  #commit(text: string, finals: string[]) {
    const rawTokens = tokenize(text.trim());
    if (rawTokens.length === 0) return;

    // Drop any leading tokens already covered by the end of the committed tail.
    // This is what kills the rolling-window re-emissions that the exact-key
    // `#seen` backstop can't catch (a one-word revision changes the whole key).
    const tokens = stripLeadingOverlap(
      this.#committedTail.map(normWord),
      rawTokens
    );
    if (tokens.length === 0) return;

    const trimmed = joinTokens(tokens).trim();
    const key = sentenceKey(trimmed);
    if (!key) return;

    // Fuzzy backstop: skip if this fragment is already fully contained in the
    // recent committed window, not just when it's byte-identical.
    if (this.#seen.has(key) || this.#tailContainsKey(key)) return;

    this.#committedTail.push(...tokens);
    if (this.#committedTail.length > TAIL_MAX) {
      this.#committedTail = this.#committedTail.slice(-TAIL_MAX);
    }
    this.#seen.add(key);
    finals.push(trimmed);
  }

  #tailContainsKey(key: string): boolean {
    const tailKey = this.#committedTail.map(normWord).filter(Boolean).join(" ");
    return tailKey.length > 0 && tailKey.includes(key);
  }

  // Strip the part of the snapshot that overlaps the committed tail and return
  // the remaining (live) tokens.
  #alignLive(snapTokens: string[]): string[] {
    let remaining = snapTokens;
    if (this.#consumedNorm.length > 0) {
      remaining = remainingAfterConsumed(this.#consumedNorm, remaining);
      if (remaining.length === 0) return remaining;
    }
    return remainingAfterConsumed(
      this.#committedTail.map(normWord).filter(Boolean),
      remaining,
      Infinity
    );
  }

  #isAlreadyConsumed(snapTokens: string[]): boolean {
    if (this.#consumedNorm.length === 0 || snapTokens.length === 0) return false;
    return remainingAfterConsumed(this.#consumedNorm, snapTokens).length === 0;
  }
}

/**
 * Collapse an immediately-repeated phrase in already-assembled transcript text
 * (a safety net for whatever duplication slips past the reconciler, e.g. from
 * the Live Captions PowerShell bridge concatenating a finalized + live block).
 * Only collapses phrases of length >= 2 so grammatical single-word doublings
 * ("had had", "that that") are preserved; the caption problem is multi-word.
 */
export function collapseRepeatedText(text: string): string {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (tokens.length < 2) return text.trim();

  const norm = tokens.map(normWord);
  const out: string[] = [];
  const outNorm: string[] = [];
  const MAX_PHRASE = 48;

  let i = 0;
  while (i < tokens.length) {
    let matched = 0;
    const maxLen = Math.min(MAX_PHRASE, tokens.length - i, out.length);
    for (let len = maxLen; len >= 2; len--) {
      let ok = true;
      for (let k = 0; k < len; k++) {
        const a = outNorm[out.length - len + k];
        const b = norm[i + k];
        if (!b || a !== b) {
          ok = false;
          break;
        }
      }
      if (ok) {
        matched = len;
        break;
      }
    }
    if (matched) {
      i += matched;
    } else {
      out.push(tokens[i]);
      outNorm.push(norm[i]);
      i++;
    }
  }

  return out.join(" ");
}
