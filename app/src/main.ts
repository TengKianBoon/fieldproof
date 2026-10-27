// Minimal phone-first mission loop driver (logic only; no styling changes).
// Capture-worker-owned path; lead scaffolded the first slice.
import { createMission, acceptConsent, closeup, submitCapture, decide } from "./api.ts";

const app = document.getElementById("app") as HTMLElement;
const logEl = document.getElementById("log") as HTMLElement;

function log(line: string): void {
  logEl.textContent += line + "\n";
}

async function runDemo(): Promise<void> {
  // Demo mission: three labelled boxes vs synthetic delivery note.
  const created = await createMission("Supplier dock A", ["B12", "B17", "B23"], "2026-10-28T18:00:00Z");
  const missionId = String(created.missionId);
  const workerToken = String(created.workerToken);
  const reviewToken = String(created.reviewToken);
  log(`mission ${missionId} open`);

  await acceptConsent(missionId, workerToken, "worker-1");
  log("consent v1 accepted");

  await submitCapture(missionId, workerToken, "box1", "B12", true);
  await submitCapture(missionId, workerToken, "box2", "B71", true); // observed B71 vs expected B17
  await submitCapture(missionId, workerToken, "box3", null, false); // unreadable label
  log("captured: box1 matched, box2 mismatched (B71 vs B17), box3 unclear");

  await closeup(missionId, workerToken, "box3");
  await submitCapture(missionId, workerToken, "box3", null, false);
  await closeup(missionId, workerToken, "box3");
  log("box3 still unclear after 2 close-ups -> inconclusive (never a match)");

  await decide(missionId, reviewToken, "box2", "confirmed_mismatch");
  log("reviewer confirmed box2 mismatch; human decision recorded separately");

  app.innerHTML = `<p>Mission ${missionId}: box1 matched · box2 confirmed mismatch · box3 inconclusive.</p>`;
}

runDemo().catch((e: unknown) => {
  log(`demo error: ${e instanceof Error ? e.message : String(e)}`);
});
