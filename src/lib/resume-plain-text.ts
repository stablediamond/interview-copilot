function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stringField(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return stripHtml(value);
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
    if (Array.isArray(value)) {
      const joined = value
        .map((item) => {
          if (typeof item === "string") return stripHtml(item);
          if (isRecord(item)) {
            return stringField(
              item.text,
              item.description,
              item.infoHtml,
              item.title,
            );
          }
          return "";
        })
        .filter(Boolean)
        .join("\n");
      if (joined) return joined;
    }
  }
  return "";
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== "{" && trimmed[0] !== "[")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

function entriesOf(section: unknown): Record<string, unknown>[] {
  if (Array.isArray(section)) {
    return section.filter(isRecord);
  }
  if (isRecord(section)) {
    if (Array.isArray(section.entries)) {
      return section.entries.filter(isRecord);
    }
    if (Array.isArray(section.items)) {
      return section.items.filter(isRecord);
    }
  }
  return [];
}

const SKIP_KEYS = new Set([
  "id",
  "index",
  "visible",
  "isHidden",
  "hidden",
  "icon",
  "iconKey",
  "order",
  "createdAt",
  "updatedAt",
  "showPlaceholder",
  "sectionType",
  "displayName",
]);

const META_KEYS = new Set([
  "id",
  "resumeId",
  "summaryTitle",
  "targetJobTitle",
  "targetCompany",
  "coverLetter",
  "personalDetails",
  "content",
  "data",
  "resume",
]);

const SECTION_TITLES: Record<string, string> = {
  profile: "Summary",
  skill: "Skills",
  skills: "Skills",
  work: "Work experience",
  education: "Education",
  project: "Projects",
  projects: "Projects",
  language: "Languages",
  languages: "Languages",
  certificate: "Certifications",
  certificates: "Certifications",
  certification: "Certifications",
  award: "Awards",
  interest: "Interests",
  interests: "Interests",
};

function sectionTitle(key: string, section: Record<string, unknown> | null): string {
  const named = section ? stringField(section.displayName, section.title) : "";
  if (named) return named;
  return SECTION_TITLES[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
}

function collectSections(
  source: Record<string, unknown>,
): Record<string, Record<string, unknown>[]> {
  const out: Record<string, Record<string, unknown>[]> = {};

  const take = (key: string, value: unknown) => {
    if (META_KEYS.has(key) || out[key]) return;
    const entries = entriesOf(value);
    if (entries.length > 0) out[key] = entries;
  };

  for (const [key, value] of Object.entries(source)) {
    take(key, value);
  }
  const content = parseJsonValue(source.content);
  if (isRecord(content)) {
    for (const [key, value] of Object.entries(content)) {
      take(key, value);
    }
  }
  return out;
}

function unwrapResume(resume: unknown): Record<string, unknown> | null {
  let parsed = parseJsonValue(resume);
  parsed = parseJsonValue(parsed);
  if (!isRecord(parsed)) return null;

  const data = isRecord(parsed.data) ? parsed.data : null;
  const nestedList = data?.resumes;
  const nestedRecord = data && isRecord(data.resume) ? data.resume : null;
  if (Array.isArray(nestedList) && isRecord(nestedList[0])) {
    const nested = nestedList[0];
    return {
      ...parsed,
      ...nested,
      personalDetails: isRecord(nested.personalDetails)
        ? nested.personalDetails
        : parsed.personalDetails,
      content: isRecord(nested.content) ? nested.content : parsed.content,
    };
  }
  if (nestedRecord) {
    return {
      ...parsed,
      ...nestedRecord,
      personalDetails: isRecord(nestedRecord.personalDetails)
        ? nestedRecord.personalDetails
        : parsed.personalDetails,
      content: isRecord(nestedRecord.content)
        ? nestedRecord.content
        : parsed.content,
    };
  }

  if (isRecord(parsed.resume)) {
    return {
      ...parsed,
      ...parsed.resume,
      personalDetails: isRecord(parsed.resume.personalDetails)
        ? parsed.resume.personalDetails
        : parsed.personalDetails,
      content: isRecord(parsed.resume.content)
        ? parsed.resume.content
        : parsed.content,
    };
  }

  return parsed;
}

function formatMonthYear(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value === "string") {
    const trimmed = stripHtml(value);
    if (!trimmed || trimmed === "[object Object]") return "";
    return trimmed;
  }
  if (!isRecord(value)) return "";
  const year = stringField(value.year, value.y);
  const monthRaw = stringField(
    value.month,
    value.monthName,
    value.m,
    value.startMonth,
  );
  if (year && monthRaw) {
    const monthNum = Number(monthRaw);
    if (Number.isFinite(monthNum) && monthNum >= 1 && monthNum <= 12) {
      return `${String(monthNum).padStart(2, "0")}/${year}`;
    }
    return `${monthRaw} ${year}`;
  }
  if (year) return year;
  return stringField(
    value.date,
    value.formatted,
    value.label,
    value.text,
    value.startDateNew,
    value.endDateNew,
  );
}

