// Model-key presence gate. META_API_KEY loads server-side from the runtime
// environment (root 8ofX/.env.local via host --env-file or provider env).
// This module reports a BOOLEAN ONLY: the value is never printed, logged,
// returned, or sent anywhere. Paid calls additionally require operator spike
// release; presence alone authorises nothing.
export function hasModelKey(env: Record<string, string | undefined>): boolean {
  const v = env.META_API_KEY;
  if (typeof v !== "string") return false;
  if (v.length < 8) return false;
  if (v.includes("placeholder") || v.includes("example") || v.includes("changeme")) return false;
  return true;
}
