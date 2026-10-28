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

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 12)}…` : id;
}

// S9 plain-English mission states for worker/reviewer screens (wording only;
// every gate still runs on the raw state).
function plainState(state: string): string {
  if (state === "in_review") return "With the reviewer";
  if (state === "decided") return "Review finished";
  return state;
}

function diagLine(e: unknown): string {
  const d = (e as { diag?: unknown }).diag;
  return typeof d === "string" && /^[A-Za-z0-9:_. -]{1,80}$/.test(d) ? `<p class="muted">${esc(d)}</p>` : "";
}

function toLocalInput(d: Date): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

let flash = "";

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

function accessCode(): string {
  return (document.getElementById("f-code") as HTMLInputElement).value;
}

function codeHeaders(): Record<string, string> {
  const v = accessCode();
  try {
    sessionStorage.setItem("fp-code", v);
  } catch {
    // Private mode: the code simply does not persist.
  }
  return v === "" ? {} : { "x-requester-code": v };
}

function viewNew(el: HTMLElement): void {
  const dlDefault = toLocalInput(new Date(Date.now() + 24 * 3600 * 1000));
  el.innerHTML = `<h1>New collection</h1><p class="muted">How it works: create a mission, the worker photographs each box, the reviewer confirms.</p><div id="f-last"></div>
    <label>Site label<input id="f-site" type="text" value="Supplier dock A" /></label>
    <label>Expected code, box 1<input id="f-c1" type="text" value="B12" /></label>
    <label>Expected code, box 2<input id="f-c2" type="text" value="B17" /></label>
    <label>Expected code, box 3<input id="f-c3" type="text" value="B23" /></label>
    <label>Deadline<input id="f-dl" type="datetime-local" value="${dlDefault}" /></label>
    <label>Access code<input id="f-code" type="password" autocomplete="off" /></label>
    <label>Describe the check<textarea id="f-desc" rows="3" style="width:100%;box-sizing:border-box" placeholder="Verify lots B12 and B17 at Supplier dock A by Friday 6pm"></textarea></label>
    <button id="f-draft">Draft from description</button><div id="f-dmsg"></div>
    <button id="f-go" class="primary">Create mission</button><div id="f-out"></div>`;
  try {
    (document.getElementById("f-code") as HTMLInputElement).value = sessionStorage.getItem("fp-code") ?? "";
    const lastRaw = sessionStorage.getItem("fp-last");
    if (lastRaw !== null) {
      const last = JSON.parse(lastRaw) as { w?: unknown; r?: unknown };
      if (typeof last.w === "string" && typeof last.r === "string" && last.w !== "" && last.r !== "") {
        (document.getElementById("f-last") as HTMLElement).innerHTML =
          `<div class="card links"><p class="muted">Last mission links on this device:</p>` +
          `<p>Worker:</p><a href="${esc(last.w)}">${esc(last.w)}</a>` +
          `<p>Reviewer:</p><a href="${esc(last.r)}">${esc(last.r)}</a></div>`;
      }
    }
  } catch {
    // Private mode: start blank, no recovery card.
  }
  (document.getElementById("f-go") as HTMLButtonElement).onclick = async () => {
    const out = document.getElementById("f-out") as HTMLElement;
    const goBtn = document.getElementById("f-go") as HTMLButtonElement;
    if (goBtn.disabled) return;
    goBtn.disabled = true;
    try {
      const site = (document.getElementById("f-site") as HTMLInputElement).value;
      const codes = ["f-c1", "f-c2", "f-c3"].map((id) => (document.getElementById(id) as HTMLInputElement).value);
      const dlRaw = (document.getElementById("f-dl") as HTMLInputElement).value;
      const dlMs = Date.parse(dlRaw);
      if (!Number.isFinite(dlMs)) throw new Error("bad_deadline");
      const dl = new Date(dlMs).toISOString();
      const c = await calls.createMission(site, codes, dl, undefined, codeHeaders()) as { missionId: string; workerToken: string; reviewToken: string };
      const wl = workLink(window.location.origin, c.missionId, c.workerToken);
      const rl = reviewLink(window.location.origin, c.missionId, c.reviewToken);
      out.innerHTML = `<div class="card links"><p class="ok">Mission ${esc(shortId(c.missionId))} open.</p>
        <p>Worker link:</p><a href="${esc(wl)}">${esc(wl)}</a><button id="f-cw">Copy worker link</button>
        <p>Reviewer link:</p><a href="${esc(rl)}">${esc(rl)}</a><button id="f-cr">Copy reviewer link</button>
        <button id="f-again">Start another mission</button></div>`;
      const cw = document.getElementById("f-cw") as HTMLButtonElement;
      const cr = document.getElementById("f-cr") as HTMLButtonElement;
      cw.onclick = () => void copyText(wl).then(() => {
        cw.textContent = "Copied";
      });
      cr.onclick = () => void copyText(rl).then(() => {
        cr.textContent = "Copied";
      });
      try {
        sessionStorage.setItem("fp-last", JSON.stringify({ w: wl, r: rl }));
      } catch {
        // Private mode: no recovery card.
      }
      (document.getElementById("f-again") as HTMLButtonElement).onclick = () => viewNew(el);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      out.innerHTML = `<p class="err">${esc(m.includes("requester_code_denied") ? "Wrong access code" : m)}</p>`;
      goBtn.disabled = false;
    }
  };
  (document.getElementById("f-draft") as HTMLButtonElement).onclick = async () => {
    const fmsg = document.getElementById("f-dmsg") as HTMLElement;
    try {
      const desc = (document.getElementById("f-desc") as HTMLTextAreaElement).value;
      const r = await fetch("/.netlify/functions/agent-draft", {
        method: "POST",
        headers: { "content-type": "application/json", ...codeHeaders() },
        body: JSON.stringify({ description: desc }),
      });
      const j = (await r.json()) as { draft?: { siteLabel: string; expectedCodes: string[]; deadline: string }; error?: string };
      if (!r.ok) {
        const code = String(j.error ?? r.status);
        throw new Error(code.includes("requester_code_denied") ? "Wrong access code" : code);
      }
      const d = j.draft as { siteLabel: string; expectedCodes: string[]; deadline: string };
      (document.getElementById("f-site") as HTMLInputElement).value = d.siteLabel;
      for (let i = 0; i < 3; i++) {
        (document.getElementById(`f-c${i + 1}`) as HTMLInputElement).value = d.expectedCodes[i] ?? "";
      }
      (document.getElementById("f-dl") as HTMLInputElement).value = toLocalInput(new Date(d.deadline));
      fmsg.innerHTML = `<p class="ok">Draft: ${d.expectedCodes.map(esc).join(", ")} — check and edit, then Create mission.</p>`;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      fmsg.innerHTML = m.includes("model_http_")
        ? `<p class="err">AI draft unavailable - fill fields by hand.</p><p class="muted">${esc(m)}</p>`
        : errBox(e);
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
    const note = flash;
    flash = "";
    el.innerHTML = `<h1>Collection ${esc(shortId(missionId))}</h1>${note === "" ? "" : `<p class="ok">${esc(note)}</p>`}<p class="muted">Mission is ${esc(plainState(m.state))} — capture is closed.</p>`;
    return;
  }
  if (m.state !== "capturing") {
    el.innerHTML = `<h1>Collection</h1><p>${esc(m.siteLabel)}</p>
      <div class="card"><p>Consent: photos of the three labelled boxes are collected as delivery evidence and shown to the reviewer.</p>
      <label>Worker ID<input id="w-id" type="text" value="worker-1" /></label>
      <button id="w-ok" class="primary">Accept and start</button></div><div id="w-out"></div>`;
    (document.getElementById("w-ok") as HTMLButtonElement).onclick = async () => {
      const out = document.getElementById("w-out") as HTMLElement;
      const b = document.getElementById("w-ok") as HTMLButtonElement;
      if (b.disabled) return;
      b.disabled = true;
      try {
        await calls.consent(missionId, token, (document.getElementById("w-id") as HTMLInputElement).value);
        await render();
      } catch (e) {
        out.innerHTML = errBox(e);
      } finally {
        b.disabled = false;
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
  el.innerHTML = `<h1>Collection ${esc(shortId(missionId))}</h1><div id="w-items">${cards}</div>
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
          const head = el.querySelector(`[data-item="${it.itemId}"] > p`) as HTMLElement | null;
          if (head !== null) head.textContent = `${it.itemId} — unclear`;
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
        const m = e instanceof Error ? e.message : String(e);
        msg.innerHTML = m.includes("reader_unavailable")
          ? `<p class="err">The reading service did not respond - please take the photo again in a minute.</p>${diagLine(e)}`
          : errBox(e);
      }
    };
  }
  (document.getElementById("w-review") as HTMLButtonElement).onclick = async () => {
    const b = document.getElementById("w-review") as HTMLButtonElement;
    if (b.disabled) return;
    b.disabled = true;
    try {
      await calls.toReview(missionId, token);
      flash = "Sent for review.";
      await render();
    } catch (e) {
      (document.getElementById("w-out") as HTMLElement).innerHTML = errBox(e);
    } finally {
      b.disabled = false;
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
        samStatus?: { uploadId: string; status: string } | null;
      }>;
    };
  };
  const m = s.mission;
  if (m.state !== "in_review" && m.state !== "decided") {
    const photos = m.expected.filter((e) => m.observed[e.itemId]?.uploadId).length;
    el.innerHTML = `<h1>Review ${esc(shortId(missionId))}</h1><div class="card"><p>Waiting for worker — ${photos} of ${m.expected.length} photos so far.</p><button id="r-refresh">Refresh</button></div>`;
    (document.getElementById("r-refresh") as HTMLButtonElement).onclick = () => void render();
    return;
  }
  const cards: string[] = [];
  for (const e of m.expected) {
    const o = m.observed[e.itemId];
    cards.push(`<div class="card" data-item="${esc(e.itemId)}">
      <p><strong>${esc(e.itemId)}</strong> — expected ${esc(e.expectedLabel)}, observed ${esc(o.observedLabel ?? "—")} (${esc(o.readability)}, ${esc(o.state)})</p>
      <div data-photo="${esc(e.itemId)}"><p class="muted">Loading photo…</p></div>
      <div class="row"${m.state === "in_review" ? "" : " hidden"}><button data-yes="${esc(e.itemId)}">Confirm match</button><button data-no="${esc(e.itemId)}">Confirm mismatch</button></div>
      <button data-inc="${esc(e.itemId)}"${m.state === "in_review" ? "" : " hidden"}>Inconclusive</button><div data-msg="${esc(e.itemId)}"></div></div>`);
  }
  const note = flash;
  flash = "";
  el.innerHTML = `<h1>Review ${esc(shortId(missionId))}</h1>${note === "" ? "" : `<p class="ok">${esc(note)}</p>`}<p class="muted">Mission is ${esc(plainState(m.state))}</p>
    <div id="r-items">${cards.join("")}</div>
    <button id="r-finish" class="primary"${m.state === "in_review" ? "" : " hidden"}>Finish review</button>
    <button id="r-dl"${m.state === "decided" ? "" : " hidden"}>Download evidence pack (JSON)</button><div id="r-out"></div>`;
  for (const e of m.expected) {
    const o = m.observed[e.itemId];
    const slot = el.querySelector(`[data-photo="${e.itemId}"]`) as HTMLElement;
    if (o.uploadId) {
      try {
        const blob = await evidenceBlob(missionId, o.uploadId, token);
        const u = URL.createObjectURL(blob);
        revoked.push(u);
        const b = o.labelBox ?? null;
        const sam = o.samStatus?.status ?? "";
        slot.innerHTML = b !== null
          ? `<div style="position:relative"><img src="${u}" alt="evidence ${esc(e.itemId)}" style="width:100%" /><div style="position:absolute;left:${b.x1 * 100}%;top:${b.y1 * 100}%;width:${Math.max(0, b.x2 - b.x1) * 100}%;height:${Math.max(0, b.y2 - b.y1) * 100}%;border:3px solid #0a0;box-sizing:border-box"><span style="background:#0a0;color:#fff;font-size:.8rem">AI-located label</span></div></div>`
          : sam === "none"
            ? `<img src="${u}" alt="evidence ${esc(e.itemId)}" /><p class="muted">AI box: none found</p>`
            : sam.startsWith("sam:")
              ? `<img src="${u}" alt="evidence ${esc(e.itemId)}" /><p class="muted">AI box unavailable (${esc(sam)})</p>`
              : `<img src="${u}" alt="evidence ${esc(e.itemId)}" />`;
      } catch {
        slot.innerHTML = `<p class="err">Photo unavailable.</p>`;
      }
    } else slot.innerHTML = `<p class="muted">No photo yet.</p>`;
    const msg = el.querySelector(`[data-msg="${e.itemId}"]`) as HTMLElement;
    const decide = async (decision: string) => {
      const btns = [`[data-yes="${e.itemId}"]`, `[data-no="${e.itemId}"]`, `[data-inc="${e.itemId}"]`]
        .map((s) => el.querySelector(s) as HTMLButtonElement | null)
        .filter((b): b is HTMLButtonElement => b !== null);
      if (btns.some((b) => b.disabled)) return;
      btns.forEach((b) => {
        b.disabled = true;
      });
      try {
        await calls.decide(missionId, token, e.itemId, decision);
        msg.innerHTML = `<p class="ok">Recorded: ${esc(decision)}.</p>`;
      } catch (err) {
        msg.innerHTML = errBox(err);
      } finally {
        btns.forEach((b) => {
          b.disabled = false;
        });
      }
    };
    (el.querySelector(`[data-yes="${e.itemId}"]`) as HTMLButtonElement).onclick = () => void decide("confirmed_match");
    (el.querySelector(`[data-no="${e.itemId}"]`) as HTMLButtonElement).onclick = () => void decide("confirmed_mismatch");
    (el.querySelector(`[data-inc="${e.itemId}"]`) as HTMLButtonElement).onclick = () => void decide("inconclusive");
  }
  (document.getElementById("r-finish") as HTMLButtonElement).onclick = async () => {
    const b = document.getElementById("r-finish") as HTMLButtonElement;
    if (b.disabled) return;
    b.disabled = true;
    try {
      await calls.finishReview(missionId, token);
      flash = "Review finished.";
      await render();
    } catch (e) {
      (document.getElementById("r-out") as HTMLElement).innerHTML = errBox(e);
    } finally {
      b.disabled = false;
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
