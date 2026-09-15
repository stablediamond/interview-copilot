const PLACEHOLDER_PROFILE = "{{PROFILE}}";
const PLACEHOLDER_HTML_PAGE_SOURCE = "{{HTML_PAGE_SOURCE}}";

/**
 * Default ChatGPT brief for a live interview — not the Job Track resume
 * writer prompt stored on the candidate.
 */
export const DEFAULT_INTERVIEW_PROMPTS = `You are a live interview copilot.

Use the candidate resume and the job description to help run this interview:
- Map the strongest resume evidence to the job requirements
- Flag gaps, risks, and claims worth probing
- Suggest concise follow-up questions as the conversation unfolds

Stay specific to this candidate and this role. Do not rewrite the resume.

${PLACEHOLDER_PROFILE}

${PLACEHOLDER_HTML_PAGE_SOURCE}
`;

export function looksLikeResumeWriterPrompt(value: string): boolean {
  const text = value.toLowerCase();
  if (!text.trim()) return false;
  return (
    text.includes("resume strategist") ||
    text.includes("ats optimization specialist") ||
    text.includes("generate exactly one complete resume json") ||
    (text.includes("coverletter") && text.includes("summarytitle"))
  );
}

/** Prefer saved interview prompts; ignore empty or Job Track resume-writer text. */
export function resolveInterviewPrompts(
  saved: string | undefined,
  fallback: string,
): string {
  const trimmed = saved?.trim() ?? "";
  if (!trimmed || looksLikeResumeWriterPrompt(trimmed)) {
    return fallback.trim() ? fallback : DEFAULT_INTERVIEW_PROMPTS;
  }
  return saved ?? fallback;
}
