import { callJson, streamText } from "./llm";
import { getRuntimeConfig } from "./runtime-config";
import {
  ANSWER_MODE_INSTRUCTIONS,
  buildAnswerSystemPrompt,
  buildCodingSystemPrompt,
  CANDIDATE_EXTRACT_PROMPT,
  INTERVIEW_STAGE_INSTRUCTIONS,
  JOB_EXTRACT_PROMPT,
  languageBlock,
  POSITIONING_BRIEF_PROMPT,
  questionDepthBlock,
  REVIEW_PROMPT,
  REWRITE_PROMPT,
  STORY_CATEGORY_PLAN_PROMPT,
  STORY_GEN_PROMPT,
  STORY_IMPROVE_PROMPT,
} from "./prompts";
import {
  candidateStructuredSchema,
  generatedStoriesSchema,
  jobStructuredSchema,
  positioningBriefSchema,
  postInterviewReviewSchema,
  storyCategoryPlanSchema,
  UNIVERSAL_STORY_CATEGORIES,
  type AnswerLanguage,
  type AnswerMode,
  type CandidateStructured,
  type InterviewStage,
  type JobStructured,
  type PositioningBrief,
} from "./schemas";
import {
  buildAnswerContext,
  selectContext,
  type PriorTurn,
  type StoryLike,
} from "./context";
import { STORY_CATEGORY_LABELS } from "./constants";

export async function extractCandidateProfile(rawResumeText: string) {
  return callJson({
    model: (await getRuntimeConfig()).strongModel,
    system: CANDIDATE_EXTRACT_PROMPT,
    user: `RESUME:\n${rawResumeText}`,
    schema: candidateStructuredSchema,
    temperature: 0.2,
  });
}

export async function extractJobProfile(rawJobDescription: string) {
  return callJson({
    model: (await getRuntimeConfig()).strongModel,
    system: JOB_EXTRACT_PROMPT,
    user: `JOB DESCRIPTION:\n${rawJobDescription}`,
    schema: jobStructuredSchema,
    temperature: 0.2,
  });
}

/**
 * Build the one-time strategic positioning brief for a (candidate, job) pair.
 * Uses the strong analysis model; cached in the DB and injected into every live
 * answer for that pair.
 */
export async function generatePositioningBrief(params: {
  candidate: CandidateStructured;
  rawResumeText: string;
  job: JobStructured;
}): Promise<PositioningBrief> {
  const jobSummary = {
    company: params.job.company,
    role: params.job.role_title,
    seniority: params.job.seniority,
    domain: params.job.domain,
    must_have_skills: params.job.must_have_skills,
    preferred_skills: params.job.preferred_skills,
    responsibilities: params.job.responsibilities,
    likely_interview_focus: params.job.likely_interview_focus,
    likely_questions: params.job.likely_questions,
  };

  const user = [
    `TARGET JOB:\n${JSON.stringify(jobSummary, null, 2)}`,
    `STRUCTURED CANDIDATE PROFILE:\n${JSON.stringify(params.candidate, null, 2)}`,
    `RAW RESUME (for evidence):\n${params.rawResumeText.slice(0, 6000)}`,
  ].join("\n\n");

  return callJson({
    model: (await getRuntimeConfig()).strongModel,
    system: POSITIONING_BRIEF_PROMPT,
    user,
    schema: positioningBriefSchema,
    temperature: 0.4,
    timeoutMs: 60_000,
  });
}

// Per-round sampling temperature. Technical rounds want precision (lower);
// recruiter and culture chats want warmth and variety (higher). The "human"
// mode always nudges things looser on top of the stage baseline.
const STAGE_TEMPERATURE: Record<string, number> = {
  general: 0.55,
  technical: 0.4,
  behavioral: 0.5,
  recruiter_hr: 0.55,
  culture_fit: 0.6,
};

