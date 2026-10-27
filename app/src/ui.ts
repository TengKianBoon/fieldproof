// S2b phone UI router: #/new (requester), #/work/<mission>/<token> (worker),
// #/review/<mission>/<token> (reviewer). Tokens live in the URL FRAGMENT:
// never sent to the server, never logged, never in query strings. Photo
// evidence loads via evidence-get + blob URLs, revoked on every re-render.
import "./buffer-shim.ts";
import "./ui.css";
import { parseHashRoute, workLink, reviewLink, shrinkPhoto, uploadPhoto, evidenceBlob, calls } from "./client.ts";

const app = (): HTMLElement => document.getElementById("app") as HTMLElement;
let revoked: string[] = [];

function dropUrls(): void {
  for (const u of revoked) URL.revokeObjectURL(u);
  revoked = [];
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function errBox(e: unknown): string {
  return `<p class="err">${esc(e instanceof Error ? e.message : String(e))}</p>`;
}

async function copyText(t: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(t);
  } catch {
    window.prompt("Copy this link:", t);
  }
}

export function startRouter(): void {
  window.addEventListener("hashchange", () => void render());
  if (!window.location.hash) window.location.hash = "#/new";
  void render();
}

async function render(): Promise<void> {
  dropUrls();
  const r = parseHashRoute(window.location.hash);
  const el = app();
  try {
    if (r.name === "new") viewNew(el);
    else if (r.name === "work") await viewWork(el, r.missionId, r.token);
    else if (r.name === "review") await viewReview(el, r.missionId, r.token);
    else el.innerHTML = `<h1>FieldProof</h1><p class="err">Unknown link. Ask the requester for a fresh worker or reviewer link.</p>`;
  } catch (e) {
    el.innerHTML = `<h1>FieldProof</h1>${errBox(e)}`;
  }
}

function viewNew(el: HTMLElement): void {
  el.innerHTML = `<h1>New collection</h1>
    <label>Site label<input id="f-site" type="text" value="Supplier dock A" /></label>
    <label>Expected code, box 1<input id="f-c1" type="text" value="B12" /></label>
    <label>Expected code, box 2<input id="f-c2" type="text" value="B17" /></label>
    <label>Expected code, box 3<input id="f-c3" type="text" value="B23" /></label>
    <label>Deadline<input id="f-dl" type="text" value="2026-10-28T18:00:00Z" /></label>
    <label>Describe the check<textarea id="f-desc" rows="3" style="width:100%;box-sizing:border-box" placeholder="Verify lots B12 and B17 at Supplier dock A by Friday 6pm"></textarea></label>
    <button id="f-draft">Draft from description</button><div id="f-dmsg"></div>
    <button id="f-go" class="primary">Create mission</button><div id="f-out"></div>`;
  (document.getElementById("f-go") as HTMLButtonElement).onclick = async () => {
    const out = document.getElementById("f-out") as HTMLElement;
    try {
      const site = (document.getElementById("f-site") as HTMLInputElement).value;
      const codes = ["f-c1", "f-c2", "f-c3"].map((id) => (document.getElementById(id) as HTMLInputElement).value);
      const dl = (document.getElementById("f-dl") as HTMLInputElement).value;
      const c = await calls.createMission(site, codes, dl) as { missionId: string; workerToken: string; reviewToken: string };
      const wl = workLink(window.location.origin, c.missionId, c.workerToken);
      const rl = reviewLink(window.location.origin, c.missionId, c.reviewToken);
      out.innerHTML = `<div class="card links"><p class="ok">Mission ${esc(c.missionId)} open.</p>
        <p>Worker link:</p><a href="${esc(wl)}">${esc(wl)}</a><button id="f-cw">Copy worker link</button>
        <p>Reviewer link:</p><a href="${esc(rl)}">${esc(rl)}</a><button id="f-cr">Copy reviewer link</button></div>`;
      (document.getElementById("f-cw") as HTMLButtonElement).onclick = () => void copyText(wl);
      (document.getElementById("f-cr") as HTMLButtonElement).onclick = () => void copyText(rl);
    } catch (e) {
      out.innerHTML = errBox(e);
    }
  };
  (document.getElementById("f-draft") as HTMLButtonElement).onclick = async () => {
    const fmsg = document.getElementById("f-dmsg") as HTMLElement;
    try {
      const desc = (document.getElementById("f-desc") as HTMLTextAreaElement).value;
      const r = await fetch("/.netlify/functions/agent-draft", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ description: desc }),
      });
      const j = (await r.json()) as { draft?: { siteLabel: string; expectedCodes: string[]; deadline: string }; error?: string };
      if (!r.ok) throw new Error(String(j.error ?? r.status));
      const d = j.draft as { siteLabel: string; expectedCodes: string[]; deadline: string };
      (document.getElementById("f-site") as HTMLInputElement).value = d.siteLabel;
      for (let i = 0; i < 3; i++) {
        (document.getElementById(`f-c${i + 1}`) as HTMLInputElement).value = d.expectedCodes[i] ?? "";
      }
      (document.getElementById("f-dl") as HTMLInputElement).value = d.deadline;
      fmsg.innerHTML = `<p class="ok">Draft: ${d.expectedCodes.map(esc).join(", ")} — check and edit, then Create mission.</p>`;
    } catch (e) {
      fmsg.innerHTML = errBox(e);
    }
  };
}

