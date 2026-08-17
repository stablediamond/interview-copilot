import { z } from "zod";

/* ----------------------------- Helpers ----------------------------- */

/**
 * Flatten one array item into a readable string. Verbose models (e.g. gpt-5.5)
 * often return objects like {name, role, duration} where we expect a plain
 * string, which would otherwise fail schema validation. Strings pass through;
 * objects are reduced to a sensible label; nullish items are dropped later.
 */
function itemToLabel(item: unknown): string {
  if (item == null) return "";
  if (typeof item === "string") return item.trim();
  if (typeof item === "number" || typeof item === "boolean") return String(item);
  if (typeof item === "object") {
    const o = item as Record<string, unknown>;
    const pick = (keys: string[]) =>
      keys
        .map((k) => o[k])
        .filter((v): v is string => typeof v === "string" && v.trim().length > 0);
    const head = pick(["name", "company", "title", "project", "skill", "label", "text", "value"])[0];
    const detail = pick(["role", "position", "duration", "period", "years", "description", "summary"]);
    const parts = [head, ...detail].filter(Boolean);
    if (parts.length) return parts.join(" — ");
    const anyStrings = Object.values(o).filter(
      (v): v is string => typeof v === "string" && v.trim().length > 0
    );
    return anyStrings.join(" — ");
  }
  return String(item);
}

/** Coerce any value into a clean string[] (objects → labels, scalars → [x]). */
function toStringArray(val: unknown): string[] {
  const arr = Array.isArray(val) ? val : val == null ? [] : [val];
  return arr.map(itemToLabel).filter((s) => s.length > 0);
}

/**
 * A string[] field that tolerates a model returning objects, a single value,
 * or null instead of a clean array of strings. Always yields string[].
 */
const looseStringArray = z.any().transform((val): string[] => toStringArray(val));

function firstString(o: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const label = itemToLabel(o[k]);
    if (label) return label;
  }
  return "";
}

export interface WeakSpot {
  concern: string;
  how_to_handle: string;
}

// A concrete, reusable "signature project" the candidate leans on across
// answers. Titles may be invented but plausible; contributions/tech/impact are
// specific so answers never drift into generic territory or contradict.
export interface BriefProject {
  title: string;
  what: string;
  contributions: string[];
  tech: string[];
  impact: string[];
  // The one thing the candidate really felt or believed about this work — what
  // they owned, pushed for, were frustrated or proud about. Gives live answers a
  // center so they don't sound neutral or generic.
  humanPoint: string;
}

const looseProjects = z.any().transform((val): BriefProject[] => {
  const arr = Array.isArray(val) ? val : val == null ? [] : [val];
  return arr
    .map((item): BriefProject => {
      if (typeof item === "string") {
        return { title: "", what: item.trim(), contributions: [], tech: [], impact: [], humanPoint: "" };
      }
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        return {
          title: firstString(o, ["title", "name", "project"]),
          what: firstString(o, ["what", "description", "summary", "about", "detail"]),
          contributions: toStringArray(
            o.contributions ?? o.did ?? o.what_i_did ?? o.actions ?? o.responsibilities
          ),
          tech: toStringArray(o.tech ?? o.stack ?? o.technologies ?? o.tools),
          impact: toStringArray(o.impact ?? o.results ?? o.outcomes ?? o.metrics),
          humanPoint: firstString(o, [
            "human_point",
            "humanPoint",
            "point",
            "perspective",
            "why_it_mattered",
            "take",
          ]),
        };
      }
      return { title: "", what: itemToLabel(item), contributions: [], tech: [], impact: [], humanPoint: "" };
    })
    .filter(
      (p) =>
        p.title || p.what || p.contributions.length || p.tech.length || p.impact.length
    );
});

// A canned, ready-to-say answer for a common question ("tell me about
// yourself", "why are you leaving", "why this company"), in the candidate's
// natural voice.
export interface BriefQa {
  question: string;
  answer: string;
}

const looseQa = z.any().transform((val): BriefQa[] => {
  const arr = Array.isArray(val) ? val : val == null ? [] : [val];
  return arr
    .map((item): BriefQa => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        return {
          question: firstString(o, ["question", "q", "prompt", "title"]),
          answer: firstString(o, ["answer", "a", "response", "text", "reply"]),
        };
      }
      return { question: "", answer: itemToLabel(item) };
    })
    .filter((qa) => qa.question || qa.answer);
});

