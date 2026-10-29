// health endpoint (R1b): GET only. Returns the app version and configuration
// booleans from shared/health.ts. Never a secret value, never store access.
import { healthSummary } from "../../shared/health.ts";

export default async function handler(req: Request): Promise<Response> {
  const headers = { "content-type": "application/json", "cache-control": "no-store" };
  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), { status: 405, headers: { ...headers, allow: "GET" } });
  }
  return new Response(JSON.stringify(healthSummary(process.env)), { status: 200, headers });
}
