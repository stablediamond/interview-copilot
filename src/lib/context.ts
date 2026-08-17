import type { CandidateStructured, JobStructured, PositioningBrief } from "./schemas";

export interface StoryLike {
  id: string;
  title: string;
  category: string;
  shortVersion: string;
  starVersion: string;
  technicalVersion: string;
  keywords: string[];
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "your",
  "you",
  "have",
  "has",
  "are",
  "was",
  "were",
  "will",
  "what",
  "when",
  "where",
  "which",
  "how",
  "why",
  "who",
  "can",
  "could",
  "would",
  "should",
  "about",
  "into",
  "over",
  "tell",
  "talk",
  "give",
  "any",
  "all",
  "some",
  "our",
  "their",
  "they",
  "them",
  "experience",
  "work",
  "team",
  "role",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// Interview-intent synonym groups. Plain keyword overlap silently fails on
// paraphrase — "conflict" shares no token with a story tagged "disagreement" —
// so we expand the query with related terms before scoring. Every word in a
// group pulls in the rest.
const SYNONYM_GROUPS: readonly string[][] = [
  ["conflict", "disagreement", "disagree", "pushback", "tension", "friction", "clash", "argument"],
  ["leadership", "lead", "led", "leading", "mentor", "mentored", "manage", "managed", "ownership", "owned", "drove"],
  ["failure", "failed", "mistake", "setback", "misstep", "wrong"],
  ["teamwork", "collaborate", "collaboration", "functional", "stakeholder", "partnership", "peers"],
  ["impact", "result", "results", "outcome", "achievement", "accomplishment", "delivered", "shipped"],
  ["challenge", "challenging", "difficult", "hard", "obstacle", "hurdle", "tough"],
  ["weakness", "weak", "struggle", "struggled", "improvement", "shortcoming"],
  ["deadline", "pressure", "tight", "crunch", "urgent"],
  ["scale", "scaling", "scalability", "throughput", "volume", "growth"],
  ["reliability", "reliable", "uptime", "incident", "outage", "resilience"],
  ["performance", "latency", "optimize", "optimization", "speed", "slow"],
  ["architecture", "design", "system", "tradeoff", "tradeoffs"],
  ["adapt", "adapting", "change", "ambiguity", "pivot", "uncertainty"],
  ["motivation", "motivated", "interested", "company"],
];

const SYNONYM_INDEX: Map<string, readonly string[]> = (() => {
  const index = new Map<string, string[]>();
  for (const group of SYNONYM_GROUPS) {
    for (const word of group) {
      const existing = index.get(word) ?? [];
      for (const other of group) {
        if (other !== word && !existing.includes(other)) existing.push(other);
      }
      index.set(word, existing);
    }
  }
  return index;
})();

// Expand a query token set with its interview-intent synonyms.
function expandTokens(tokens: Set<string>): Set<string> {
  const expanded = new Set(tokens);
  for (const token of tokens) {
    const synonyms = SYNONYM_INDEX.get(token);
    if (synonyms) for (const synonym of synonyms) expanded.add(synonym);
  }
  return expanded;
}

// Meaningful tokens inside a category slug ("handling_conflict" -> conflict),
// used to boost stories whose category matches the question's intent even when
// the story text has little lexical overlap.
function categoryTokens(slug: string): string[] {
  return slug
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

// Added to a story's lexical overlap when its category matches the query
// intent, so a categorically-correct story outranks an incidental keyword hit.
const CATEGORY_BOOST = 3;

function overlapScore(query: Set<string>, text: string): number {
  if (query.size === 0) return 0;
  const tokens = tokenize(text);
  let score = 0;
  for (const token of tokens) {
    if (query.has(token)) score += 1;
  }
  return score;
}

function rankByOverlap<T>(
  items: T[],
  query: Set<string>,
  getText: (item: T) => string,
  limit: number
): T[] {
  if (items.length === 0) return [];
  const scored = items.map((item, index) => ({
    item,
    index,
    score: overlapScore(query, getText(item)),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index; // stable, preserve original order on ties
  });
  return scored.slice(0, limit).map((s) => s.item);
}

export interface SelectedContext {
  resumeFacts: string[];
  jdRequirements: string[];
  stories: StoryLike[];
}

/**
 * Deterministically select the most relevant resume facts, JD requirements,
 * and story bank entries for a given detected question. Uses simple keyword
 * overlap scoring so the same inputs always produce the same context.
 */
export function selectContext(params: {
  question: string;
  candidate?: CandidateStructured | null;
  job?: JobStructured | null;
  stories?: StoryLike[];
  maxResumeFacts?: number;
  maxJdRequirements?: number;
  maxStories?: number;
}): SelectedContext {
  const {
    question,
    candidate,
    job,
    stories = [],
    maxResumeFacts = 8,
    maxJdRequirements = 5,
    maxStories = 3,
  } = params;

  // Build the query vocabulary from the question plus the JD match keywords,
  // since those describe what the interviewer is likely probing for, then
  // expand it with interview-intent synonyms so paraphrased questions still
  // retrieve the right facts and stories.
  const baseTokens = new Set<string>(tokenize(question));
  for (const kw of job?.resume_match_keywords ?? []) {
    for (const t of tokenize(kw)) baseTokens.add(t);
  }
  const queryTokens = expandTokens(baseTokens);

  const resumePool: string[] = [];
  if (candidate) {
    resumePool.push(
      ...candidate.strong_evidence,
      ...candidate.projects,
      ...candidate.metrics,
      ...candidate.leadership,
      ...candidate.core_stack.map((s) => `Core stack: ${s}`),
      ...candidate.secondary_stack.map((s) => `Also used: ${s}`),
      ...candidate.domains.map((d) => `Domain: ${d}`),
      ...candidate.best_story_angles
    );
  }

  const jdPool: string[] = [];
  if (job) {
    jdPool.push(
      ...job.must_have_skills.map((s) => `Must-have: ${s}`),
      ...job.responsibilities,
      ...job.preferred_skills.map((s) => `Preferred: ${s}`),
      ...job.likely_interview_focus.map((f) => `Focus: ${f}`)
    );
  }

  const dedupedResume = Array.from(new Set(resumePool.filter(Boolean)));
  const dedupedJd = Array.from(new Set(jdPool.filter(Boolean)));

  return {
    resumeFacts: rankByOverlap(dedupedResume, queryTokens, (t) => t, maxResumeFacts),
    jdRequirements: rankByOverlap(dedupedJd, queryTokens, (t) => t, maxJdRequirements),
    stories: rankStories(stories, queryTokens, maxStories),
  };
}

// Rank stories by keyword overlap plus a boost when the story's category
// matches the question's (expanded) intent — so "tell me about a conflict"
// surfaces the handling_conflict story even if their wording barely overlaps.
function rankStories(
  stories: StoryLike[],
  query: Set<string>,
  limit: number
): StoryLike[] {
  if (stories.length === 0) return [];
  const scored = stories.map((story, index) => {
    const text = `${story.title} ${story.category} ${story.keywords.join(" ")} ${story.shortVersion}`;
    let score = overlapScore(query, text);
    const categoryMatches = categoryTokens(story.category).some((t) => query.has(t));
    if (categoryMatches) score += CATEGORY_BOOST;
    return { story, index, score };
  });
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.index - b.index; // stable, preserve original order on ties
  });
  return scored.slice(0, limit).map((s) => s.story);
}

/**
 * Render the selected context plus structured profile summaries into a compact
 * user-message payload for the answer model. Avoids sending the full raw resume
 * when a structured profile is available.
 */
export interface PriorTurn {
  question: string;
  answerGist: string;
}

/** Render the positioning brief into a specific, skimmable block for the model. */
function renderPositioning(brief: PositioningBrief): string {
  const lines: string[] = [
    "POSITIONING — your CANONICAL facts for THIS role. Pull the signature project or prepared answer that fits the question and reuse its exact names, tech, and numbers. Stay this specific; never go generic:",
  ];
  if (brief.headline) lines.push(`Known for: ${brief.headline}`);

  if (brief.signature_projects.length) {
    lines.push("\nSIGNATURE PROJECTS (reuse these exact stories):");
    for (const p of brief.signature_projects.slice(0, 6)) {
      const parts: string[] = [];
      const head = [p.title, p.what].filter(Boolean).join(" — ");
      if (head) parts.push(head);
      if (p.contributions.length) parts.push(`did: ${p.contributions.slice(0, 5).join("; ")}`);
      if (p.tech.length) parts.push(`tech: ${p.tech.slice(0, 12).join(", ")}`);
      if (p.impact.length) parts.push(`impact: ${p.impact.slice(0, 4).join("; ")}`);
      if (p.humanPoint) parts.push(`point: ${p.humanPoint}`);
      if (parts.length) lines.push(`- ${parts.join(" | ")}`);
    }
  }

  if (brief.why_fit.length) lines.push(`\nWhy a fit: ${brief.why_fit.slice(0, 5).join("; ")}`);

  if (brief.prepared_answers.length) {
    lines.push("\nPREPARED ANSWERS (adapt to the exact wording asked; keep the facts):");
    for (const qa of brief.prepared_answers.slice(0, 8)) {
      if (qa.answer) lines.push(`- ${qa.question ? `${qa.question}: ` : ""}${qa.answer}`);
    }
  }

  if (brief.weak_spots.length) {
    const ws = brief.weak_spots
      .slice(0, 5)
      .map((w) => (w.how_to_handle ? `${w.concern} -> ${w.how_to_handle}` : w.concern))
      .join(" | ");
    lines.push(`\nIf a weak spot comes up: ${ws}`);
  }

  return lines.join("\n");
}

export function buildAnswerContext(params: {
  detectedQuestion: string;
  questionType?: string;
  recentTranscript: string;
  focusHint?: string;
  candidate?: CandidateStructured | null;
  job?: JobStructured | null;
  selected: SelectedContext;
  positioning?: PositioningBrief | null;
  rawResumeFallback?: string;
  priorTurns?: PriorTurn[];
}): string {
  const { detectedQuestion, questionType, recentTranscript, candidate, job, selected } =
    params;
  const focusHint = (params.focusHint ?? "").trim();
  const transcript = recentTranscript.slice(-2000).trim();
  const hasExplicitQuestion = Boolean(detectedQuestion.trim());

  // Assembled in two halves. The STABLE half (profile, positioning brief,
  // resume facts, JD, stories) is identical across turns in a session, so
  // putting it FIRST lets the model's prompt cache reuse it turn-to-turn. The
  // VOLATILE half (prior answers, then the ask) changes every turn and goes
  // LAST — the freshest, most important instruction sits closest to the output,
  // clearly anchored so attention still lands on it (the system prompt also
  // tells the model the thing to answer is at the end).
  const parts: string[] = [];

  // ---- Stable, cacheable prefix ----
  // Strategic positioning first — when present it's the primary source of
  // specifics and frames everything else.
  if (params.positioning) {
    parts.push(renderPositioning(params.positioning));
  }

  if (candidate) {
    parts.push(
      [
        "CANDIDATE PROFILE:",
        `- Name: ${candidate.name || "(unknown)"}`,
        `- Seniority: ${candidate.seniority || "(unknown)"}`,
        `- Core stack: ${candidate.core_stack.join(", ") || "(none listed)"}`,
        `- Domains: ${candidate.domains.join(", ") || "(none listed)"}`,
        `- Companies: ${candidate.companies.join(", ") || "(none listed)"}`,
        `- Weak/missing evidence (avoid overclaiming): ${
          candidate.weak_or_missing_evidence.join(", ") || "(none listed)"
        }`,
      ].join("\n")
    );
  } else if (params.rawResumeFallback) {
    parts.push(`RAW RESUME (no structured profile available):\n${params.rawResumeFallback.slice(0, 4000)}`);
  } else {
    parts.push("CANDIDATE PROFILE: (none provided — answer in safe, general language)");
  }

  if (selected.resumeFacts.length) {
    parts.push(`TOP RELEVANT RESUME FACTS:\n- ${selected.resumeFacts.join("\n- ")}`);
  }

  if (job) {
    parts.push(
      [
        "JOB PROFILE:",
        `- Company: ${job.company || "(unknown)"}`,
        `- Role: ${job.role_title || "(unknown)"}`,
        `- Domain: ${job.domain || "(unknown)"}`,
      ].join("\n")
    );
  }

  if (selected.jdRequirements.length) {
    parts.push(`TOP RELEVANT JD REQUIREMENTS:\n- ${selected.jdRequirements.join("\n- ")}`);
  }

  if (selected.stories.length) {
    const storyText = selected.stories
      .map(
        (s) =>
          `[${s.category}] ${s.title}\n  short: ${s.shortVersion}\n  star: ${s.starVersion}`
      )
      .join("\n");
    parts.push(`RELEVANT APPROVED STORIES:\n${storyText}`);
  }

  // ---- Volatile tail (changes every turn) ----
  const priorTurns = (params.priorTurns ?? []).filter((t) => t.question.trim());
  if (priorTurns.length) {
    const recent = priorTurns.slice(-6);
    const lines = recent
      .map((t) => `- Q: ${t.question.trim()} -> ${t.answerGist.trim()}`)
      .join("\n");
    parts.push(
      `PRIOR ANSWERS THIS SESSION (already covered; do not repeat. If the new question overlaps, reference briefly with "As I mentioned earlier" and add only what is new):\n${lines}`
    );
  }

  // The thing to answer comes LAST. With an explicit question that's the
  // question; otherwise it's the transcript, framed so the model answers the
  // LATEST utterance (at the end) rather than something stale.
  if (hasExplicitQuestion) {
    const ask: string[] = [`=== YOUR TASK (answer this now) ===\n\nQUESTION TO ANSWER:\n${detectedQuestion}`];
    if (questionType) ask.push(`QUESTION TYPE: ${questionType}`);
    if (transcript) ask.push(`RECENT TRANSCRIPT (context only):\n${transcript}`);
    parts.push(ask.join("\n\n"));
  } else {
    const task: string[] = ["=== YOUR TASK (answer this now) ==="];
    if (focusHint) {
      // The latest turn is handed over explicitly, so we don't rely on "it's at
      // the end of the transcript". Earlier speech (if any) is background only.
      task.push(
        "TASK — answer what the interviewer asks under INTERVIEWER'S LATEST WORDS. If they packed SEVERAL distinct questions or prompts into it, answer EACH (as numbered blocks). A prompt may not end in \"?\". Anything under EARLIER CONTEXT is only there to interpret the ask — do NOT re-answer it. Ignore the candidate's own speech, greetings, and filler."
      );
      task.push(`INTERVIEWER'S LATEST WORDS — this is what to answer:\n${focusHint}`);
      if (transcript) {
        task.push(`EARLIER CONTEXT (background only, already handled):\n${transcript}`);
      }
    } else {
      // No explicit latest-turn hint: fall back to "the ask is at the end".
      task.push(
        "TASK — answer the interviewer's MOST RECENT question or prompt. It's at the END of the transcript; earlier lines are only there to interpret it. If several distinct things were asked, answer each. A prompt may not end in \"?\". Ignore the candidate's own speech, greetings, and filler."
      );
      if (transcript) {
        task.push(`TRANSCRIPT:\n${transcript}`);
      }
    }
    parts.push(task.join("\n\n"));
  }

  return parts.join("\n\n");
}
