// Pure helpers for the live-coding copilot: parse the section-tagged stream the
// coding endpoint emits into fixed UI zones. Kept dependency-free so it can be
// unit-tested in isolation and safely called on every streamed chunk.
//
// The output is a *coding script*: an ordered list of steps, each pairing a
// code chunk with a spoken narration ("as you type this, say this — and why"),
// so the candidate can type and explain in lockstep. Verbal modes
// (explain/answer/test) skip steps and use SAY + POINTS instead.

// Mirrors the transport error marker in `lib/api.ts` (streamTextResponse). Kept
// as a local literal so this module stays free of app/schema/zod imports.
const ERROR_DELIM = "---ERROR---";

export type CodingMode =
  | "new"
  | "fix"
  | "optimize"
  | "explain"
  | "test"
  | "answer";

export const CODING_MODES: readonly CodingMode[] = [
  "new",
  "fix",
  "optimize",
  "explain",
  "test",
  "answer",
];

// Short, human labels for the mode badge in the UI.
export const CODING_MODE_LABELS: Record<CodingMode, string> = {
  new: "Solution",
  fix: "Bug fix",
  optimize: "Optimize",
  explain: "Explain",
  test: "Dry run",
  answer: "Answer",
};

// Modes that produce a code script vs. a purely verbal answer.
export const VERBAL_MODES: readonly CodingMode[] = ["explain", "answer", "test"];

export interface CodingStep {
  /** The code to type for this step. */
  code: string;
  /** What to say out loud while typing it, and why. */
  narrate: string;
}

export interface CodingSolution {
  mode: CodingMode | null;
  /** The opening line the candidate says before typing. */
  say: string;
  /** Ordered code+narration steps (empty for verbal modes). */
  steps: CodingStep[];
  /** Language tag (e.g. "python"), taken from the first @@STEP@@ marker. */
  language: string;
  /** One-line time/space complexity. */
  complexity: string;
  /** Bulleted reasoning / edge cases (verbal modes, or extra notes). */
  points: string;
  /** Optional one-line follow-up / pitfall. */
  note: string;
  /** A mid-stream error surfaced by the streaming transport, if any. */
  error: string | null;
}

const MARKER_RE = /^@@([A-Z]+)@@[ \t]*(.*)$/;

// Known markers. CODE is an alias for STEP and PLAN an alias for POINTS so we
// stay robust to the model emitting the older single-block shape.
const KNOWN_MARKERS = new Set([
  "MODE",
  "SAY",
  "STEP",
  "CODE",
  "NARRATE",
  "COMPLEXITY",
  "POINTS",
  "PLAN",
  "NOTE",
]);

function emptySolution(): CodingSolution {
  return {
    mode: null,
    say: "",
    steps: [],
    language: "",
    complexity: "",
    points: "",
    note: "",
    error: null,
  };
}

function asMode(raw: string): CodingMode | null {
  const v = raw.trim().toLowerCase();
  return (CODING_MODES as readonly string[]).includes(v)
    ? (v as CodingMode)
    : null;
}

/**
 * Hide a partially-streamed trailing marker (e.g. "@@NARR") so it doesn't flash
 * in the UI while the next section header is still arriving.
 */
function stripPartialMarker(lines: string[]): string[] {
  if (lines.length === 0) return lines;
  const last = lines[lines.length - 1];
  if (/^@@[A-Z]*$/.test(last) && !/^@@[A-Z]+@@/.test(last)) {
    return lines.slice(0, -1);
  }
  return lines;
}

/**
 * Parse a (possibly partial) coding stream into fixed zones. Safe to call on
 * every chunk while streaming — content before the first marker is treated as
 * the SAY body so early tokens still render.
 */
export function parseCodingStream(full: string): CodingSolution {
  const result = emptySolution();

  let text = full;
  const errIdx = text.indexOf(ERROR_DELIM);
  if (errIdx !== -1) {
    result.error =
      text.slice(errIdx + ERROR_DELIM.length).trim() || "Streaming failed.";
    text = text.slice(0, errIdx);
  }

  const lines = stripPartialMarker(text.split("\n"));

  const say: string[] = [];
  const complexity: string[] = [];
  const points: string[] = [];
  const note: string[] = [];
  const steps: CodingStep[] = [];
  const stepCode: string[][] = [];
  const stepNarrate: string[][] = [];

  // "say" | "step" | "narrate" | "complexity" | "points" | "note" | null
  let current: string | null = "say";
  let stepIdx = -1;

  const startStep = (langInline: string) => {
    stepIdx += 1;
    stepCode[stepIdx] = [];
    stepNarrate[stepIdx] = [];
    const lang = langInline.trim().toLowerCase();
    if (lang && !result.language) result.language = lang;
  };

  for (const line of lines) {
    const m = line.match(MARKER_RE);
    if (m && KNOWN_MARKERS.has(m[1])) {
      const key = m[1];
      const inline = m[2] ?? "";
      switch (key) {
        case "MODE":
          result.mode = asMode(inline);
          current = null;
          break;
        case "SAY":
          current = "say";
          break;
        case "STEP":
        case "CODE":
          startStep(inline);
          current = "step";
          break;
        case "NARRATE":
          // A narration with no preceding step still needs a home.
          if (stepIdx < 0) startStep("");
          current = "narrate";
          break;
        case "COMPLEXITY":
          current = "complexity";
          break;
        case "POINTS":
        case "PLAN":
          current = "points";
          break;
        case "NOTE":
          current = "note";
          break;
      }
      continue;
    }

    switch (current) {
      case "say":
        say.push(line);
        break;
      case "step":
        stepCode[stepIdx]?.push(line);
        break;
      case "narrate":
        stepNarrate[stepIdx]?.push(line);
        break;
      case "complexity":
        complexity.push(line);
        break;
      case "points":
        points.push(line);
        break;
      case "note":
        note.push(line);
        break;
    }
  }

  for (let i = 0; i <= stepIdx; i += 1) {
    const code = trimBlankEdges((stepCode[i] ?? []).join("\n"));
    const narrate = (stepNarrate[i] ?? []).join("\n").trim();
    if (code || narrate) steps.push({ code, narrate });
  }

  result.say = say.join("\n").trim();
  result.steps = steps;
  result.complexity = complexity.join("\n").trim();
  result.points = points.join("\n").trim();
  result.note = note.join("\n").trim();

  return result;
}

/** Trim leading/trailing blank lines but preserve interior indentation. */
function trimBlankEdges(s: string): string {
  return s.replace(/^\s*\n+/, "").replace(/\s+$/, "");
}

/** The full solution code, assembled from every step (for copy / reference). */
export function fullCode(s: CodingSolution): string {
  return s.steps
    .map((st) => st.code)
    .filter(Boolean)
    .join("\n");
}

/** True once the stream has produced something worth showing. */
export function hasCodingContent(s: CodingSolution): boolean {
  return Boolean(
    s.say ||
      s.steps.length ||
      s.complexity ||
      s.points ||
      s.note ||
      s.mode
  );
}

/** A short, human title for a solved turn (for the history list). */
export function codingTurnTitle(s: CodingSolution): string {
  const firstSay = s.say.split("\n")[0]?.replace(/\*\*/g, "").trim();
  if (firstSay) return firstSay.slice(0, 60);
  const firstPoint = s.points
    .split("\n")
    .map((l) => l.replace(/^[-*]\s*/, "").trim())
    .find(Boolean);
  if (firstPoint) return firstPoint.slice(0, 60);
  return s.mode ? CODING_MODE_LABELS[s.mode] : "Solution";
}
