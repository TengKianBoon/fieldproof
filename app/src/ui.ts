// S2b phone UI router: #/new (requester), #/work/<mission>/<token> (worker),
// #/review/<mission>/<token> (reviewer). Tokens live in the URL FRAGMENT:
// never sent to the server, never logged, never in query strings. Photo
// evidence loads via evidence-get + blob URLs, revoked on every re-render.
import "./buffer-shim.ts";
import "./ui.css";
import { parseHashRoute, workLink, reviewLink, shrinkPhoto, uploadPhoto, evidenceBlob, calls } from "./client.ts";
import { buildReport, plainItem, plainState, plainWorkerItem, reportDocument } from "./report.ts";

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

// S11a wrong-code message: client-entered character count only — never the
// expected length or either value.
function wrongCodeMsg(): string {
  const n = accessCode().length;
  return `Wrong access code (${n} character${n === 1 ? "" : "s"} entered)`;
}

// Task 0b stale-item message: finished items refuse server-side; the worker
// gets refresh guidance, never a raw error code.
function staleItemMsg(m: string): string | null {
  return (m.includes("item_done") || m.includes("bad_item_state"))
    ? "This item already has a photo — refresh the page to see its current state."
    : null;
}

function viewNew(el: HTMLElement): void {
  const dlDefault = toLocalInput(new Date(Date.now() + 24 * 3600 * 1000));
  el.innerHTML = `<h1>New collection</h1><p class="muted">How it works: create a mission, the worker photographs each box, the reviewer confirms.</p><div id="f-last"></div>
    <label>Site label<input id="f-site" type="text" value="Supplier dock A" /></label>
    <div id="f-codes"></div>
    <button id="f-add">Add another box</button>
    <label>Deadline<input id="f-dl" type="datetime-local" value="${dlDefault}" /></label>
    <p>Deadline time zone (required, choose one): <span id="f-tzrow"></span></p>
    <label>Access code<input id="f-code" type="password" autocomplete="off" /></label>
    <label><input id="f-show" type="checkbox" style="width:auto" /> Show code</label>
    <label>Describe the check<textarea id="f-desc" rows="3" style="width:100%;box-sizing:border-box" placeholder="Verify lots B12 and B17 at Supplier dock A by Friday 6pm"></textarea></label>
    <button id="f-draft">Draft from description</button><div id="f-dmsg"></div>
    <label>Delivery note photo<input id="f-note" type="file" accept="image/*" /></label>
    <button id="f-notedraft">Draft from delivery note</button>
    <div id="f-nprev"></div><div id="f-nmsg"></div><div id="f-nfields"></div>
    <label><input id="f-confirm" type="checkbox" style="width:auto" /> I checked every field against the note photo</label>
    <button id="f-go" class="primary">Create mission</button><div id="f-out"></div>`;
  // Dynamic code rows, 1-10. The server assigns box1..N and validates.
  const codeRows = (values: string[]): void => {
    const box = document.getElementById("f-codes") as HTMLElement;
    const vals = values.slice(0, 10);
    box.innerHTML = vals.map((v, i) =>
      `<label>Expected code, box ${i + 1}<input class="f-code-in" type="text" value="${esc(v)}" /></label>`).join("")
      + (vals.length > 1 ? `<button id="f-rm">Remove last box</button>` : "");
    const rm = document.getElementById("f-rm") as HTMLButtonElement | null;
    if (rm !== null) rm.onclick = () => codeRows(codeValues().slice(0, -1));
  };
  const codeValues = (): string[] =>
    Array.from(document.querySelectorAll(".f-code-in") as NodeListOf<HTMLInputElement>).map((i) => i.value);
  codeRows(["B12", "B17", "B23"]);
  // Task 0: explicit zone choice, neither preselected. The device zone name
  // comes from the browser; the server re-validates whatever arrives, so a
  // model-supplied zone is never trusted here.
  let noteZone: string | null = null;
  const deviceZone = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    } catch {
      return "UTC";
    }
  })();
  const zoneValid = (z: string): boolean => {
    if (/^[+-]\d{2}:?\d{2}$/.test(z)) return true;
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: z }).format(0);
      return true;
    } catch {
      return false;
    }
  };
  const paintTz = (): void => {
    (document.getElementById("f-tzrow") as HTMLElement).innerHTML =
      `<label><input type="radio" name="f-tz" value="device" /> Device (${esc(deviceZone)})</label> ` +
      `<label><input type="radio" name="f-tz" value="utc" /> UTC</label>` +
      (noteZone === null ? "" : ` <label><input type="radio" name="f-tz" value="note" /> Note's zone (${esc(noteZone)})</label>`);
  };
  paintTz();
  const selectedTz = (): string | null => {
    const c = document.querySelector('input[name="f-tz"]:checked') as HTMLInputElement | null;
    if (c === null) return null;
    if (c.value === "device") return deviceZone;
    if (c.value === "utc") return "UTC";
    return noteZone;
  };
  (document.getElementById("f-add") as HTMLButtonElement).onclick = () => {
    const v = codeValues();
    if (v.length >= 10) return;
    codeRows([...v, ""]);
  };
  // Note-draft confirmation gate: armed by a note draft, cleared by render.
  let notePending = false;
  const confirmBox = document.getElementById("f-confirm") as HTMLInputElement;
  try {
    (document.getElementById("f-code") as HTMLInputElement).value = sessionStorage.getItem("fp-code") ?? "";
    // Show-code toggle: unchecked (masked) every render, never persisted.
    (document.getElementById("f-show") as HTMLInputElement).onchange = (ev) => {
      (document.getElementById("f-code") as HTMLInputElement).type =
        (ev.target as HTMLInputElement).checked ? "text" : "password";
    };
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
      if (notePending && !confirmBox.checked) throw new Error("note_unconfirmed");
      const site = (document.getElementById("f-site") as HTMLInputElement).value;
      const codes = codeValues().map((c) => c.trim()).filter((c) => c !== "");
      if (codes.length < 1) throw new Error("need_one_code");
      const dlRaw = (document.getElementById("f-dl") as HTMLInputElement).value;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dlRaw)) throw new Error("bad_deadline");
      // Task 0: the raw wall time plus the explicit zone choice go to the
      // server, which does the real wall-to-instant conversion.
      const tz = selectedTz();
      if (tz === null) throw new Error("need_timezone");
      const c = await calls.createMission(site, codes, dlRaw.slice(0, 16), undefined, codeHeaders(), tz) as { missionId: string; workerToken: string; reviewToken: string };
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
      const friendly = m.includes("requester_code_denied") ? wrongCodeMsg()
        : m.includes("note_unconfirmed") ? "Check the draft against the note photo and tick confirmation first."
        : m.includes("need_one_code") ? "Enter at least one expected code."
        : (m.includes("need_timezone") || m.includes("timezone_required")) ? "Choose a time zone for the deadline."
        : m.includes("bad_zone") ? "That time zone is not supported — pick device or UTC."
        : m;
      out.innerHTML = `<p class="err">${esc(friendly)}</p>`;
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
        throw new Error(code.includes("requester_code_denied") ? wrongCodeMsg() : code);
      }
      const d = j.draft as { siteLabel: string; expectedCodes: string[]; deadline: string };
      (document.getElementById("f-site") as HTMLInputElement).value = d.siteLabel;
      codeRows(d.expectedCodes.slice(0, 10));
      (document.getElementById("f-dl") as HTMLInputElement).value = toLocalInput(new Date(d.deadline));
      noteZone = null;
      document.querySelectorAll('input[name="f-tz"]').forEach((r) => { (r as HTMLInputElement).checked = false; });
      fmsg.innerHTML = `<p class="ok">Draft: ${d.expectedCodes.map(esc).join(", ")} — check and edit, pick a time zone, then Create mission.</p>`;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      fmsg.innerHTML = m.includes("model_http_")
        ? `<p class="err">AI draft unavailable - fill fields by hand.</p><p class="muted">${esc(m)}</p>`
        : errBox(e);
    }
  };
  (document.getElementById("f-notedraft") as HTMLButtonElement).onclick = async () => {
    const nmsg = document.getElementById("f-nmsg") as HTMLElement;
    const nprev = document.getElementById("f-nprev") as HTMLElement;
    const nfields = document.getElementById("f-nfields") as HTMLElement;
    const b = document.getElementById("f-notedraft") as HTMLButtonElement;
    if (b.disabled) return;
    b.disabled = true;
    try {
      const f = (document.getElementById("f-note") as HTMLInputElement).files?.[0];
      if (!f) throw new Error("no_note_photo");
      const small = await shrinkPhoto(f);
      let bin = "";
      for (let i = 0; i < small.length; i += 8192) {
        bin += String.fromCharCode(...small.subarray(i, i + 8192));
      }
      const r = await fetch("/.netlify/functions/delivery-note-draft", {
        method: "POST",
        headers: { "content-type": "application/json", ...codeHeaders() },
        body: JSON.stringify({ imageB64: btoa(bin) }),
      });
      const j = (await r.json()) as {
        draft?: {
          siteLabel: { value: string; snippet: string };
          codes: Array<{ value: string; snippet: string }>;
          deadline: { value: string; snippet: string };
          timezone: { value: string | null; snippet: string };
        };
        error?: string;
      };
      if (!r.ok) {
        const code = String(j.error ?? r.status);
        throw new Error(code.includes("requester_code_denied") ? wrongCodeMsg() : code);
      }
      const d = j.draft as {
        siteLabel: { value: string; snippet: string };
        codes: Array<{ value: string; snippet: string }>;
        deadline: { value: string; snippet: string };
        timezone: { value: string | null; snippet: string };
      };
      const pu = URL.createObjectURL(new Blob([small.slice().buffer as ArrayBuffer], { type: "image/jpeg" }));
      revoked.push(pu);
      nprev.innerHTML = `<img src="${pu}" alt="delivery note preview" />`;
      (document.getElementById("f-site") as HTMLInputElement).value = d.siteLabel.value;
      codeRows(d.codes.map((c) => c.value).slice(0, 10));
      // Task 0: a zone-less draft deadline stays a wall time — never run it
      // through the device zone. A validated model zone becomes a third,
      // still unselected, choice; the server re-validates it at Create.
      const dw = d.deadline.value;
      (document.getElementById("f-dl") as HTMLInputElement).value =
        /([zZ]|[+-]\d{2}:?\d{2}|[+-]\d{4})$/.test(dw) ? toLocalInput(new Date(dw)) : dw.slice(0, 16);
      noteZone = d.timezone.value !== null && zoneValid(d.timezone.value) ? d.timezone.value : null;
      paintTz();
      const snip = (label: string, s: string): string =>
        `<p class="muted">${esc(label)}: ${s === "" ? "source unknown" : `“${esc(s)}”`}</p>`;
      nfields.innerHTML = snip("Site", d.siteLabel.snippet)
        + d.codes.map((c, i) => snip(`Box ${i + 1}`, c.snippet)).join("")
        + snip("Deadline", d.deadline.snippet)
        + `<p class="muted">Time zone: ${d.timezone.value === null ? "unknown — choose device or UTC below" : esc(d.timezone.value) + (noteZone === null ? " (not recognised — choose device or UTC below)" : " (listed below — select it to use it)")}</p>`
        + `<p class="muted">Snippets quote what the model read — check them against the photo yourself. Snippet agreement is not independent verification.</p>`;
      notePending = true;
      confirmBox.checked = false;
      nmsg.innerHTML = `<p class="ok">Draft ready — check every field against the photo, tick confirmation, then Create mission.</p>`;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      nmsg.innerHTML = m.includes("no_note_photo") ? `<p class="err">Choose a delivery-note photo first.</p>`
        : m.includes("model_http_") ? `<p class="err">Delivery-note draft unavailable - fill fields by hand.</p><p class="muted">${esc(m)}</p>`
        : errBox(e);
    } finally {
      b.disabled = false;
    }
  };
}

