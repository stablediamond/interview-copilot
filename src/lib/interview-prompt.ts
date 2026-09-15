const PLACEHOLDER_PROFILE = "{{PROFILE}}";
const PLACEHOLDER_HTML_PAGE_SOURCE = "{{HTML_PAGE_SOURCE}}";
const PLACEHOLDER_HTML_PAGE_CONTENT = "{{HTML_PAGE_CONTENT}}";

const PROFILE_HEADER =
  "===================================================================\nPROFILE\n===================================================================";
const HTML_PAGE_SOURCE_HEADER =
  "===================================================================\nHTML_PAGE_SOURCE\n===================================================================";
const HTML_PAGE_CONTENT_HEADER =
  "===================================================================\nHTML_PAGE_CONTENT\n===================================================================";

const APPENDED_PROFILE_HEADER =
  "===================================================================\nPROFILE\n=======\n\n";
const APPENDED_HTML_HEADER =
  "===================================================================\nHTML_PAGE_SOURCE\n================\n\n";
const APPENDED_FOOTER =
  "===================================================================\n";

function buildAppendedBlocks(profileText: string, pageSourceText: string): string {
  return `${APPENDED_PROFILE_HEADER}${profileText.trim()}\n\n${APPENDED_HTML_HEADER}${pageSourceText.trim()}\n\n${APPENDED_FOOTER}`;
}

function stripLeadingRoleCompanyHeaders(text: string): string {
  let next = text.trim();
  while (/^(?:JOB_TITLE|COMPANY):[^\n]*(?:\n+|$)/i.test(next)) {
    next = next.replace(/^(?:JOB_TITLE|COMPANY):[^\n]*(?:\n+|$)/i, "").trim();
  }
  return next;
}

export function composeJobPromptPageSource(
  description: string,
  role?: string | null,
  company?: string | null,
): string {
  const title = role?.trim() ?? "";
  const employer = company?.trim() ?? "";
  let body = description.trim();
  if (!title && !employer) return body;
  body = stripLeadingRoleCompanyHeaders(body);
  const header = [
    title ? `JOB_TITLE: ${title}` : "",
    employer ? `COMPANY: ${employer}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return header && body ? `${header}\n\n${body}` : header || body;
}

/** Combine base interview prompts + resume + JD the same way Job Track does. */
export function buildInterviewBriefPrompt(
  basePrompts: string,
  resumeText: string,
  jobDescription: string,
  role?: string | null,
  company?: string | null,
): string {
  const profile = resumeText.trim();
  const pageSource = composeJobPromptPageSource(jobDescription, role, company);
  const template = basePrompts.trim();

  if (!profile) {
    throw new Error("Resume is empty. Open Edit and add resume content first.");
  }
  if (!pageSource) {
    throw new Error("Job description is empty. Open Edit and add the JD first.");
  }
  if (!template) {
    throw new Error("Base prompts are empty. Open Edit and add them first.");
  }

  if (
    template.includes(PLACEHOLDER_PROFILE) &&
    (template.includes(PLACEHOLDER_HTML_PAGE_SOURCE) ||
      template.includes(PLACEHOLDER_HTML_PAGE_CONTENT))
  ) {
    return template
      .replace(PLACEHOLDER_PROFILE, profile)
      .replace(PLACEHOLDER_HTML_PAGE_SOURCE, pageSource)
      .replace(PLACEHOLDER_HTML_PAGE_CONTENT, pageSource);
  }

  const profileIdx = template.indexOf(PROFILE_HEADER);
  const htmlIdx =
    template.indexOf(HTML_PAGE_SOURCE_HEADER) !== -1
      ? template.indexOf(HTML_PAGE_SOURCE_HEADER)
      : template.indexOf(HTML_PAGE_CONTENT_HEADER);
  const htmlHeader =
    template.indexOf(HTML_PAGE_SOURCE_HEADER) !== -1
      ? HTML_PAGE_SOURCE_HEADER
      : HTML_PAGE_CONTENT_HEADER;

  if (profileIdx !== -1 && htmlIdx !== -1 && htmlIdx > profileIdx) {
    const beforeProfile = template.slice(0, profileIdx + PROFILE_HEADER.length);
    const afterHtmlHeader = template.slice(htmlIdx + htmlHeader.length);
    const footerMatch = afterHtmlHeader.match(/\n=+\s*$/);
    const trailingFooter = footerMatch
      ? footerMatch[0]
      : "\n===================================================================\n";
    return `${beforeProfile}\n\n${profile}\n\n===================================================================\n\n${htmlHeader}\n\n${pageSource}\n${trailingFooter}`;
  }

  const blocks = buildAppendedBlocks(profile, pageSource);
  return `${template.trimEnd()}\n\n${blocks}`;
}