/**
 * Weak-spot list that tolerates the model returning plain strings, a single
 * object, or objects with varied key names. Always yields {concern, how_to_handle}[].
 */
const looseWeakSpots = z.any().transform((val): WeakSpot[] => {
  const arr = Array.isArray(val) ? val : val == null ? [] : [val];
  return arr
    .map((item): WeakSpot => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const o = item as Record<string, unknown>;
        const concern = itemToLabel(
          o.concern ?? o.gap ?? o.weakness ?? o.risk ?? o.objection ?? o.topic ?? ""
        );
        const how = itemToLabel(
          o.how_to_handle ??
            o.handle ??
            o.answer ??
            o.response ??
            o.mitigation ??
            o.strategy ??
            o.how ??
            ""
        );
        if (concern || how) return { concern, how_to_handle: how };
        return { concern: itemToLabel(item), how_to_handle: "" };
      }
      return { concern: itemToLabel(item), how_to_handle: "" };
    })
    .filter((w) => w.concern || w.how_to_handle);
});

/* ----------------------------- Shared enums ----------------------------- */

export const questionTypeSchema = z.enum([
  "hr",
  "behavioral",
  "technical",
  "system_design",
  "salary",
  "logistics",
  "other",
]);
export type QuestionType = z.infer<typeof questionTypeSchema>;

export const confidenceSchema = z.enum(["high", "medium", "low"]);
export type Confidence = z.infer<typeof confidenceSchema>;

export const answerModeSchema = z.enum([
  "default",
  "shorter",
  "more_senior",
  "star",
  "technical",
  "human",
  "safer",
  "follow_up",
]);
export type AnswerMode = z.infer<typeof answerModeSchema>;

// Which interview round we're in. Sets the overall depth + tone calibration for
// every answer in the session (recruiter screens stay light, technical rounds go
// deep, culture chats stay casual). Separate from the per-answer answerMode.
export const interviewStageSchema = z.enum([
  "general",
  "recruiter_hr",
  "behavioral",
  "technical",
  "culture_fit",
]);
export type InterviewStage = z.infer<typeof interviewStageSchema>;

// Language the generated answer should be written in. "en" is the default;
// "zh" produces Simplified Chinese (rendered with per-character pinyin so the
// candidate can read it aloud).
export const answerLanguageSchema = z.enum(["en", "zh"]);
export type AnswerLanguage = z.infer<typeof answerLanguageSchema>;

// Story categories are NOT a fixed engineering list. They're chosen per
// candidate + target role at generation time (see planStoryCategories), so a
// data/ML/PM/QA/design candidate gets categories that fit THEIR field. These
// universal, role-agnostic categories apply to any interview and are used as
// the safe fallback + as suggestions in the manual editor. Any slug is valid.
export const UNIVERSAL_STORY_CATEGORIES = [
  "tell_me_about_yourself",
  "signature_project",
  "biggest_impact",
  "leadership_or_ownership",
  "teamwork_and_collaboration",
  "handling_conflict",
  "overcoming_failure",
  "adapting_to_change",
  "driving_improvement",
  "why_this_role",
] as const;