function answerTemperature(stage: InterviewStage | undefined, mode: AnswerMode): number {
  const base = STAGE_TEMPERATURE[stage ?? "general"] ?? 0.55;
  // "human" mode loosens tone a little, but not so much it rambles or drifts
  // off the facts.
  if (mode === "human") return Math.max(base, 0.7);
  return base;
}

function stageBlock(stage: InterviewStage | undefined): string {
  const instruction =
    INTERVIEW_STAGE_INSTRUCTIONS[stage ?? "general"] ??
    INTERVIEW_STAGE_INSTRUCTIONS.general;
  return `INTERVIEW STAGE (sets the depth + tone for this round; takes priority over the generic DEPTH guidance when they differ):\n${instruction}`;
}

/**
 * Generate a live interview answer as streamed Markdown deltas (answer body
 * followed by a trailing ---META--- JSON block). Used for the live session.
 */
export async function streamGenerateAnswer(params: {
  detectedQuestion: string;
  questionType?: string;
  recentTranscript: string;
  focusHint?: string;
  candidate?: CandidateStructured | null;
  job?: JobStructured | null;
  stories?: StoryLike[];
  positioning?: PositioningBrief | null;
  answerMode: AnswerMode;
  interviewStage?: InterviewStage;
  answerLanguage?: AnswerLanguage;
  maxSentences: number;
  boldKeywords: boolean;
  /** When true, the model may add plausible role-fitting specifics; off = strict grounding. */
  allowInventedDetails?: boolean;
  rawResumeFallback?: string;
  priorTurns?: PriorTurn[];
}) {
  const oneShot = !params.detectedQuestion.trim();

  // Use the most specific signal we have to retrieve relevant resume facts and
  // stories: an explicit question, else the latest-utterance focus hint, else
  // the whole transcript.
  const retrievalQuery =
    params.detectedQuestion.trim() ||
    (params.focusHint ?? "").trim() ||
    params.recentTranscript;

  const selected = selectContext({
    question: retrievalQuery,
    candidate: params.candidate,
    job: params.job,
    stories: params.stories,
  });

  const context = buildAnswerContext({
    detectedQuestion: params.detectedQuestion,
    questionType: params.questionType,
    recentTranscript: params.recentTranscript,
    focusHint: params.focusHint,
    candidate: params.candidate,
    job: params.job,
    selected,
    positioning: params.positioning,
    rawResumeFallback: params.rawResumeFallback,
    priorTurns: params.priorTurns,
  });

  const modeInstruction =
    ANSWER_MODE_INSTRUCTIONS[params.answerMode] ?? ANSWER_MODE_INSTRUCTIONS.default;

  const oneShotInstruction = oneShot
    ? "\n\nNO EXPLICIT QUESTION WAS PROVIDED. YOU decide what's being asked: identify the interviewer's most recent question or prompt (it's at the end of the transcript; a focus hint may point at it). If they packed several asks into that latest turn, answer each. Ignore the candidate's own speech, greetings, and filler. If the latest turn is not actually something to answer yet (acknowledgement, small talk, the candidate speaking, or an unfinished fragment), output exactly NO_ANSWER and nothing else."
    : "";

  const language = languageBlock(params.answerLanguage);
  const languageInstruction = language ? `\n\n${language}` : "";

  const depth = questionDepthBlock(params.questionType);
  const depthInstruction = depth ? `\n\n${depth}` : "";

  const system = `${buildAnswerSystemPrompt(
    params.maxSentences,
    params.boldKeywords,
    params.allowInventedDetails ?? true
  )}\n\n${stageBlock(params.interviewStage)}${depthInstruction}\n\nMODE:\n${modeInstruction}${oneShotInstruction}${languageInstruction}`;

  // Live answers use the user-selectable "live answer" model (fastModel) so the
  // teleprompter streams quickly; heavy analysis stays on the strong model.
  return streamText({
    model: (await getRuntimeConfig()).fastModel,
    system,
    user: context,
    temperature: answerTemperature(params.interviewStage, params.answerMode),
  });
}