interface BriefItem {
  itemId: string;
  state: string;
}

// Guided-capture position: persists across viewWork re-renders so a worker
// keeps their place after each photo; reset whenever the mission changes.
let workMission = "";
let workIndex = 0;

async function viewWork(el: HTMLElement, missionId: string, token: string): Promise<void> {
  const s = await calls.state(missionId, token) as {
    mission: { state: string; siteLabel: string; items: BriefItem[] };
  };
  const m = s.mission;
  if (m.state !== "capturing" && m.state !== "open" && m.state !== "consented") {
    const note = flash;
    flash = "";
    el.innerHTML = `<h1>Collection ${esc(shortId(missionId))}</h1>${note === "" ? "" : `<p class="ok">${esc(note)}</p>`}<p class="muted">Status: ${esc(plainState(m.state))} — capture is closed.</p>`;
    return;
  }
  if (m.state !== "capturing") {
    el.innerHTML = `<h1>Collection</h1><p>${esc(m.siteLabel)}</p>
      <div class="card"><p>Consent: photos of each labelled box are collected as delivery evidence and shown to the reviewer.</p>
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
  // Guided capture: one item at a time ("Item k of N") with previous/next.
  // Headings show photo-words only, so readings never leak to the worker.
  if (workMission !== missionId) {
    workMission = missionId;
    workIndex = 0;
  }
  if (workIndex >= m.items.length) workIndex = 0;
  if (workIndex < 0) workIndex = 0;
  const k = workIndex;
  const cur = m.items[k];
  // Task 0b: finished items show no capture controls — only the done note
  // with Next / Send-for-review guidance.
  const finished = cur.state === "matched" || cur.state === "mismatched" || cur.state === "inconclusive";
  const card = `<div class="card" data-item="${esc(cur.itemId)}">
      <p><strong>${esc(cur.itemId)}</strong> — ${esc(plainWorkerItem(cur.state))}</p>
      ${finished
        ? `<p class="muted">Photo received - this item is done. Continue with Next, or Send for review when every item shows Photo received.</p>`
        : `<input type="file" accept="image/*" capture="environment" data-photo="${esc(cur.itemId)}" />
      <button data-shoot="${esc(cur.itemId)}" class="primary">Take photo</button>`}
      <div data-msg="${esc(cur.itemId)}"></div></div>`;
  const allDone = m.items.every((it) => it.state === "matched" || it.state === "mismatched" || it.state === "inconclusive");
  el.innerHTML = `<h1>Collection ${esc(shortId(missionId))}</h1><p class="muted">Item ${k + 1} of ${m.items.length}</p><div id="w-items">${card}</div>
    <div class="row"><button id="w-prev"${k === 0 ? " disabled" : ""}>Previous</button><button id="w-next"${k === m.items.length - 1 ? " disabled" : ""}>Next</button></div>
    <button id="w-review" class="primary" ${allDone ? "" : "disabled"}>Send for review</button><div id="w-out"></div>`;
  (document.getElementById("w-prev") as HTMLButtonElement).onclick = () => {
    workIndex = k - 1;
    void render();
  };
  (document.getElementById("w-next") as HTMLButtonElement).onclick = () => {
    workIndex = k + 1;
    void render();
  };
  // Finished items render no controls, so there is nothing to wire.
  for (const it of finished ? [] : [cur]) {
    const btn = el.querySelector(`[data-shoot="${it.itemId}"]`) as HTMLButtonElement;
    const inp = el.querySelector(`[data-photo="${it.itemId}"]`) as HTMLInputElement;
    const msg = el.querySelector(`[data-msg="${it.itemId}"]`) as HTMLElement;
    btn.onclick = () => inp.click();
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      // No duplicate taps while an upload is in flight.
      if (btn.disabled) return;
      btn.disabled = true;
      inp.disabled = true;
      msg.innerHTML = `<p class="muted">Uploading…</p>`;
      try {
        const small = await shrinkPhoto(f);
        const attempt = `a${Date.now()}`;
        const up = await uploadPhoto(missionId, token, it.itemId, attempt, `${it.itemId}-${attempt}`, small);
        const cap = await calls.capture(missionId, token, it.itemId, up.uploadId) as { state: string };
        if (cap.state === "unclear") {
          const head = el.querySelector(`[data-item="${it.itemId}"] > p`) as HTMLElement | null;
          if (head !== null) head.textContent = `${it.itemId} — ${plainItem("unclear")}`;
          msg.innerHTML = `<p>Label unclear — take a close-up (at most 2), then it goes inconclusive.</p>
            <button data-cu="${esc(it.itemId)}">Request close-up</button>`;
          (msg.querySelector(`[data-cu="${it.itemId}"]`) as HTMLButtonElement).onclick = async () => {
            try {
              await calls.closeup(missionId, token, it.itemId);
              msg.innerHTML = `<p class="ok">Close-up requested — take another photo above.</p>`;
            } catch (e) {
              const cm = String((e as Error).message);
              const stale = staleItemMsg(cm);
              if (stale !== null) msg.innerHTML = `<p class="err">${esc(stale)}</p>`;
              else if (cm.includes("closeup_exhausted")) {
                await calls.inconclusive(missionId, token, it.itemId);
                await render();
              } else msg.innerHTML = errBox(e);
            }
          };
        } else {
          msg.innerHTML = `<p class="ok">Photo received.</p>`;
          await render();
        }
      } catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        const stale = staleItemMsg(m);
        msg.innerHTML = stale !== null ? `<p class="err">${esc(stale)}</p>`
          : m.includes("reader_unavailable")
            ? `<p class="err">The reading service did not respond - please take the photo again in a minute.</p>${diagLine(e)}`
            : errBox(e);
      } finally {
        btn.disabled = false;
        inp.disabled = false;
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
      siteLabel: string;
      deadline: string;
      createdAt: string;
      expected: Array<{ itemId: string; expectedLabel: string }>;
      observed: Record<string, {
        observedLabel: string | null; readability: string; state: string; uploadId: string | null;
        serverHash: string | null;
        labelBox?: { x1: number; y1: number; x2: number; y2: number; confidence: number } | null;
        samStatus?: { uploadId: string; status: string } | null;
      }>;
      reviewerDecision: Record<string, string>;
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
      <p><strong>${esc(e.itemId)}</strong> — expected ${esc(e.expectedLabel)}, observed ${esc(o.observedLabel ?? "—")} (${esc(o.readability)}, ${esc(plainItem(o.state))})</p>
      <div data-photo="${esc(e.itemId)}"><p class="muted">Loading photo…</p></div>
      <div class="row"${m.state === "in_review" ? "" : " hidden"}><button data-yes="${esc(e.itemId)}">Confirm match</button><button data-no="${esc(e.itemId)}">Confirm mismatch</button></div>
      <button data-inc="${esc(e.itemId)}"${m.state === "in_review" ? "" : " hidden"}>Inconclusive</button><div data-msg="${esc(e.itemId)}"></div></div>`);
  }
  const note = flash;
  flash = "";
  el.innerHTML = `<h1>Review ${esc(shortId(missionId))}</h1>${note === "" ? "" : `<p class="ok">${esc(note)}</p>`}<p class="muted">Status: ${esc(plainState(m.state))}</p>
    <div id="r-items">${cards.join("")}</div>
    <button id="r-finish" class="primary"${m.state === "in_review" ? "" : " hidden"}>Finish review</button>
    <button id="r-dl"${m.state === "decided" ? "" : " hidden"}>Download evidence pack (JSON)</button>
    <button id="r-print">Print report</button><div id="r-out"></div>`;
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
        msg.innerHTML = `<p class="ok">Recorded: ${esc(plainItem(decision))}.</p>`;
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
  // Stage 1a remedy: the printable report lives in an isolated popup
  // document (about:blank URL), so this page's reviewer bearer token never
  // reaches the printout or browser headers/footers. Review state here is
  // untouched. Printing gates on every evidence image decoding (or honestly
  // failing) within a bound.
  (document.getElementById("r-print") as HTMLButtonElement).onclick = async () => {
    const b = document.getElementById("r-print") as HTMLButtonElement;
    if (b.disabled) return;
    b.disabled = true;
    try {
      // Open synchronously inside the click: phone browsers drop user
      // activation across awaits, which would force-block the popup.
      const w = window.open("", "_blank");
      if (w === null) {
        (document.getElementById("r-out") as HTMLElement).innerHTML =
          `<p class="err">Popup blocked — allow popups to print the report.</p>`;
        return;
      }
      try {
        // Device timezone for display; the raw record value stays alongside.
        let deviceTz = "UTC";
        try {
          deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
        } catch {
          deviceTz = "UTC";
        }
        const data = buildReport({ ...m, missionId }, deviceTz);
        const urls: Array<string | null> = [];
        for (const e of m.expected) {
          const rec = m.observed[e.itemId] as { uploadId: string | null } | undefined;
          const uid = rec?.uploadId ?? null;
          if (uid === null || uid === "") {
            urls.push(null);
            continue;
          }
          try {
            const blob = await evidenceBlob(missionId, uid, token);
            const u = URL.createObjectURL(blob);
            revoked.push(u);
            urls.push(u);
          } catch {
            urls.push(null);
          }
        }
        w.document.write(reportDocument(data, urls));
        w.document.close();
        await waitReportImages(w.document);
        w.print();
      } catch (e) {
        w.close();
        throw e;
      }
    } catch (e) {
      (document.getElementById("r-out") as HTMLElement).innerHTML = errBox(e);
    } finally {
      b.disabled = false;
    }
  };
}

// Bounded image readiness gate for the print popup: resolves once every
// image has decoded, failed, or its bound elapsed; undecodable images become
// the honest placeholder before printing.
function waitReportImages(doc: Document): Promise<void> {
  const imgs = Array.from(doc.querySelectorAll("img"));
  return Promise.all(imgs.map((img) => new Promise<void>((resolve) => {
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      if (!ok) {
        const p = doc.createElement("p");
        p.className = "err";
        p.textContent = `Photo unavailable (${img.alt}).`;
        img.replaceWith(p);
      }
      resolve();
    };
    if (img.complete) {
      done(img.naturalWidth > 0);
      return;
    }
    img.addEventListener("load", () => done(img.naturalWidth > 0), { once: true });
    img.addEventListener("error", () => done(false), { once: true });
    window.setTimeout(() => done(img.complete && img.naturalWidth > 0), 8000);
  }))).then(() => undefined);
}