/** Normalize any label/id into a lowercase underscore slug. */
export function toCategorySlug(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// A free-form category slug. Bad/empty values fall back to "general" so a
// single odd story never fails a whole batch.
export const storyCategorySchema = z
  .preprocess((v) => toCategorySlug(v), z.string().min(1))
  .catch("general");
export type StoryCategory = string;

export const STORY_CATEGORIES: string[] = [...UNIVERSAL_STORY_CATEGORIES];

// LLM plan of which story categories to build for a specific candidate + role.
export const storyCategoryPlanSchema = z.object({
  categories: z
    .array(
      z.object({
        id: z.preprocess((v) => toCategorySlug(v), z.string().min(1)),
        label: z.string().default(""),
        focus: z.string().default(""),
      })
    )
    .default([]),
});
export type StoryCategoryPlan = z.infer<typeof storyCategoryPlanSchema>;

/* --------------------------- Structured profiles --------------------------- */

export const candidateStructuredSchema = z.object({
  name: z.string().default(""),
  seniority: z.string().default(""),
  target_titles: looseStringArray,
  core_stack: looseStringArray,
  secondary_stack: looseStringArray,
  domains: looseStringArray,
  companies: looseStringArray,
  projects: looseStringArray,
  metrics: looseStringArray,
  leadership: looseStringArray,
  strong_evidence: looseStringArray,
  weak_or_missing_evidence: looseStringArray,
  best_story_angles: looseStringArray,
});
export type CandidateStructured = z.infer<typeof candidateStructuredSchema>;

export const jobStructuredSchema = z.object({
  company: z.string().default(""),
  role_title: z.string().default(""),
  seniority: z.string().default(""),
  must_have_skills: looseStringArray,
  preferred_skills: looseStringArray,
  domain: z.string().default(""),
  responsibilities: looseStringArray,
  likely_interview_focus: looseStringArray,
  likely_questions: looseStringArray,
  resume_match_keywords: looseStringArray,
});
export type JobStructured = z.infer<typeof jobStructuredSchema>;

// A pre-interview strategic brief for one (candidate, job) pair. Generated once
// from the resume + JD + company + role, it's a bank of SPECIFIC, realistic
// stories + ready-to-say answers, injected into every live answer so answers
// stay concrete, human, and consistent (same project names, tech, and metrics
// everywhere — no duplication or contradiction mid-interview).
export const positioningBriefSchema = z.object({
  // One or two lines: what this candidate should be known for, for this role.
  headline: z.string().default(""),
  // The reusable signature stories — the heart of the brief.
  signature_projects: looseProjects,
  // Short reasons they match this specific role/JD.
  why_fit: looseStringArray,
  // Canned, ready-to-say answers for common questions (tell me about yourself,
  // why leaving, why this company, biggest impact, a weakness, career goal).
  prepared_answers: looseQa,
  // Likely gaps/objections and how to handle them honestly.
  weak_spots: looseWeakSpots,
});
export type PositioningBrief = z.infer<typeof positioningBriefSchema>;

/* ----------------------------- LLM responses ----------------------------- */

export const generateAnswerResponseSchema = z.object({
  detected_question: z.string(),
  answer: z.string(),
  keywords: z.array(z.string()).default([]),
  confidence: confidenceSchema,
  risk_note: z.string().default(""),
  possible_follow_up: z.string().default(""),
});
export type GenerateAnswerResponse = z.infer<typeof generateAnswerResponseSchema>;

// Trailing ---META--- block parsed from a streamed answer. Confidence is lenient
// (the model occasionally omits it) and defaults to "medium".
export const answerMetaSchema = z.object({
  detected_question: z.string().default(""),
  keywords: z.array(z.string()).default([]),
  confidence: confidenceSchema.catch("medium").default("medium"),
  risk_note: z.string().default(""),
  possible_follow_up: z.string().default(""),
});
export type AnswerMeta = z.infer<typeof answerMetaSchema>;

export const generatedStorySchema = z.object({
  title: z.string(),
  category: storyCategorySchema,
  short_version: z.string(),
  star_version: z.string(),
  technical_version: z.string(),
  keywords: looseStringArray,
  evidence: looseStringArray,
});
export type GeneratedStory = z.infer<typeof generatedStorySchema>;

export const generatedStoriesSchema = z.object({
  stories: z.array(generatedStorySchema).default([]),
});

export const postInterviewReviewSchema = z.object({
  questions_asked: z.array(z.string()).default([]),
  strongest_answers: z.array(z.string()).default([]),
  weak_answers: z.array(z.string()).default([]),
  missing_prep_areas: z.array(z.string()).default([]),
  follow_up_email: z.string().default(""),
});
export type PostInterviewReview = z.infer<typeof postInterviewReviewSchema>;

/* ----------------------------- API requests ----------------------------- */

export const analyzeResumeRequestSchema = z.object({
  rawResumeText: z.string().min(1, "Resume text is required"),
});

export const analyzeJobRequestSchema = z.object({
  rawJobDescription: z.string().min(1, "Job description is required"),
});

export const priorTurnSchema = z.object({
  question: z.string().default(""),
  answerGist: z.string().default(""),
});
export type PriorTurnInput = z.infer<typeof priorTurnSchema>;

export const generateAnswerRequestSchema = z
  .object({
    candidateProfileId: z.string().optional(),
    jobProfileId: z.string().optional(),
    recentTranscript: z.string().default(""),
    // Optional: if empty, the model infers the latest question from the
    // transcript and answers it in a single call (faster).
    detectedQuestion: z.string().default(""),
    // Soft steer toward the interviewer's most recent words (the latest
    // utterance the candidate clicked to answer). The model can still correct it.
    focusHint: z.string().default(""),
    questionType: questionTypeSchema.optional(),
    answerMode: answerModeSchema.default("default"),
    interviewStage: interviewStageSchema.default("general"),
    answerLanguage: answerLanguageSchema.default("en"),
    maxSentences: z.number().int().min(1).max(8).default(4),
    boldKeywords: z.boolean().default(false),
    // When true (default) the model may fill thin spots with realistic,
    // consistent specifics; false pins it to only what's in the supplied context.
    allowInventedDetails: z.boolean().default(true),
    // Prior answered turns this session, so the model can reference instead of repeat.
    priorTurns: z.array(priorTurnSchema).default([]),
  })
  .refine(
    (d) => d.detectedQuestion.trim() || d.recentTranscript.trim() || d.focusHint.trim(),
    {
      message: "Provide a detected question, some recent transcript, or a focus hint.",
    }
  );

export const rewriteAnswerRequestSchema = z.object({
  detectedQuestion: z.string().min(1),
  answer: z.string().min(1, "An existing answer is required"),
  answerMode: answerModeSchema,
  interviewStage: interviewStageSchema.default("general"),
  answerLanguage: answerLanguageSchema.default("en"),
  candidateProfileId: z.string().optional(),
  jobProfileId: z.string().optional(),
  maxSentences: z.number().int().min(1).max(8).default(4),
  boldKeywords: z.boolean().default(false),
});

export const generateStoriesRequestSchema = z.object({
  candidateProfileId: z.string().min(1, "A candidate profile is required"),
  // Optional target role: when provided, story categories are planned to match
  // what an interviewer for THIS job is likely to probe.
  jobProfileId: z.string().optional(),
  existingCategories: z.array(z.string()).default([]),
});

// Live coding copilot. "auto" lets the model infer mode/language from the
// screenshot + interviewer; the client can pin either.
export const codingModeRequestSchema = z.enum([
  "auto",
  "new",
  "fix",
  "optimize",
  "explain",
  "test",
  "answer",
]);
export type CodingModeRequest = z.infer<typeof codingModeRequestSchema>;

export const codingSolveRequestSchema = z
  .object({
    // Screenshot(s) of the problem / editor as data URLs (png or jpeg base64).
    // Multiple = scrolled captures or several problems, stitched by the model.
    images: z.array(z.string()).max(8).default([]),
    // Optional pasted problem text (clipboard-first when the screen is shared).
    pastedText: z.string().default(""),
    // What the interviewer just said (from the live transcript), for intent.
    transcript: z.string().default(""),
    language: z.string().default("auto"),
    mode: codingModeRequestSchema.default("auto"),
    candidateProfileId: z.string().optional(),
    // Prior context within the same coding session so follow-ups build on it.
    priorProblem: z.string().default(""),
    currentCode: z.string().default(""),
  })
  .refine(
    (d) => d.images.length > 0 || d.pastedText.trim() || d.transcript.trim(),
    { message: "Provide a screenshot, pasted problem, or some transcript." }
  );

export const positioningBriefRequestSchema = z.object({
  candidateProfileId: z.string().min(1, "A candidate profile is required"),
  jobProfileId: z.string().min(1, "A job profile is required"),
});

export const improveStoryRequestSchema = z.object({
  storyId: z.string().min(1),
});

/* ----------------------------- DB write schemas ----------------------------- */

export const storyInputSchema = z.object({
  title: z.string().min(1, "Title is required"),
  category: storyCategorySchema,
  shortVersion: z.string().default(""),
  starVersion: z.string().default(""),
  technicalVersion: z.string().default(""),
  keywords: z.array(z.string()).default([]),
  evidence: z.array(z.string()).default([]),
});
export type StoryInput = z.infer<typeof storyInputSchema>;

export const sessionInputSchema = z.object({
  title: z.string().min(1, "Title is required"),
  candidateProfileId: z.string().optional().nullable(),
  jobProfileId: z.string().optional().nullable(),
});

export const turnInputSchema = z.object({
  sessionId: z.string().min(1),
  rawTranscript: z.string().default(""),
  detectedQuestion: z.string().default(""),
  questionType: z.string().default("other"),
  generatedAnswer: z.string().default(""),
  answerMode: z.string().default("default"),
  interviewStage: z.string().default("general"),
  keywords: z.array(z.string()).default([]),
  confidence: z.string().default("medium"),
  riskNote: z.string().default(""),
  possibleFollowUp: z.string().default(""),
});

export const reviewRequestSchema = z.object({
  sessionId: z.string().min(1),
});