/**
 * Solve (or fix / optimize / explain) a live coding problem from screenshot(s)
 * plus the interviewer's words. Streams the section-tagged coding block the
 * client parses into fixed zones. Uses the strong (vision-capable) model since
 * correctness matters more than shaving a second off first token.
 */
export async function streamCodingSolution(params: {
  images?: string[];
  pastedText?: string;
  transcript?: string;
  language?: string;
  mode?: string;
  priorProblem?: string;
  currentCode?: string;
  candidate?: CandidateStructured | null;
}) {
  const userParts: string[] = [];

  const mode = (params.mode ?? "auto").trim();
  if (mode && mode !== "auto") {
    userParts.push(
      `MODE (the interviewer / candidate forced this — honor it): ${mode}`
    );
  }

  if (params.transcript?.trim()) {
    userParts.push(
      `WHAT THE INTERVIEWER JUST SAID (use for intent; may be messy live captions):\n${params.transcript.trim()}`
    );
  }
  if (params.pastedText?.trim()) {
    userParts.push(`PROBLEM (pasted by the candidate):\n${params.pastedText.trim()}`);
  }
  if (params.priorProblem?.trim()) {
    userParts.push(`EARLIER IN THIS CODING SESSION (context):\n${params.priorProblem.trim()}`);
  }
  if (params.currentCode?.trim()) {
    userParts.push(`CANDIDATE'S CURRENT CODE (build on / fix this):\n${params.currentCode.trim()}`);
  }

  const hasImages = Boolean(params.images && params.images.length);
  if (hasImages) {
    userParts.push(
      `The attached screenshot${
        (params.images as string[]).length > 1 ? "s show" : " shows"
      } the problem and possibly the candidate's editor. Read it carefully and solve THAT problem.`
    );
  }

  if (!userParts.length) {
    userParts.push("Solve the coding problem shown in the attached screenshot(s).");
  }

  return streamText({
    model: (await getRuntimeConfig()).strongModel,
    system: buildCodingSystemPrompt(params.language),
    user: userParts.join("\n\n"),
    images: params.images,
    imageDetail: "high",
    // Correctness over raw speed: think a notch harder than the live-answer tier.
    reasoningTier: "balanced",
    // The step-by-step script (code chunks + narration) plus reasoning tokens
    // can run long; give the body ample room so it never truncates mid-step.
    maxOutputTokens: 6000,
    temperature: 0.2,
  });
}

/** Rewrite an existing answer into a new mode, streamed as Markdown + ---META---. */
export async function streamRewriteAnswer(params: {
  detectedQuestion: string;
  answer: string;
  answerMode: AnswerMode;
  interviewStage?: InterviewStage;
  answerLanguage?: AnswerLanguage;
  candidate?: CandidateStructured | null;
  job?: JobStructured | null;
  maxSentences: number;
  boldKeywords: boolean;
}) {
  const modeInstruction =
    ANSWER_MODE_INSTRUCTIONS[params.answerMode] ?? ANSWER_MODE_INSTRUCTIONS.default;

  const constraints: string[] = [];
  if (params.maxSentences > 0) {
    constraints.push(
      `Keep it to a lead line plus at most ${Math.max(
        2,
        Math.min(params.maxSentences, 5)
      )} short bullets.`
    );
  }
  constraints.push(
    params.boldKeywords
      ? "Emphasis: bold 1 to 3 key terms with double asterisks."
      : "Emphasis: plain text only — no bold or markdown emphasis."
  );

  const userParts = [
    `QUESTION:\n${params.detectedQuestion}`,
    `EXISTING ANSWER:\n${params.answer}`,
    `TARGET MODE:\n${modeInstruction}`,
  ];
  if (params.candidate) {
    userParts.push(
      `CANDIDATE WEAK/MISSING EVIDENCE (never claim these): ${
        params.candidate.weak_or_missing_evidence.join(", ") || "(none)"
      }`
    );
  }

  const language = languageBlock(params.answerLanguage);
  const languageInstruction = language ? `\n\n${language}` : "";

  return streamText({
    // Same selectable "live answer" model as generation.
    model: (await getRuntimeConfig()).fastModel,
    system: `${REWRITE_PROMPT}\n\n${stageBlock(params.interviewStage)}${languageInstruction}\n\nCONSTRAINTS:\n- ${constraints.join(
      "\n- "
    )}`,
    user: userParts.join("\n\n"),
    temperature: answerTemperature(params.interviewStage, params.answerMode),
  });
}

