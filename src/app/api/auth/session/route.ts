import { handleRouteError, jsonOk } from "@/lib/api";
import { assertAccess } from "@/lib/access";
import { isJobTrackConfigured } from "@/lib/job-track";

export const runtime = "nodejs";

/** Confirm the stored Job Track token is still valid. */
export async function GET(request: Request) {
  try {
    await assertAccess(request);
    return jsonOk({ configured: isJobTrackConfigured() });
  } catch (err) {
    return handleRouteError(err);
  }
}
