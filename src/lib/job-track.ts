/**
 * Job Track origin used to verify Interview Coach logins.
 *
 * Unset JOB_TRACK_URL → production Job Track.
 * Set JOB_TRACK_URL="" to disable the login gate (local-only, no accounts).
 */
export const DEFAULT_JOB_TRACK_URL = "https://job-track.usgm.workers.dev";

export function getJobTrackUrl(): string {
  const raw =
    typeof window === "undefined"
      ? (process.env.JOB_TRACK_URL ?? process.env.NEXT_PUBLIC_JOB_TRACK_URL)
      : process.env.NEXT_PUBLIC_JOB_TRACK_URL;
  const value = (raw === undefined ? DEFAULT_JOB_TRACK_URL : raw)
    .trim()
    .replace(/\/$/, "");
  return value;
}

export function isJobTrackConfigured(): boolean {
  return getJobTrackUrl().length > 0;
}
