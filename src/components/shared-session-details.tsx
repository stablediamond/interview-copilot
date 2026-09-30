"use client";
import type { SharedSessionContext } from "@/lib/shared-event-session-types";
import { getJobTrackUrl } from "@/lib/job-track";
function Fields({ fields }: { fields: [string, unknown][] }) {
  return <dl className="grid gap-4 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label}><dt className="text-xs font-medium text-muted-foreground">{label}</dt><dd className="whitespace-pre-wrap break-words text-sm">{value == null || value === "" ? "—" : String(value)}</dd></div>)}</dl>;
}
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="min-w-0 space-y-4 rounded-lg border border-border p-4"><h3 className="font-semibold">{title}</h3>{children}</section>;
}
const date = (value: string | null) => value ? new Date(value).toLocaleString() : "—";
export function SharedCandidateDetails({ context }: { context: SharedSessionContext }) {
  const c = context.candidate;
  if (!c) return null;
  return <div className="space-y-4"><Section title="Candidate"><Fields fields={[
    ["Name", [c.firstname, c.middlename, c.lastname].filter(Boolean).join(" ")],
    ["Email", c.email], ["Phone", c.phone_number], ["Address", c.address], ["LinkedIn", c.linkedin],
    ["Date of birth", c.dob], ["Gender", c.gender], ["Veteran status", c.veteran], ["Disability", c.disability],
    ["Clearance", c.clearance], ["Preferred job titles", c.preferred_job_titles],
  ]} /></Section><Section title="Education">{c.education.length ? c.education.map((item, i) => <div key={i} className="text-sm"><p>{item.degree} · {item.institution}</p><p className="text-muted-foreground">{item.start_date} – {item.end_date || "Present"}</p></div>) : <p>No education recorded.</p>}</Section></div>;
}
export function SharedApplicationDetails({ context }: { context: SharedSessionContext }) {
  const a = context.application;
  if (!a) return null;
  const j = a.job;
  const href = `${getJobTrackUrl()}/${context.privilege === "manager" ? "manager" : "interviewer"}/applications/${encodeURIComponent(j.id)}?candidateId=${encodeURIComponent(a.candidateId)}`;
  return <div className="space-y-4">
    <Section title="Job posting"><Fields fields={[["Role",j.role],["Company",j.company],["Domain",j.company_domain],["Platform",j.platform],["Source",j.auto ? "Auto-imported" : "Manual"]]} /></Section>
    <div className="@container"><div className="grid gap-4 @min-[48rem]:grid-cols-2"><Section title="Application"><Fields fields={[
      ["Candidate",a.candidateName],["Email",a.candidateEmail],
      ...(context.privilege === "manager" ? [["Assistant",a.assistantName || "Unassigned"] as [string,unknown]] : []),
      ["Status",({ '-1':'Not Selected',0:'Not Applied',1:'Applied',2:'Interview scheduled' } as Record<string,string>)[j.application_status]],
      ["Applied at",date(j.applied_at)],["Application created",date(a.applicationCreatedAt)],
      ...(j.reason ? [["Not applied reason",j.reason] as [string,unknown]] : []),
    ]} /></Section><Section title="Documents & downloads"><Fields fields={[
      ["Resume on file",j.resume_content_json ? "Yes" : "No"],["Cover letter on file",j.cover_letter_json ? "Yes" : "No"],
      ["Resume downloads",j.resume_downloads],["Last resume download",date(j.resume_at)],
      ["Cover letter downloads",j.cover_letter_downloads],["Last cover letter download",date(j.cover_letter_at)],
    ]} /><a className="text-sm text-primary underline underline-offset-2" href={href} target="_blank" rel="noreferrer">Open application in Job Track for documents and actions</a></Section></div></div>
    <Section title="Interviews">{context.interviewEvents.map(e => <div key={e.id} className="text-sm"><p className="font-medium">{e.title}</p><p>{date(e.starts_at)} – {date(e.ends_at)}</p><p>{e.location}</p></div>)}</Section>
    <Section title="Job description"><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{j.description || "No saved description."}</p></Section>
  </div>;
}