interface BriefItem {
  itemId: string;
  state: string;
}

async function viewWork(el: HTMLElement, missionId: string, token: string): Promise<void> {
  const s = await calls.state(missionId, token) as {
    mission: { state: string; siteLabel: string; items: BriefItem[] };
  };
  const m = s.mission;
  if (m.state !== "capturing" && m.state !== "open" && m.state !== "consented") {
    el.innerHTML = `<h1>Collection</h1><p class="muted">Mission is ${esc(m.state)} — capture is closed.</p>`;
    return;
  }
  if (m.state !== "capturing") {
    el.innerHTML = `<h1>Collection</h1><p>${esc(m.siteLabel)}</p>
      <div class="card"><p>Consent: photos of the three labelled boxes are collected as delivery evidence and shown to the reviewer.</p>
      <label>Worker ID<input id="w-id" type="text" value="worker-1" /></label>
      <button id="w-ok" class="primary">Accept and start</button></div><div id="w-out"></div>`;
    (document.getElementById("w-ok") as HTMLButtonElement).onclick = async () => {
      const out = document.getElementById("w-out") as HTMLElement;
      try {
        await calls.consent(missionId, token, (document.getElementById("w-id") as HTMLInputElement).value);
        await render();
      } catch (e) {
        out.innerHTML = errBox(e);
      }
    };
    return;
  }
  const cards = m.items.map((it) => `<div class="card" data-item="${esc(it.itemId)}">
      <p><strong>${esc(it.itemId)}</strong> — ${esc(it.state)}</p>
      <input type="file" accept="image/*" capture="environment" data-photo="${esc(it.itemId)}" />
      <button data-shoot="${esc(it.itemId)}" class="primary">Take photo</button>
      <div data-msg="${esc(it.itemId)}"></div></div>`).join("");
  const allDone = m.items.every((it) => it.state === "matched" || it.state === "mismatched" || it.state === "inconclusive");
  el.innerHTML = `<h1>Collection</h1><div id="w-items">${cards}</div>
    <button id="w-review" class="primary" ${allDone ? "" : "disabled"}>Send for review</button><div id="w-out"></div>`;
  for (const it of m.items) {
    const btn = el.querySelector(`[data-shoot="${it.itemId}"]`) as HTMLButtonElement;
    const inp = el.querySelector(`[data-photo="${it.itemId}"]`) as HTMLInputElement;
    const msg = el.querySelector(`[data-msg="${it.itemId}"]`) as HTMLElement;
    btn.onclick = () => inp.click();
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      msg.innerHTML = `<p class="muted">Uploading…</p>`;
      try {
        const small = await shrinkPhoto(f);
        const attempt = `a${Date.now()}`;
        const up = await uploadPhoto(missionId, token, it.itemId, attempt, `${it.itemId}-${attempt}`, small);
        const cap = await calls.capture(missionId, token, it.itemId, up.uploadId) as { state: string };
        if (cap.state === "unclear") {
          msg.innerHTML = `<p>Label unclear — take a close-up (at most 2), then it goes inconclusive.</p>
            <button data-cu="${esc(it.itemId)}">Request close-up</button>`;
          (msg.querySelector(`[data-cu="${it.itemId}"]`) as HTMLButtonElement).onclick = async () => {
            try {
              await calls.closeup(missionId, token, it.itemId);
              msg.innerHTML = `<p class="ok">Close-up requested — take another photo above.</p>`;
            } catch (e) {
              if (String((e as Error).message).includes("closeup_exhausted")) {
                await calls.inconclusive(missionId, token, it.itemId);
                await render();
              } else msg.innerHTML = errBox(e);
            }
          };
        } else {
          msg.innerHTML = `<p class="ok">Server reading: ${esc(cap.state)}.</p>`;
          await render();
        }
      } catch (e) {
        msg.innerHTML = errBox(e);
      }
    };
  }
  (document.getElementById("w-review") as HTMLButtonElement).onclick = async () => {
    try {
      await calls.toReview(missionId, token);
      (document.getElementById("w-out") as HTMLElement).innerHTML = `<p class="ok">Sent for review.</p>`;
    } catch (e) {
      (document.getElementById("w-out") as HTMLElement).innerHTML = errBox(e);
    }
  };
}

