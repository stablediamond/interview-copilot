/**
 * Pure helpers for classifying and ranking OpenAI model ids. Used to populate
 * the model pickers and to recommend sensible defaults from whatever the user's
 * API key actually has access to (no hardcoded assumptions about availability).
 */

const NON_CHAT_PATTERNS = [
  "embedding",
  "whisper",
  "tts",
  "audio",
  "transcribe",
  "realtime",
  "dall-e",
  "image",
  "moderation",
  "search",
  "computer-use",
  "codex",
  "babbage",
  "davinci",
  "omni-moderation",
];

export function isChatModel(id: string): boolean {
  const lower = id.toLowerCase();
  if (!/(gpt|^o\d|^chatgpt)/.test(lower)) return false;
  return !NON_CHAT_PATTERNS.some((p) => lower.includes(p));
}

export function isTranscriptionModel(id: string): boolean {
  const lower = id.toLowerCase();
  return lower.includes("transcribe") || lower.includes("whisper");
}

/**
 * Reasoning models (o-series and the gpt-5 family, excluding gpt-5-chat) do all
 * their thinking BEFORE the first token, so they're slow to first token — a poor
 * fit for the live-answer slot where streaming latency matters. Mirrors the
 * server-side detection in llm.ts.
 */
export function isReasoningModelId(id: string): boolean {
  const l = id.toLowerCase();
  if (/^o\d/.test(l)) return true;
  if (/^gpt-5/.test(l) && !l.includes("chat")) return true;
  return false;
}

/**
 * Higher score = stronger/newer family. Parses the version number out of the id
 * so newer releases automatically rank higher (e.g. gpt-5.5 > gpt-5 > gpt-4.1 >
 * gpt-4o > gpt-3.5), without hardcoding a fixed list of model names.
 */
function familyScore(id: string): number {
  const l = id.toLowerCase();

  // gpt-N or gpt-N.M family (gpt-5.5, gpt-4.1, gpt-4o -> 4, gpt-3.5).
  const gptMatch = l.match(/gpt-(\d+(?:\.\d+)?)/);
  if (gptMatch) return 100 + parseFloat(gptMatch[1]) * 10;

  if (l.includes("chatgpt")) return 130;

  // o-series reasoning models (o1, o3, o4, ...). Kept below the gpt families
  // since they're typically slower for short spoken answers.
  const oMatch = l.match(/^o(\d+)/);
  if (oMatch) return 70 + Number(oMatch[1]);

  return 10;
}

function sizePenalty(id: string): number {
  const l = id.toLowerCase();
  if (l.includes("nano")) return 2;
  if (l.includes("mini")) return 1;
  return 0;
}

/** Prefer stable, non-dated, non-preview ids when scores tie. */
function stabilityBonus(id: string): number {
  const l = id.toLowerCase();
  let bonus = 0;
  if (/\d{4}-\d{2}-\d{2}/.test(l) || /-\d{4}$/.test(l)) bonus -= 1; // dated snapshot
  if (l.includes("preview")) bonus -= 1;
  if (l.includes("chat")) bonus += 0.5;
  return bonus;
}

export function rankChatModels(ids: string[]): string[] {
  return [...ids].sort((a, b) => {
    const fa = familyScore(a) - sizePenalty(a) + stabilityBonus(a);
    const fb = familyScore(b) - sizePenalty(b) + stabilityBonus(b);
    if (fb !== fa) return fb - fa;
    return a.localeCompare(b);
  });
}

export interface ModelRecommendation {
  chatModels: string[];
  transcriptionModels: string[];
  recommendedStrong: string | null;
  recommendedFast: string | null;
  recommendedTranscription: string | null;
}

export function recommendModels(ids: string[]): ModelRecommendation {
  const chat = rankChatModels(ids.filter(isChatModel));
  const transcription = ids.filter(isTranscriptionModel).sort((a, b) => {
    // Prefer gpt-4o transcribe models over whisper, mini after full.
    const score = (x: string) =>
      (x.includes("gpt-4o") ? 2 : 0) + (x.includes("mini") ? -0.5 : 0);
    return score(b) - score(a) || a.localeCompare(b);
  });

  // "Pro" reasoning models (gpt-5-pro, o1-pro, …) rank highest but take minutes
  // and only run at "high" effort — a poor default for a real-time tool — so we
  // don't auto-recommend them. They stay in the list; the user can still pick
  // one deliberately.
  const nonPro = chat.filter((m) => !m.toLowerCase().includes("-pro"));

  // Strongest = top of the ranked non-pro list.
  const recommendedStrong = nonPro[0] ?? chat[0] ?? null;

  // Fast = best "mini"/"nano" model, else the second-best chat model.
  const small = nonPro.find((m) => /mini|nano/.test(m.toLowerCase()));
  const recommendedFast = small ?? nonPro[1] ?? nonPro[0] ?? chat[0] ?? null;

  const recommendedTranscription =
    transcription.find((m) => m.includes("mini")) ?? transcription[0] ?? null;

  return {
    chatModels: chat,
    transcriptionModels: transcription,
    recommendedStrong,
    recommendedFast,
    recommendedTranscription,
  };
}
