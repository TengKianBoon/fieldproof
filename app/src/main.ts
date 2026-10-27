// Minimal phone-first mission loop driver (logic only; no styling changes).
// Capture-worker-owned path; lead scaffolded the first slice.
// NOTE: byte upload wiring from the browser is a tracked deliverable; this
// demo drives the consented mission and review steps around server uploads.
import { createMission, acceptConsent, decide } from "./api.ts";

const app = document.getElementById("app") as HTMLElement;
const logEl = document.getElementById("log") as HTMLElement;

function log(line: string): void {
  logEl.textContent += line + "\n";
}

async function runDemo(): Promise<void> {
  const created = await createMission("Supplier dock A", ["B12", "B17", "B23"], "2026-10-28T18:00:00Z");
  const missionId = String(created.missionId);
  const workerToken = String(created.workerToken);
  const reviewToken = String(created.reviewToken);
  log(`mission ${missionId} open`);

  await acceptConsent(missionId, workerToken, "worker-1");
  log("consent v1 accepted; evidence uploads submit by uploadId (server reads labels)");

  await decide(missionId, reviewToken, "box2", "confirmed_mismatch").catch((e: unknown) => {
    log(`review pending capture: ${e instanceof Error ? e.message : String(e)}`);
  });

  app.innerHTML = `<p>Mission ${missionId}: capture by uploadId; reviewer decides mismatches.</p>`;
}

runDemo().catch((e: unknown) => {
  log(`demo error: ${e instanceof Error ? e.message : String(e)}`);
});