// Generating all ~16 categories in one JSON call produces a huge response that
// regularly truncates or times out (especially on the 30s default), so the whole
// batch fails. Generate in small chunks instead: each call is fast and reliable,
// runs in parallel, and a single chunk failing doesn't lose the rest.
const STORY_BATCH_SIZE = 4;

// Max story batches in flight at once — keeps things fast without hammering
// rate limits on lower OpenAI tiers.
const STORY_BATCH_CONCURRENCY = 2;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Run async tasks with a concurrency cap, preserving order in the results. */
async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length);
  let next = 0;

  const worker = async () => {
    for (let i = next++; i < tasks.length; i = next++) {
      try {
        results[i] = { status: "fulfilled", value: await tasks[i]() };
      } catch (reason) {
        results[i] = { status: "rejected", reason };
      }
    }
  };

  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    worker
  );
  await Promise.all(workers);
  return results;
}

export interface PlannedCategory {
  id: string;
  label: string;
  focus?: string;
}

/**
 * Ask the model which story categories fit THIS candidate + role, so the story
 * bank isn't a hardcoded engineering list. Returns a role-tailored mix of
 * universal behavioral + field-specific categories, minus anything already
 * covered. Falls back to the universal set if planning yields nothing.
 */
export async function planStoryCategories(params: {
  candidate: CandidateStructured;
  job?: JobStructured | null;
  existingCategories?: string[];
}): Promise<PlannedCategory[]> {
  const userParts = [
    `STRUCTURED CANDIDATE PROFILE:\n${JSON.stringify(params.candidate, null, 2)}`,
  ];
  if (params.job) {
    const roleSummary = {
      role: params.job.role_title,
      seniority: params.job.seniority,
      domain: params.job.domain,
      must_have_skills: params.job.must_have_skills,
      responsibilities: params.job.responsibilities,
    };
    userParts.push(`TARGET ROLE:\n${JSON.stringify(roleSummary, null, 2)}`);
  }
  if (params.existingCategories?.length) {
    userParts.push(`ALREADY COVERED (do not repeat):\n${params.existingCategories.join(", ")}`);
  }

  const plan = await callJson({
    model: (await getRuntimeConfig()).strongModel,
    system: STORY_CATEGORY_PLAN_PROMPT,
    user: userParts.join("\n\n"),
    schema: storyCategoryPlanSchema,
    temperature: 0.3,
  });

  return plan.categories.map((c) => ({
    id: c.id,
    label: c.label || c.id,
    focus: c.focus,
  }));
}

async function generateStoryBatch(
  model: string,
  candidate: CandidateStructured,
  rawResumeText: string,
  categories: PlannedCategory[]
) {
  const categoryLines = categories
    .map((c) => `- ${c.id} — ${c.label}${c.focus ? `: ${c.focus}` : ""}`)
    .join("\n");

  const user = [
    `STRUCTURED CANDIDATE PROFILE:\n${JSON.stringify(candidate, null, 2)}`,
    `RAW RESUME (for evidence only):\n${rawResumeText.slice(0, 6000)}`,
    `GENERATE ONE STORY FOR EACH OF THESE CATEGORIES:\n${categoryLines}`,
  ].join("\n\n");

  return callJson({
    model,
    system: STORY_GEN_PROMPT,
    user,
    schema: generatedStoriesSchema,
    temperature: 0.5,
    timeoutMs: 60_000,
  });
}