async function viewReview(el: HTMLElement, missionId: string, token: string): Promise<void> {
  const s = await calls.state(missionId, token) as {
    mission: {
      state: string;
      expected: Array<{ itemId: string; expectedLabel: string }>;
      observed: Record<string, {
        observedLabel: string | null; readability: string; state: string; uploadId: string | null;
        labelBox?: { x1: number; y1: number; x2: number; y2: number; confidence: number } | null;
      }>;
    };
  };
  const m = s.mission;
  const cards: string[] = [];
  for (const e of m.expected) {
    const o = m.observed[e.itemId];
    cards.push(`<div class="card" data-item="${esc(e.itemId)}">
      <p><strong>${esc(e.itemId)}</strong> — expected ${esc(e.expectedLabel)}, observed ${esc(o.observedLabel ?? "—")} (${esc(o.readability)}, ${esc(o.state)})</p>
      <div data-photo="${esc(e.itemId)}"><p class="muted">Loading photo…</p></div>
      <div class="row"><button data-yes="${esc(e.itemId)}">Confirm match</button><button data-no="${esc(e.itemId)}">Confirm mismatch</button></div>
      <button data-inc="${esc(e.itemId)}">Inconclusive</button><div data-msg="${esc(e.itemId)}"></div></div>`);
  }
  el.innerHTML = `<h1>Review</h1><p class="muted">Mission ${esc(missionId)} — ${esc(m.state)}</p>
    <div id="r-items">${cards.join("")}</div>
    <button id="r-finish" class="primary">Finish review</button>
    <button id="r-dl">Download evidence pack (JSON)</button><div id="r-out"></div>`;
  for (const e of m.expected) {
    const o = m.observed[e.itemId];
    const slot = el.querySelector(`[data-photo="${e.itemId}"]`) as HTMLElement;
    if (o.uploadId) {
      try {
        const blob = await evidenceBlob(missionId, o.uploadId, token);
        const u = URL.createObjectURL(blob);
        revoked.push(u);
        const b = o.labelBox ?? null;
        slot.innerHTML = b !== null
          ? `<div style="position:relative"><img src="${u}" alt="evidence ${esc(e.itemId)}" style="width:100%" /><div style="position:absolute;left:${b.x1 * 100}%;top:${b.y1 * 100}%;width:${Math.max(0, b.x2 - b.x1) * 100}%;height:${Math.max(0, b.y2 - b.y1) * 100}%;border:3px solid #0a0;box-sizing:border-box"><span style="background:#0a0;color:#fff;font-size:.8rem">AI-located label</span></div></div>`
          : `<img src="${u}" alt="evidence ${esc(e.itemId)}" />`;
      } catch {
        slot.innerHTML = `<p class="err">Photo unavailable.</p>`;
      }
    } else slot.innerHTML = `<p class="muted">No photo yet.</p>`;
    const msg = el.querySelector(`[data-msg="${e.itemId}"]`) as HTMLElement;
    const decide = async (decision: string) => {
      try {
        await calls.decide(missionId, token, e.itemId, decision);
        msg.innerHTML = `<p class="ok">Recorded: ${esc(decision)}.</p>`;
      } catch (err) {
        msg.innerHTML = errBox(err);
      }
    };
    (el.querySelector(`[data-yes="${e.itemId}"]`) as HTMLButtonElement).onclick = () => void decide("confirmed_match");
    (el.querySelector(`[data-no="${e.itemId}"]`) as HTMLButtonElement).onclick = () => void decide("confirmed_mismatch");
    (el.querySelector(`[data-inc="${e.itemId}"]`) as HTMLButtonElement).onclick = () => void decide("inconclusive");
  }
  (document.getElementById("r-finish") as HTMLButtonElement).onclick = async () => {
    try {
      await calls.finishReview(missionId, token);
      (document.getElementById("r-out") as HTMLElement).innerHTML = `<p class="ok">Review finished.</p>`;
    } catch (e) {
      (document.getElementById("r-out") as HTMLElement).innerHTML = errBox(e);
    }
  };
  (document.getElementById("r-dl") as HTMLButtonElement).onclick = async () => {
    try {
      const pack = await calls.exportPack(missionId, token);
      const u = URL.createObjectURL(new Blob([JSON.stringify(pack)], { type: "application/json" }));
      revoked.push(u);
      const a = document.createElement("a");
      a.href = u;
      a.download = `evidence-${missionId}.json`;
      a.click();
    } catch (e) {
      (document.getElementById("r-out") as HTMLElement).innerHTML = errBox(e);
    }
  };
}
