// Browser API client (capture-worker-owned path; lead scaffolded minimal).
// Tokens travel in POST bodies / x-mission-token header, never query strings.
const BASE = "/.netlify/functions";

async function post(name: string, body: unknown): Promise<Record<string, unknown>> {
  const r = await fetch(`${BASE}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = (await r.json()) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(j.error ?? r.status));
  return j;
}

export async function createMission(siteLabel: string, labels: string[], deadline: string) {
  return post("mission-create", {
    siteLabel,
    expectedItems: labels.map((expectedLabel, i) => ({ itemId: `box${i + 1}`, expectedLabel })),
    deadline,
  });
}

export async function acceptConsent(missionId: string, token: string, workerId: string) {
  return post("consent-accept", { missionId, token, workerId, consentVersion: "v1" });
}

export async function closeup(missionId: string, token: string, itemId: string) {
  return post("closeup-request", { missionId, token, itemId });
}

export async function submitCapture(
  missionId: string, token: string, itemId: string, observedLabel: string | null, readable: boolean,
) {
  return post("capture-submit", { missionId, token, itemId, observedLabel, readable });
}

export async function decide(missionId: string, token: string, itemId: string, decision: string) {
  return post("review-decide", { missionId, token, itemId, decision });
}