function formatPeriod(entry: Record<string, unknown>): string {
  const nestedDate = isRecord(entry.date) ? entry.date : null;
  const start = formatMonthYear(
    entry.startDateNew ??
      entry.startDate ??
      entry.start_date ??
      entry.start ??
      nestedDate?.startDateNew ??
      nestedDate?.startDate ??
      nestedDate?.start ??
      nestedDate?.from,
  );
  const end = formatMonthYear(
    entry.endDateNew ??
      entry.endDate ??
      entry.end_date ??
      entry.end ??
      nestedDate?.endDateNew ??
      nestedDate?.endDate ??
      nestedDate?.end ??
      nestedDate?.to,
  );
  if (start && end) return `${start} – ${end}`;
  if (start) return start;
  if (end) return end;
  return formatMonthYear(entry.date) || formatMonthYear(entry.dates) ||
    formatMonthYear(entry.period) ||
    formatMonthYear(entry.duration);
}

function formatPersonal(personal: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const name = stringField(personal.fullName, personal.name);
  if (name) lines.push(name);
  const title = stringField(personal.jobTitle, personal.title, personal.headline);
  if (title) lines.push(title);
  const email = stringField(personal.email);
  if (email) lines.push(`Email: ${email}`);
  const phone = stringField(personal.phone, personal.phoneNumber);
  if (phone) lines.push(`Phone: ${phone}`);
  const location = stringField(personal.location, personal.address, personal.city);
  if (location) lines.push(`Location: ${location}`);
  const linkedin = stringField(personal.linkedin, personal.website, personal.url);
  if (linkedin) lines.push(`LinkedIn: ${linkedin}`);
  return lines;
}

function formatWorkEntry(entry: Record<string, unknown>): string[] {
  const role = stringField(entry.jobTitle, entry.title, entry.position);
  const company = stringField(entry.employer, entry.company);
  const dates = formatPeriod(entry);
  const location = stringField(entry.location);
  const heading = [
    role && company ? `${role} at ${company}` : role || company,
    location,
    dates,
  ]
    .filter(Boolean)
    .join(" | ");
  const lines: string[] = [];
  if (heading) lines.push(`- ${heading}`);
  const description = stringField(entry.description, entry.text, entry.infoHtml);
  if (description) lines.push(description);
  return lines;
}

function formatSkillEntry(entry: Record<string, unknown>): string[] {
  const label = stringField(entry.skill, entry.title, entry.name);
  const items = stringField(entry.infoHtml, entry.text, entry.description);
  const line = [label, items].filter(Boolean).join(": ");
  return line ? [`- ${line}`] : [];
}

function formatEducationEntry(entry: Record<string, unknown>): string[] {
  const degree = stringField(entry.degree, entry.title, entry.study);
  const institution = stringField(
    entry.institution,
    entry.school,
    entry.university,
  );
  const dates = formatPeriod(entry);
  const heading = [degree, institution, dates].filter(Boolean).join(" — ");
  const lines: string[] = [];
  if (heading) lines.push(`- ${heading}`);
  const description = stringField(entry.description, entry.text);
  if (description) lines.push(description);
  return lines;
}

