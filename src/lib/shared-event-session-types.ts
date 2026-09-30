export type SessionEvent = { id: string; title: string; candidate_name: string | null; job_title: string | null; job_id: string | null; application_candidate_id: string | null };
export type SessionMessage = { sequence: number; user_id: string; name: string; kind: "chat" | "copilot"; body: string; sent_at: string };
export type SessionSnapshot = {
  links: { meeting_link: string; support_link: string; meeting_version: number; support_version: number };
  participants: { user_id: string; name: string; privilege: string; online: boolean }[];
  messages: SessionMessage[];
};
export type SharedSessionContext = {
  event: SessionEvent; userId: string; privilege: string;
  candidate: (Record<string, string | null | unknown> & { education: { degree: string; institution: string; start_date: string; end_date: string }[] }) | null;
  application: {
    candidateId: string; candidateName: string; candidateEmail: string | null;
    assistantName: string | null; applicationCreatedAt: string;
    job: { id: string; role: string; company: string; company_domain: string | null; platform: string;
      auto: boolean; application_status: number; applied_at: string | null; reason: string | null;
      url: string | null; description: string | null; resume_content_json: unknown; cover_letter_json: unknown;
      resume_downloads: number; cover_letter_downloads: number; resume_at: string | null; cover_letter_at: string | null };
  } | null;
  interviewEvents: { id: string; title: string; starts_at: string; ends_at: string; location: string | null }[];
};