const universalPlanned = (): PlannedCategory[] =>
  UNIVERSAL_STORY_CATEGORIES.map((id) => ({
    id,
    label: STORY_CATEGORY_LABELS[id] ?? id,
  }));

export async function generateStories(params: {
  candidate: CandidateStructured;
  rawResumeText: string;
  job?: JobStructured | null;
  existingCategories?: string[];
  /** Optional explicit categories; if omitted, they're planned for the role. */
  categories?: PlannedCategory[];
}) {
  const model = (await getRuntimeConfig()).strongModel;
  const existing = new Set(
    (params.existingCategories ?? []).map((c) => c.toLowerCase())
  );

  // Resolve which categories to build: explicit > role-tailored plan > universal.
  let planned: PlannedCategory[];
  if (params.categories?.length) {
    planned = params.categories;
  } else {
    let fromPlan: PlannedCategory[] = [];
    try {
      fromPlan = await planStoryCategories({
        candidate: params.candidate,
        job: params.job,
        existingCategories: params.existingCategories,
      });
    } catch {
      // Planning is best-effort; fall back to the universal set below.
    }
    planned = fromPlan.length ? fromPlan : universalPlanned();
  }

  // Never regenerate a category the bank already has.
  planned = planned.filter((c) => c.id && !existing.has(c.id.toLowerCase()));
  if (planned.length === 0) return { stories: [] };

  const batches = chunk(planned, STORY_BATCH_SIZE);

  const results = await runWithConcurrency(
    batches.map(
      (cats) => () =>
        generateStoryBatch(model, params.candidate, params.rawResumeText, cats)
    ),
    STORY_BATCH_CONCURRENCY
  );

  const stories = results.flatMap((r) =>
    r.status === "fulfilled" ? r.value.stories : []
  );

  // Surface an error only if EVERY batch failed (otherwise return what we got).
  if (stories.length === 0) {
    const firstRejected = results.find((r) => r.status === "rejected");
    if (firstRejected && firstRejected.status === "rejected") {
      throw firstRejected.reason;
    }
  }

  return { stories };
}

export async function improveStory(params: {
  title: string;
  category: string;
  shortVersion: string;
  starVersion: string;
  technicalVersion: string;
  keywords: string[];
  evidence: string[];
}) {
  const user = `EXISTING STORY (improve tone only, keep facts):\n${JSON.stringify(
    {
      title: params.title,
      category: params.category,
      short_version: params.shortVersion,
      star_version: params.starVersion,
      technical_version: params.technicalVersion,
      keywords: params.keywords,
      evidence: params.evidence,
    },
    null,
    2
  )}`;

  return callJson({
    model: (await getRuntimeConfig()).strongModel,
    system: STORY_IMPROVE_PROMPT,
    user,
    schema: generatedStoriesSchema,
    temperature: 0.5,
  });
}

export async function generateReview(params: {
  sessionTitle: string;
  transcript: string;
  turns: Array<{
    detectedQuestion: string;
    questionType: string;
    generatedAnswer: string;
    confidence: string;
    riskNote: string;
  }>;
}) {
  const turnsText = params.turns
    .map(
      (t, i) =>
        `Q${i + 1} [${t.questionType}] (${t.confidence}${
          t.riskNote ? `, risk: ${t.riskNote}` : ""
        }): ${t.detectedQuestion}\nAnswer: ${t.generatedAnswer}`
    )
    .join("\n\n");

  const user = [
    `SESSION: ${params.sessionTitle}`,
    params.transcript.trim()
      ? `TRANSCRIPT:\n${params.transcript.slice(0, 6000)}`
      : "TRANSCRIPT: (none recorded)",
    turnsText ? `RECORDED TURNS:\n${turnsText}` : "RECORDED TURNS: (none)",
  ].join("\n\n");

  return callJson({
    model: (await getRuntimeConfig()).strongModel,
    system: REVIEW_PROMPT,
    user,
    schema: postInterviewReviewSchema,
    temperature: 0.4,
  });
}