function formatGenericEntry(entry: Record<string, unknown>): string[] {
  const title = stringField(
    entry.title,
    entry.name,
    entry.skill,
    entry.degree,
    entry.company,
  );
  const extra = stringField(
    entry.description,
    entry.text,
    entry.infoHtml,
  );
  const dates = formatPeriod(entry);
  const leftover = Object.entries(entry)
    .filter(
      ([key]) =>
        !SKIP_KEYS.has(key) &&
        ![
          "startDateNew",
          "endDateNew",
          "startDate",
          "endDate",
          "start_date",
          "end_date",
          "date",
          "dates",
          "period",
          "duration",
        ].includes(key),
    )
    .map(([, value]) =>
      typeof value === "string" || typeof value === "number"
        ? stringField(value)
        : "",
    )
    .filter((value) => value && value !== title && value !== extra && value !== dates);
  const line = [title, extra, dates, ...leftover].filter(Boolean).join(" — ");
  return line ? [`- ${line}`] : [];
}

function formatSection(
  key: string,
  entries: Record<string, unknown>[],
  rawSection: unknown,
): string[] {
  const title = sectionTitle(key, isRecord(rawSection) ? rawSection : null);
  const body: string[] = [];
  for (const entry of entries) {
    if (key === "work") body.push(...formatWorkEntry(entry));
    else if (key === "skill" || key === "skills") body.push(...formatSkillEntry(entry));
    else if (key === "education") body.push(...formatEducationEntry(entry));
    else if (key === "profile") {
      const text = stringField(entry.text, entry.description, entry.infoHtml);
      if (text) body.push(text);
    } else body.push(...formatGenericEntry(entry));
  }
  if (body.length === 0) return [];
  return ["", `${title}:`, ...body];
}

function looksLikeJsonText(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function flattenUnknownObject(value: unknown, depth = 0): string[] {
  if (depth > 8) return [];
  if (typeof value === "string") {
    const text = stripHtml(value);
    if (!text || looksLikeJsonText(text)) return [];
    if (/^[0-9a-f-]{36}$/i.test(text)) return [];
    return [text];
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return [String(value)];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => flattenUnknownObject(item, depth + 1));
  }
  if (!isRecord(value)) return [];
  const lines: string[] = [];
  for (const [key, nested] of Object.entries(value)) {
    if (SKIP_KEYS.has(key) || META_KEYS.has(key)) continue;
    lines.push(...flattenUnknownObject(nested, depth + 1));
  }
  return lines;
}

/** Flatten Job Track resume_content_json (FlowCV / LLM) to editable plain text. */
export function formatResumeJsonAsPlainText(resume: unknown): string {
  const parsed = unwrapResume(resume);
  if (!parsed) {
    return typeof resume === "string" && !looksLikeJsonText(resume)
      ? resume.trim()
      : "";
  }

  const lines: string[] = [];
  const personal = isRecord(parsed.personalDetails)
    ? parsed.personalDetails
    : isRecord(parsed.content) && isRecord(parsed.content.personalDetails)
      ? parsed.content.personalDetails
      : null;
  if (personal) lines.push(...formatPersonal(personal));

  const headline = stringField(
    parsed.summaryTitle,
    parsed.targetJobTitle,
    isRecord(parsed.summary) ? parsed.summary.title : "",
  );
  if (headline) lines.push(headline);

  const summaryText = isRecord(parsed.summary)
    ? stringField(parsed.summary.text)
    : "";
  const sections = collectSections(parsed);

  if (summaryText && (!sections.profile || sections.profile.length === 0)) {
    lines.push("", "Summary:", summaryText);
  }

  const order = [
    "profile",
    "skill",
    "skills",
    "work",
    "education",
    "project",
    "projects",
    "language",
    "certificate",
  ];
  const seen = new Set<string>();
  for (const key of [...order, ...Object.keys(sections)]) {
    if (seen.has(key) || !sections[key]) continue;
    seen.add(key);
    const rawSection =
      parsed[key] ??
      (isRecord(parsed.content) ? parsed.content[key] : undefined);
    lines.push(...formatSection(key, sections[key], rawSection));
  }

  const formatted = lines.join("\n").trim();
  if (formatted) return formatted;
  return flattenUnknownObject(parsed).join("\n\n").trim();
}

export function resumeTextLooksLikeJson(value: string): boolean {
  return looksLikeJsonText(value);
}

/** Show stored resume as readable text, flattening leftover JSON if needed. */
export function displayResumeText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (looksLikeJsonText(trimmed)) {
    return formatResumeJsonAsPlainText(trimmed) || trimmed;
  }
  return value;
}
