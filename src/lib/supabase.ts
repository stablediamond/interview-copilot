/**
 * Shared Supabase configuration (PUBLIC values only).
 *
 * Access control uses Supabase Auth: users sign in, and only accounts that exist
 * in your project's Authentication → Users can use the app. To revoke someone,
 * delete or ban them in the Supabase dashboard.
 *
 * Only the project URL and the anon (public) key belong here — both are safe to
 * ship in a client app. NEVER put the service_role key in this file.
 *
 * ── Enable auth ─────────────────────────────────────────────────────────────
 *   1. Paste SUPABASE_URL and SUPABASE_ANON_KEY below (anon/public key only).
 *   2. In the Supabase dashboard: Authentication → Providers → enable Email, and
 *      (recommended) turn OFF "Allow new users to sign up" so only YOU can add
 *      accounts. Then Authentication → Users → "Add user" for each person.
 *
 * While the two constants are blank, auth is OFF and the app works normally.
 * No SQL or tables are required.
 */

// ⬇️ Owner: paste your PUBLIC Supabase values here. Leave blank to disable auth.
export const SUPABASE_URL = "https://koyirakhuzkevcaowkwx.supabase.co"; // e.g. "https://abcdwxyz.supabase.co"
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtveWlyYWtodXprZXZjYW93a3d4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkxODg0MzgsImV4cCI6MjA5NDc2NDQzOH0.NBE_CwIwWDYCxvWnWWOgdZZXa_r2Vzo3zMJpHutAO38"; // anon / public key — NOT the service_role key

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

/** Base URL for the Supabase Auth (GoTrue) REST API. */
export function authBaseUrl(): string {
  return `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1`;
}
