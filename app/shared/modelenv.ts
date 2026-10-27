// Model-key presence gate + env parsing. META_API_KEY loads server-side
// from the runtime environment (root 8ofX/.env.local via host --env-file or
// provider env). Presence is a BOOLEAN ONLY: the value is never printed,
// logged, returned, or sent anywhere. Paid calls additionally require
// operator spike release; presence alone authorises nothing.
export function hasModelKey(env: Record<string, string | undefined>): boolean {
  const v = env.META_API_KEY;
  if (typeof v !== "string") return false;
  if (v.length < 8) return false;
  if (v.includes("placeholder") || v.includes("example") || v.includes("changeme")) return false;
  return true;
}

// Pure .env parser used by the spike --run loader. Strict by design:
// - KEY must start the line exactly (no leading spaces, no spaces around =);
//   anything else is ignored, never erroring into a match.
// - Values keep interior characters (including =); surrounding whitespace and
//   a trailing CR are stripped; ONE surrounding pair of single or double
//   quotes is stripped (S12). Keys never leave the caller's memory.
export function parseEnvKey(text: string, name: string): string | null {
  for (const line of text.split("\n")) {
    if (!line.startsWith(`${name}=`)) continue;
    let v = line.slice(name.length + 1).trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    else if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) v = v.slice(1, -1);
    if (v === "") return null;
    return v;
  }
  return null;
}
