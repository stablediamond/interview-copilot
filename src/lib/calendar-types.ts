export type CalendarLinkedApplication = {
  application_id: string;
  job_id: string;
  candidate_id: string;
  role: string;
  company: string;
};

export type CalendarEventView = {
  id: string;
  source_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: number | boolean;
  source_label: string;
  source_color: string;
  owner_firstname: string;
  owner_lastname: string;
  owner_email: string;
  candidate_id: string | null;
  candidate_firstname: string | null;
  candidate_lastname: string | null;
  candidate_email: string | null;
  interviewer_id: string | null;
  interviewer_firstname: string | null;
  interviewer_lastname: string | null;
  interviewer_email: string | null;
  linked_applications: CalendarLinkedApplication[];
};

export type CalendarMode = "manager" | "interviewer";

export type InterviewerCalendarPayload = {
  events: CalendarEventView[];
  privilege: string;
  mode: CalendarMode;
  applicationBasePath: string;
  rangeStart: string;
  rangeEnd: string;
  jobTrackUrl: string;
};
