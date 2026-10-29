// G1 glasses simulation: pure HUD markup for the #/glasses/<mission>/<token>
// display-concept route. The HUD reuses the WORKER view of the mission
// (itemId, neutral state, photo tip only) — it never receives expected
// codes, readings, or decisions, so it cannot reveal them. No hardware,
// SDK, or partnership claims: the permanent label says what this is.
export const GLASSES_LABEL =
  "Simulation: concept for display glasses. Today FieldProof runs on phones.";

export interface GlassesItem {
  itemId: string;
  state: string;
  hint?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Neutral worker words only: a stored photo is "Photo received", anything
// else is "Waiting for photo". Mirrors plainWorkerItem without importing UI.
export function glassesItemStatus(state: string): string {
  return state === "received" ? "Photo received" : "Waiting for photo";
}

export function buildGlassesHUD(args: {
  missionId: string;
  siteLabel: string;
  items: GlassesItem[];
  index: number;
  closed: boolean;
}): string {
  const label = `<p class="hud-label">${esc(GLASSES_LABEL)}</p>`;
  if (args.closed || args.items.length === 0) {
    return `<div class="hud">${label}<p class="hud-progress">Capture is closed</p>`
      + `<p class="hud-site">${esc(args.siteLabel)}</p></div>`;
  }
  const k = Math.min(Math.max(args.index, 0), args.items.length - 1);
  const cur = args.items[k];
  const done = args.items.filter((it) => it.state === "received").length;
  const tip = cur.hint === undefined || cur.hint === "" ? "" : `<p class="hud-tip">Tip: ${esc(cur.hint)}</p>`;
  return `<div class="hud">${label}`
    + `<p class="hud-progress">Item ${k + 1} of ${args.items.length} · ${done} received</p>`
    + `<p class="hud-site">${esc(args.siteLabel)}</p>`
    + `<p class="hud-item">${esc(cur.itemId)}</p>`
    + `<p class="hud-status">${esc(glassesItemStatus(cur.state))}</p>`
    + tip
    + (cur.state === "received"
      ? `<p class="hud-note">Photo received — this item is done.</p>`
      : `<input type="file" accept="image/*" capture="environment" data-gphoto="${esc(cur.itemId)}" />`
      + `<button data-gshoot="${esc(cur.itemId)}" class="primary">Take photo</button>`)
    + `<div data-gmsg="${esc(cur.itemId)}"></div>`
    + `<div class="hud-nav"><button data-gprev="${k === 0 ? "off" : "on"}"${k === 0 ? " disabled" : ""}>Previous</button>`
    + `<button data-gnext="${k === args.items.length - 1 ? "off" : "on"}"${k === args.items.length - 1 ? " disabled" : ""}>Next</button></div>`
    + `</div>`;
}
