import { handleRouteError, jsonError, jsonOk, parseBody } from "@/lib/api";
import { getJobTrackUrl, isJobTrackConfigured } from "@/lib/job-track";
import { z } from "zod";

export const runtime = "nodejs";

const loginSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
});

type JobTrackLoginBody = {
  ok?: boolean;
  token?: string;
  expiresIn?: number;
  email?: string;
  firstname?: string;
  lastname?: string;
  privilege?: string;
  message?: string;
  error?: string;
};

/**
 * Proxy Job Track's JSON login so the desktop overlay never talks to Job Track
 * from the renderer (no CORS, same error messages as the web app).
 */
export async function POST(request: Request) {
  if (!isJobTrackConfigured()) {
    return jsonError("Job Track sign-in is not configured.", 503);
  }

  const { data, error } = await parseBody(request, loginSchema);
  if (error) return error;

  try {
    const res = await fetch(`${getJobTrackUrl()}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        email: data.email.trim().toLowerCase(),
        password: data.password,
      }),
      cache: "no-store",
    });

    let parsed: JobTrackLoginBody | null = null;
    try {
      parsed = (await res.json()) as JobTrackLoginBody;
    } catch {
      parsed = null;
    }

    if (res.status === 404) {
      return jsonError(
        "Job Track login is not available on the server yet. Deploy the latest Job Track app.",
        502,
      );
    }

    const token = parsed?.token;
    if (!res.ok || !parsed?.ok || !token) {
      return jsonError(
        parsed?.message || parsed?.error || "Invalid email or password.",
        res.status === 403 ? 403 : res.status === 401 ? 401 : 502,
      );
    }

    return jsonOk({
      token,
      email: parsed.email || data.email.trim().toLowerCase(),
      expiresIn: parsed.expiresIn ?? 60 * 60 * 24 * 7,
      firstname: parsed.firstname ?? "",
      lastname: parsed.lastname ?? "",
      privilege: parsed.privilege ?? "",
    });
  } catch (err) {
    if (err instanceof TypeError) {
      return jsonError("Could not reach Job Track. Check your connection and try again.", 502);
    }
    return handleRouteError(err);
  }
}
