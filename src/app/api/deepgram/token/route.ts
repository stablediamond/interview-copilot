import { jsonError, jsonOk } from "@/lib/api";
import { assertAccess, AccessError } from "@/lib/access";

export const runtime = "nodejs";

/**
 * Mints a short-lived Deepgram JWT for browser-side streaming. The long-lived
 * DEEPGRAM_API_KEY never leaves the server. The browser uses the returned
 * access_token via the WebSocket subprotocol ["bearer", access_token].
 */
export async function GET(request: Request) {
  const key = process.env.DEEPGRAM_API_KEY?.trim();
  if (!key) {
    return jsonError("Deepgram is not configured.", 503);
  }

  try {
    await assertAccess(request);
  } catch (err) {
    if (err instanceof AccessError) return jsonError(err.message, err.status);
    return jsonError("Access check failed.", 403);
  }

  try {
    const res = await fetch("https://api.deepgram.com/v1/auth/grant", {
      method: "POST",
      headers: {
        Authorization: `Token ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ttl_seconds: 30 }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return jsonError(
        `Deepgram token request failed (${res.status}). ${detail.slice(0, 200)}`,
        502
      );
    }

    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) {
      return jsonError("Deepgram did not return a token.", 502);
    }

    return jsonOk({ accessToken: data.access_token, expiresIn: data.expires_in ?? 30 });
  } catch {
    return jsonError("Could not reach Deepgram to mint a token.", 502);
  }
}
