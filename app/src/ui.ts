// S2b phone UI router: #/new (requester), #/work/<mission>/<token> (worker),
// #/review/<mission>/<token> (reviewer). Tokens live in the URL FRAGMENT:
// never sent to the server, never logged, never in query strings. Photo
// evidence loads via evidence-get + blob URLs, revoked on every re-render.
import "./buffer-shim.ts";
import "./ui.css";
import { parseHashRoute, workLink, reviewLink, jobOwnerLink, jobBidLink, shrinkPhoto, uploadPhoto, evidenceBlob, calls, BRIEF_LEAK_MESSAGE, briefLeakTarget } from "./client.ts";
import { buildGlassesHUD, GLASSES_LABEL } from "./glasses.ts";
import { jobErrorWords, jobInstant, jobWhen, renderBid, renderClaim, renderJobForm, renderOwner } from "./jobsView.ts";
import type { BidderCheck, BidderJobView, OwnerCheck } from "./jobsView.ts";
import type { FieldJob } from "../shared/fieldJobs.ts";
import { landingHTML } from "./landing.ts";
import { suggestReview } from "../shared/suggest.ts";
import { buildReport, plainCheckin, plainItem, plainState, plainWorkerItem, reportDocument } from "./report.ts";
import { summarizeReview, summaryLines } from "../shared/reviewSummary.ts";
import { briefOutOfDate } from "./briefStale.ts";
import { geoFromMission, locationSectionHtml, osmIframe, type GeoView } from "./locationMap.ts";

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
  if (!window.location.hash) window.location.hash = "#/";
  void render();
}

async function render(): Promise<void> {
  dropUrls();
  const r = parseHashRoute(window.location.hash);
  const el = app();
  // R1: the landing has its own top bar, so the page-shell heading hides there.
  const shellH1 = document.querySelector("body > h1") as HTMLElement | null;
  if (shellH1 !== null) shellH1.hidden = r.name === "landing";
  try {
    if (r.name === "landing") viewLanding(el);
    else if (r.name === "new") viewNew(el);
    else if (r.name === "work") await viewWork(el, r.missionId, r.token);
    else if (r.name === "glasses") await viewGlasses(el, r.missionId, r.token);
    else if (r.name === "jobsNew") viewJobsNew(el);
    else if (r.name === "jobOwner") await viewJobOwner(el, r.jobId, r.token);
    else if (r.name === "jobBid") await viewJobBid(el, r.jobId, r.token);
    else if (r.name === "jobClaim") viewJobClaim(el, r.jobId);
    else if (r.name === "review") await viewReview(el, r.missionId, r.token);
    else el.innerHTML = `<h1>FieldProof</h1><p class="err">Unknown link. Ask the client for a fresh field professional or client link.</p>`;
  } catch (e) {
    el.innerHTML = `<h1>FieldProof</h1>${errBox(e)}`;
  }
}

async function viewLanding(el: HTMLElement): Promise<void> {
  // F2: static presentation only - no fetch, no tokens, no behavior.
  el.innerHTML = landingHTML();
  // J2b: the main buttons work at once, before (and whatever happens to)
  // the optional health check below.
  (document.getElementById("l-start") as HTMLButtonElement).onclick = () => {
    window.location.hash = "#/new";
  };
  (document.getElementById("l-how") as HTMLButtonElement).onclick = () => {
    document.getElementById("l-steps")?.scrollIntoView();
  };
  // J2: one additive exception to the static landing — a "Post a job
  // (pilot)" link appears only when health reports jobsEnabled: true.
  try {
    const hr = await fetch("/.netlify/functions/health", { signal: AbortSignal.timeout(4000) });
    const hh = (await hr.json()) as { jobsEnabled?: unknown };
    const hero = el.querySelector(".hero");
    if (hr.ok && hh.jobsEnabled === true && hero !== null && hero.isConnected && document.getElementById("l-jobs") === null) {
      const a = document.createElement("a");
      a.id = "l-jobs";
      a.href = "#/jobs/new";
      a.textContent = "Post a job (pilot)";
      hero.appendChild(a);
    }
  } catch {
    // Health unreachable or slow: no jobs link. The landing stays as-is.
  }
}

// F2 chips: worker states stay neutral words; client states carry the
// comparison meaning. Presentation only - gates compare raw codes.
function workerChip(state: string): string {
  return `<span class="chip">${esc(plainWorkerItem(state))}</span>`;
}

function clientChip(state: string): string {
  const cls = state === "matched" || state === "confirmed_match" ? "chip-ok"
    : state === "mismatched" || state === "confirmed_mismatch" ? "chip-bad"
    : "chip-warn";
  return `<span class="chip ${cls}">${esc(plainItem(state))}</span>`;
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

// L2 requester copy for a rejected site reference; every form input keeps
// its current value because failures never re-render the form.
const LOC_MSG = "Check the site latitude (-90 to 90), longitude (-180 to 180), and radius (whole metres, 10 to 50000).";
const CHECKIN_NOTE = "Device location at check-in. Not the photo capture location, and not proof of attendance.";

// Coordinate-free check-in summary for client surfaces. Accepts the stored
// record or the public view; latitude/longitude are never read here.
interface CheckinView {
  status: string;
  distanceM: number | null;
  accuracyM: number;
  fixTime: string;
  stale: boolean;
  lowAccuracy: boolean;
}

function viewCheckin(v: unknown): CheckinView | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  const f = (typeof o.fix === "object" && o.fix !== null ? o.fix : o) as Record<string, unknown>;
  if (typeof f.status !== "string" || typeof f.fixTime !== "string") return null;
  if (typeof f.accuracyM !== "number") return null;
  return {
    status: f.status,
    distanceM: typeof f.distanceM === "number" ? f.distanceM : null,
    accuracyM: f.accuracyM,
    fixTime: f.fixTime,
    stale: f.stale === true,
    lowAccuracy: f.lowAccuracy === true,
  };
}

function ageWords(fixMs: number, nowMs: number): string {
  if (!Number.isFinite(fixMs)) return "unknown age";
  const s = Math.max(0, Math.round((nowMs - fixMs) / 1000));
  if (s < 60) return `${s} sec`;
  const mm = Math.floor(s / 60);
  if (mm < 60) return `${mm} min`;
  return `${Math.floor(mm / 60)} hr ${mm % 60} min`;
}

function checkinCard(v: unknown, geo: GeoView | null = null): string {
  const c = viewCheckin(v);
  if (c === null) return "";
  // M1: reviewer only - coordinates, Google Maps link, a drawn diagram and
  // an on-request OpenStreetMap view (built from numbers only).
  const loc = geo === null ? null : locationSectionHtml(geo, false);
  return `<div class="card" id="r-checkin"><p><strong>Check-in</strong> — ${esc(plainCheckin(c.status))}${c.distanceM === null ? "" : ` (${Math.round(c.distanceM)} m)`} · accuracy ±${Math.round(c.accuracyM)} m${c.stale ? " · stale" : ""}${c.lowAccuracy ? " · low accuracy" : ""}</p>`
    + `<p class="muted">Fix ${esc(jobWhen(c.fixTime))} (${esc(ageWords(Date.parse(c.fixTime), Date.now()))} old).</p><p class="muted">${esc(CHECKIN_NOTE)}</p>${loc ?? ""}</div>`;
}

// M1: the live map loads only when asked (no third-party request otherwise).
function bindMapButton(geo: GeoView): void {
  const b = document.getElementById("r-map") as HTMLButtonElement | null;
  const box = document.getElementById("r-mapbox") as HTMLElement | null;
  if (b === null || box === null) return;
  b.onclick = () => {
    const f = osmIframe(geo);
    if (f !== null) box.innerHTML = f;
    b.hidden = true;
  };
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
  el.innerHTML = `<h1>Client — New collection</h1><p class="muted">How it works: create a mission, the worker photographs each box, the reviewer confirms.</p><div id="f-last"></div>
    <label>Site label<input id="f-site" type="text" value="Supplier dock A" /></label>
    <div id="f-codes"></div>
    <button id="f-add">Add another box</button>
    <label>Job title (optional, at most 80 characters)<input id="f-title" type="text" maxlength="80" placeholder="Morning collection run" /></label><div id="f-title-err"></div>
    <label>Role (optional, at most 60 characters)<input id="f-role" type="text" maxlength="60" placeholder="Dock pickup" /></label><div id="f-role-err"></div>
    <label>Instructions for the field professional (optional, at most 600 characters)<textarea id="f-instructions" rows="3" maxlength="600" style="width:100%;box-sizing:border-box" placeholder="Call on arrival; photograph each label straight on"></textarea></label><div id="f-instructions-err"></div>
    <label>Site latitude (optional, -90 to 90)<input id="f-lat" type="text" inputmode="decimal" placeholder="1.3521" /></label>
    <label>Site longitude (optional, -180 to 180)<input id="f-lon" type="text" inputmode="decimal" placeholder="103.8198" /></label>
    <label>Site radius in metres (optional, 10 to 50000)<input id="f-radius" type="text" inputmode="numeric" placeholder="150" /></label><div id="f-loc-err"></div>
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
  // Each row also carries an optional per-item photo tip (at most 120
  // characters); both columns survive add/remove together.
  const codeRows = (values: string[], hints: string[] = []): void => {
    const box = document.getElementById("f-codes") as HTMLElement;
    const vals = values.slice(0, 10);
    box.innerHTML = vals.map((v, i) =>
      `<label>Expected code, box ${i + 1}<input class="f-code-in" type="text" value="${esc(v)}" /></label>` +
      `<label>Photo tip, box ${i + 1} (optional, at most 120 characters)<input class="f-hint-in" type="text" maxlength="120" value="${esc(hints[i] ?? "")}" /></label>` +
      `<div id="f-hint-err-${i}"></div>`).join("")
      + (vals.length > 1 ? `<button id="f-rm">Remove last box</button>` : "");
    const rm = document.getElementById("f-rm") as HTMLButtonElement | null;
    if (rm !== null) rm.onclick = () => codeRows(codeValues().slice(0, -1), hintValues().slice(0, -1));
  };
  const codeValues = (): string[] =>
    Array.from(document.querySelectorAll(".f-code-in") as NodeListOf<HTMLInputElement>).map((i) => i.value);
  const hintValues = (): string[] =>
    Array.from(document.querySelectorAll(".f-hint-in") as NodeListOf<HTMLInputElement>).map((i) => i.value);
  // F1c: clears every brief inline error; stale messages never survive a
  // new attempt or a success.
  const clearBriefErrors = (): void => {
    for (const id of ["f-title-err", "f-role-err", "f-instructions-err", "f-loc-err"]) {
      const d = document.getElementById(id);
      if (d !== null) d.innerHTML = "";
    }
    document.querySelectorAll('[id^="f-hint-err-"]').forEach((d) => { d.innerHTML = ""; });
  };
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
    codeRows([...v, ""], [...hintValues(), ""]);
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
          `<p>Field professional:</p><a href="${esc(last.w)}">${esc(last.w)}</a>` +
          `<p>Client:</p><a href="${esc(last.r)}">${esc(last.r)}</a></div>`;
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
      // Stage 2b-2: stale messages never survive a new attempt or a success.
      out.innerHTML = "";
      (document.getElementById("f-nmsg") as HTMLElement).innerHTML = "";
      (document.getElementById("f-dmsg") as HTMLElement).innerHTML = "";
      clearBriefErrors();
      if (notePending && !confirmBox.checked) throw new Error("note_unconfirmed");
      const site = (document.getElementById("f-site") as HTMLInputElement).value;
      // F1c: codes and per-row tips are zipped before empty codes are
      // dropped, so each tip stays on its own box.
      const rows = codeValues().map((c, i) => ({ code: c.trim(), hint: (hintValues()[i] ?? "").trim() }))
        .filter((r) => r.code !== "");
      if (rows.length < 1) throw new Error("need_one_code");
      const codes = rows.map((r) => r.code);
      const hints = rows.map((r) => (r.hint === "" ? undefined : r.hint));
      const brief = {
        title: (document.getElementById("f-title") as HTMLInputElement).value,
        role: (document.getElementById("f-role") as HTMLInputElement).value,
        instructions: (document.getElementById("f-instructions") as HTMLTextAreaElement).value,
      };
      // L2: planned site reference, both coordinates or neither; the server
      // validates ranges and the radius, and the form keeps every input.
      const latRaw = (document.getElementById("f-lat") as HTMLInputElement).value.trim();
      const lonRaw = (document.getElementById("f-lon") as HTMLInputElement).value.trim();
      const radRaw = (document.getElementById("f-radius") as HTMLInputElement).value.trim();
      const siteLocation = latRaw === "" && lonRaw === "" && radRaw === "" ? undefined : {
        ...(latRaw === "" ? {} : { latitude: Number(latRaw) }),
        ...(lonRaw === "" ? {} : { longitude: Number(lonRaw) }),
        ...(radRaw === "" ? {} : { radiusM: Number(radRaw) }),
      };
      const dlRaw = (document.getElementById("f-dl") as HTMLInputElement).value;
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dlRaw)) throw new Error("bad_deadline");
      // Task 0: the raw wall time plus the explicit zone choice go to the
      // server, which does the real wall-to-instant conversion.
      const tz = selectedTz();
      if (tz === null) throw new Error("need_timezone");
      const c = await calls.createMission(site, codes, dlRaw.slice(0, 16), undefined, codeHeaders(), tz, brief, hints, siteLocation) as { missionId: string; workerToken: string; reviewToken: string };
      const wl = workLink(window.location.origin, c.missionId, c.workerToken);
      const rl = reviewLink(window.location.origin, c.missionId, c.reviewToken);
      out.innerHTML = `<div class="card links"><p class="ok">Mission ${esc(shortId(c.missionId))} open.</p>
        <p>Field professional link:</p><a href="${esc(wl)}">${esc(wl)}</a><button id="f-cw">Copy field professional link</button>
        <p>Client link:</p><a href="${esc(rl)}">${esc(rl)}</a><button id="f-cr">Copy client link</button>
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
      // F1c: a leaking brief field gets the same message inline on that
      // field (never echoing the expected codes) plus the form-level note.
      // Every other input keeps its current value — nothing is re-rendered.
      if (m.includes("brief_leaks_code")) {
        const target = briefLeakTarget(typeof (e as { field?: unknown }).field === "string"
          ? String((e as { field?: unknown }).field) : "");
        const id = target === null ? null
          : target.kind === "title" ? "f-title-err"
          : target.kind === "role" ? "f-role-err"
          : target.kind === "instructions" ? "f-instructions-err"
          : `f-hint-err-${target.index}`;
        if (id !== null) {
          const slot = document.getElementById(id);
          if (slot !== null) slot.innerHTML = `<p class="err">${esc(BRIEF_LEAK_MESSAGE)}</p>`;
        }
      }
      const friendly = m.includes("requester_code_denied") ? wrongCodeMsg()
        : m.includes("note_unconfirmed") ? "Check the draft against the note photo and tick confirmation first."
        : m.includes("need_one_code") ? "Enter at least one expected code."
        : (m.includes("need_timezone") || m.includes("timezone_required")) ? "Choose a time zone for the deadline."
        : m.includes("bad_zone") ? "That time zone is not supported — pick device or UTC."
        : m.includes("brief_leaks_code") ? BRIEF_LEAK_MESSAGE
        : (m.includes("bad_location") || m.includes("bad_radius")) ? LOC_MSG
        : m;
      if (m.includes("bad_location") || m.includes("bad_radius")) {
        const locSlot = document.getElementById("f-loc-err");
        if (locSlot !== null) locSlot.innerHTML = `<p class="err">${esc(LOC_MSG)}</p>`;
      }
      out.innerHTML = `<p class="err">${esc(friendly)}</p>`;
      goBtn.disabled = false;
    }
  };
  (document.getElementById("f-draft") as HTMLButtonElement).onclick = async () => {
    const fmsg = document.getElementById("f-dmsg") as HTMLElement;
    try {
      fmsg.innerHTML = "";
      (document.getElementById("f-out") as HTMLElement).innerHTML = "";
      (document.getElementById("f-nmsg") as HTMLElement).innerHTML = "";
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
      nmsg.innerHTML = "";
      (document.getElementById("f-out") as HTMLElement).innerHTML = "";
      (document.getElementById("f-dmsg") as HTMLElement).innerHTML = "";
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
        cached?: boolean;
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
      // Stage 2c: an empty wall value leaves the field blank with guidance.
      const dw = d.deadline.value;
      const dlInput = document.getElementById("f-dl") as HTMLInputElement;
      let dlNote = "";
      if (dw === "") {
        dlInput.value = "";
        dlNote = `<p class="err">Deadline not filled - enter it from the note.</p>`;
      } else if (/([zZ]|[+-]\d{2}:?\d{2}|[+-]\d{4})$/.test(dw)) {
        dlInput.value = toLocalInput(new Date(dw));
      } else {
        dlInput.value = dw.slice(0, 16);
      }
      noteZone = d.timezone.value !== null && zoneValid(d.timezone.value) ? d.timezone.value : null;
      paintTz();
      const snip = (label: string, s: string): string =>
        `<p class="muted">${esc(label)}: ${s === "" ? "source unknown" : `“${esc(s)}”`}</p>`;
      nfields.innerHTML = snip("Site", d.siteLabel.snippet)
        + d.codes.map((c, i) => snip(`Box ${i + 1}`, c.snippet)).join("")
        + snip("Deadline", d.deadline.snippet)
        + `<p class="muted">Time zone: ${d.timezone.value === null ? "unknown — choose device or UTC next to the deadline" : esc(d.timezone.value) + (noteZone === null ? " (not recognised — choose device or UTC next to the deadline)" : " (listed next to the deadline — select it to use it)")}</p>`
        + `<p class="muted">Snippets quote what the model read — check them against the photo yourself. Snippet agreement is not independent verification.</p>`;
      notePending = true;
      confirmBox.checked = false;
      nmsg.innerHTML = (j.cached === true ? `<p class="ok">Saved draft - no new AI call.</p>` : "")
        + `<p class="ok">Draft ready — check every field against the photo, tick confirmation, then Create mission.</p>`
        + dlNote;
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
  hint?: string;
}

interface WorkBrief {
  title?: string;
  role?: string;
  instructions?: string;
}

// Guided-capture position: persists across viewWork re-renders so a worker
// keeps their place after each photo; reset whenever the mission changes.
let workMission = "";
let workIndex = 0;

async function viewWork(el: HTMLElement, missionId: string, token: string): Promise<void> {
  const s = await calls.state(missionId, token) as {
    mission: { state: string; siteLabel: string; deadline: string; brief?: WorkBrief | null; items: BriefItem[]; keptEarlier?: boolean; planned?: boolean; checkin?: { status: string; distanceM: number | null; accuracyM: number; accuracyBand: string; fixTime: string; stale: boolean; attempts: number } | null };
  };
  const m = s.mission;
  if (m.state !== "capturing" && m.state !== "open" && m.state !== "consented") {
    const note = flash;
    flash = "";
    el.innerHTML = `<h1>Field professional — Collection ${esc(shortId(missionId))}</h1>${note === "" ? "" : `<p class="ok">${esc(note)}</p>`}<p class="muted">Status: ${esc(plainState(m.state))} — capture is closed.</p>`;
    return;
  }
  if (m.state !== "capturing") {
    el.innerHTML = `<h1>Field professional — Collection</h1><p>${esc(m.siteLabel)}</p>
      <div class="card"><p>Consent: photos of each labelled box are collected as delivery evidence and shown to the reviewer.</p>
      <label>Field professional ID<input id="w-id" type="text" value="worker-1" /></label>
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
  // F1: the assignment header names site, deadline with zone, item count,
  // and three steps; progress counts completed vs remaining items.
  const doneCount = (list: Array<{ state: string }>): number =>
    list.filter((it) => it.state === "received").length;
  const fmtDeadline = (iso: string): string => {
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return iso;
    let zone = "UTC";
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
    } catch {
      // Keep UTC.
    }
    // No seconds on the worker Due line.
    const when = d.toLocaleString(undefined, {
      year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
    });
    return `${when} ${zone}`;
  };
  if (workMission !== missionId) {
    workMission = missionId;
    workIndex = 0;
    try {
      const saved = Number(sessionStorage.getItem(`fw-pos-${missionId}`));
      if (Number.isInteger(saved) && saved >= 0 && saved < m.items.length) workIndex = saved;
    } catch {
      // Private mode: start at the first item.
    }
  }
  if (workIndex >= m.items.length) workIndex = 0;
  if (workIndex < 0) workIndex = 0;
  const k = workIndex;
  const cur = m.items[k];
  // Task 0b: finished items show no capture controls — only the done note
  // with Next / Send-for-review guidance. The brief state is neutral here.
  const finished = cur.state === "received";
  const card = `<div class="card" data-item="${esc(cur.itemId)}">
      <p><strong>${esc(cur.itemId)}</strong> — ${workerChip(cur.state)}</p>
      ${cur.hint === undefined || cur.hint === "" ? "" : `<p class="muted">Tip: ${esc(cur.hint)}</p>`}
      ${finished
        ? `<p class="muted">Photo received - this item is done. Continue with Next, or Send for review when every item shows Photo received.</p>`
        : `<input type="file" accept="image/*" capture="environment" data-photo="${esc(cur.itemId)}" />
      <button data-shoot="${esc(cur.itemId)}" class="primary">Take photo</button>`}
      <div data-msg="${esc(cur.itemId)}"></div></div>`;
  const allDone = m.items.every((it) => it.state === "received");
  const attemptsUsed = m.checkin?.attempts ?? 0;
  const checkinLine = m.checkin == null
    ? `<p class="muted">No fix shared yet.</p>`
    : `<p>Check-in: ${esc(plainCheckin(m.checkin.status))}${m.checkin.distanceM === null ? "" : ` (${Math.round(m.checkin.distanceM)} m)`} · accuracy ${esc(m.checkin.accuracyBand)}${m.checkin.stale ? " · stale" : ""}</p>`;
  const received = doneCount(m.items);
  const remaining = m.items.length - received;
  const briefCard = m.brief == null ? ""
    : `<div class="card" id="w-brief">${
      (m.brief.title === undefined || m.brief.title === "" ? "" : `<p><strong>${esc(m.brief.title)}</strong></p>`)
      + (m.brief.role === undefined || m.brief.role === "" ? "" : `<p>${esc(m.brief.role)}</p>`)
      + (m.brief.instructions === undefined || m.brief.instructions === "" ? "" : `<p>${esc(m.brief.instructions)}</p>`)
    }</div>`;
  el.innerHTML = `<h1>Field professional — Collection ${esc(shortId(missionId))}</h1><p class="muted">${esc(m.siteLabel)} · Due ${esc(fmtDeadline(m.deadline))} · ${m.items.length} boxes</p>${briefCard}<div class="card" id="w-checkin"><p><strong>Check-in (optional)</strong></p><p class="muted">Share a one-time device fix so the client sees one location, accuracy and time, including on a map. Photos count without it.</p>${checkinLine}<p class="muted">Check-in ${attemptsUsed} of 5 used.</p>${m.keptEarlier === true ? `<p class="muted">Latest attempt unverified — earlier check-in kept.</p>` : ""}<button id="w-cgo">Share location for this mission</button><div id="w-cmsg"></div></div><div class="card"><p><strong>How to finish:</strong> 1. Photograph each label. 2. Check every item shows Photo received. 3. Send for review.</p></div><p class="muted">Item ${k + 1} of ${m.items.length} · ${received} received · ${remaining} to go</p><div id="w-items">${card}</div>
    <div class="row"><button id="w-prev"${k === 0 ? " disabled" : ""}>Previous</button><button id="w-next"${k === m.items.length - 1 ? " disabled" : ""}>Next</button></div>
    <button id="w-review" class="primary" ${allDone ? "" : "disabled"}>Send for review</button><div id="w-out"></div>`;
  const savePos = (n: number): void => {
    try {
      sessionStorage.setItem(`fw-pos-${missionId}`, String(n));
    } catch {
      // Private mode: position is memory-only.
    }
  };
  (document.getElementById("w-prev") as HTMLButtonElement).onclick = () => {
    workIndex = k - 1;
    savePos(workIndex);
    void render();
  };
  (document.getElementById("w-next") as HTMLButtonElement).onclick = () => {
    workIndex = k + 1;
    savePos(workIndex);
    void render();
  };
  const cgo = document.getElementById("w-cgo") as HTMLButtonElement | null;
  if (cgo !== null) {
    // L2: one-shot browser fix only on explicit tap - never on load. A
    // denied or failed read saves nothing and keeps any earlier fix.
    cgo.onclick = () => {
      const cmsg = document.getElementById("w-cmsg") as HTMLElement;
      if (cgo.disabled) return;
      if (!("geolocation" in navigator)) {
        cmsg.innerHTML = `<p class="err">This device cannot share a location - photos still count.</p>`;
        return;
      }
      cgo.disabled = true;
      cmsg.innerHTML = `<p class="muted">Reading device location...</p>`;
      navigator.geolocation.getCurrentPosition(async (pos) => {
        try {
          const r = await calls.checkin(missionId, token, {
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracyM: pos.coords.accuracy,
            fixTime: new Date(pos.timestamp).toISOString(),
          }) as { checkin: { status: string } | null };
          flash = r.checkin === null ? "Check-in recorded." : `Check-in recorded: ${plainCheckin(r.checkin.status)}.`;
          await render();
        } catch (e) {
          const cm = e instanceof Error ? e.message : String(e);
          cmsg.innerHTML = cm.includes("checkin_exhausted")
            ? `<p class="err">No check-ins left on this mission (5 used) - photos still count.</p>`
            : errBox(e);
        } finally {
          cgo.disabled = false;
        }
      }, (err) => {
        const why = err.code === err.PERMISSION_DENIED ? "Location denied in the browser - no fix was saved, and an earlier fix stays."
          : err.code === err.TIMEOUT ? "Location timed out - no fix was saved, and an earlier fix stays."
          : "Location unavailable - no fix was saved, and an earlier fix stays.";
        cmsg.innerHTML = `<p class="err">${esc(why)} Photos still count.</p>`;
        cgo.disabled = false;
      }, { timeout: 15000, maximumAge: 60000 });
    };
  }
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
        // F1: genuine per-chunk progress when there are several chunks,
        // otherwise the indeterminate busy line above stays.
        const up = await uploadPhoto(missionId, token, it.itemId, attempt, `${it.itemId}-${attempt}`, small,
          undefined, (done, total) => {
            if (total > 1) msg.innerHTML = `<p class="muted">Uploading chunk ${done} of ${total}…</p>`;
          });
        const cap = await calls.capture(missionId, token, it.itemId, up.uploadId) as { state: string };
        // F1c: the server answers with neutral worker states only.
        if (cap.state === "retake") {
          const head = el.querySelector(`[data-item="${it.itemId}"] > p`) as HTMLElement | null;
          if (head !== null) head.textContent = `${it.itemId} — ${plainWorkerItem("retake")}`;
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

// G1 glasses simulation of guided capture: same worker token, same worker
// data (mission-state worker view: itemId, neutral state, photo tip only)
// and the same capture API (uploadPhoto + capture-submit) as viewWork —
// display concept only. Demo opens by replacing /work/ with /glasses/ in a
// worker link; there is no navigation link to it. The HUD shows itemId
// (box number, not the code), the photo tip, and neutral photo words only:
// expected codes, readings, and decisions never reach this view.
let glassesMission = "";
let glassesIndex = 0;

async function viewGlasses(el: HTMLElement, missionId: string, token: string): Promise<void> {
  const s = await calls.state(missionId, token) as {
    mission: { state: string; siteLabel: string; deadline: string; brief?: WorkBrief | null; items: BriefItem[] };
  };
  const m = s.mission;
  if (m.state !== "capturing" && m.state !== "open" && m.state !== "consented") {
    el.innerHTML = `<h1>Field professional — Glasses simulation</h1>`
      + buildGlassesHUD({ missionId, siteLabel: m.siteLabel, items: [], index: 0, closed: true });
    return;
  }
  if (m.state !== "capturing") {
    el.innerHTML = `<h1>Field professional — Glasses simulation</h1>`
      + `<div class="hud"><p class="hud-label">${esc(GLASSES_LABEL)}</p>`
      + `<p class="hud-site">${esc(m.siteLabel)}</p>`
      + `<p>Consent: photos of each labelled box are collected as delivery evidence and shown to the reviewer.</p>`
      + `<label>Field professional ID<input id="g-id" type="text" value="worker-1" /></label>`
      + `<button id="g-ok" class="primary">Accept and start</button></div><div id="g-out"></div>`;
    (document.getElementById("g-ok") as HTMLButtonElement).onclick = async () => {
      const out = document.getElementById("g-out") as HTMLElement;
      const b = document.getElementById("g-ok") as HTMLButtonElement;
      if (b.disabled) return;
      b.disabled = true;
      try {
        await calls.consent(missionId, token, (document.getElementById("g-id") as HTMLInputElement).value);
        await render();
      } catch (e) {
        out.innerHTML = errBox(e);
      } finally {
        b.disabled = false;
      }
    };
    return;
  }
  if (glassesMission !== missionId) {
    glassesMission = missionId;
    glassesIndex = 0;
    try {
      const saved = Number(sessionStorage.getItem(`fg-pos-${missionId}`));
      if (Number.isInteger(saved) && saved >= 0 && saved < m.items.length) glassesIndex = saved;
    } catch {
      // Private mode: start at the first item.
    }
  }
  if (glassesIndex >= m.items.length) glassesIndex = 0;
  if (glassesIndex < 0) glassesIndex = 0;
  const k = glassesIndex;
  const cur = m.items[k];
  const allDone = m.items.every((it) => it.state === "received");
  el.innerHTML = `<h1>Field professional — Glasses simulation</h1>`
    + buildGlassesHUD({ missionId, siteLabel: m.siteLabel, items: m.items, index: k, closed: false })
    + `<button id="g-review" class="primary" ${allDone ? "" : "disabled"}>Send for review</button><div id="g-out"></div>`;
  const savePos = (n: number): void => {
    try {
      sessionStorage.setItem(`fg-pos-${missionId}`, String(n));
    } catch {
      // Private mode: position is memory-only.
    }
  };
  (el.querySelector("[data-gprev]") as HTMLButtonElement).onclick = () => {
    glassesIndex = k - 1;
    savePos(glassesIndex);
    void render();
  };
  (el.querySelector("[data-gnext]") as HTMLButtonElement).onclick = () => {
    glassesIndex = k + 1;
    savePos(glassesIndex);
    void render();
  };
  if (cur.state !== "received") {
    const btn = el.querySelector(`[data-gshoot="${cur.itemId}"]`) as HTMLButtonElement;
    const inp = el.querySelector(`[data-gphoto="${cur.itemId}"]`) as HTMLInputElement;
    const msg = el.querySelector(`[data-gmsg="${cur.itemId}"]`) as HTMLElement;
    btn.onclick = () => inp.click();
    inp.onchange = async () => {
      const f = inp.files?.[0];
      if (!f) return;
      if (btn.disabled) return;
      btn.disabled = true;
      inp.disabled = true;
      msg.innerHTML = `<p class="hud-note">Uploading…</p>`;
      try {
        const small = await shrinkPhoto(f);
        const attempt = `a${Date.now()}`;
        const up = await uploadPhoto(missionId, token, cur.itemId, attempt, `${cur.itemId}-${attempt}`, small, undefined);
        const cap = await calls.capture(missionId, token, cur.itemId, up.uploadId) as { state: string };
        if (cap.state === "retake") {
          msg.innerHTML = `<p class="hud-note">Label unclear — open the phone link for a close-up.</p>`;
        } else {
          msg.innerHTML = `<p class="hud-note">Photo received.</p>`;
          await render();
        }
      } catch (e) {
        const em = e instanceof Error ? e.message : String(e);
        const stale = staleItemMsg(em);
        msg.innerHTML = stale !== null ? `<p class="hud-note">${esc(stale)}</p>`
          : em.includes("reader_unavailable")
            ? `<p class="hud-note">The reading service did not respond — take the photo again in a minute.</p>`
            : errBox(e);
      } finally {
        btn.disabled = false;
        inp.disabled = false;
      }
    };
  }
  (document.getElementById("g-review") as HTMLButtonElement).onclick = async () => {
    const b = document.getElementById("g-review") as HTMLButtonElement;
    if (b.disabled) return;
    b.disabled = true;
    try {
      await calls.toReview(missionId, token);
      flash = "Sent for review.";
      await render();
    } catch (e) {
      (document.getElementById("g-out") as HTMLElement).innerHTML = errBox(e);
    } finally {
      b.disabled = false;
    }
  };
}

function viewJobsNew(el: HTMLElement): void {
  el.innerHTML = renderJobForm();
  const codeRows = (values: string[], hints: string[] = []): void => {
    const box = document.getElementById("j-codes") as HTMLElement;
    const vals = values.slice(0, 10);
    box.innerHTML = vals.map((v, i) =>
      `<label>Item code, box ${i + 1}<input class="j-code-in" type="text" value="${esc(v)}" /></label>` +
      `<label>Photo tip, box ${i + 1} (optional, at most 120 characters)<input class="j-hint-in" type="text" maxlength="120" value="${esc(hints[i] ?? "")}" /></label>`).join("")
      + (vals.length > 1 ? `<button id="j-rm">Remove last box</button>` : "");
    const rm = document.getElementById("j-rm") as HTMLButtonElement | null;
    if (rm !== null) rm.onclick = () => codeRows(codeValues().slice(0, -1), hintValues().slice(0, -1));
  };
  const codeValues = (): string[] =>
    Array.from(document.querySelectorAll(".j-code-in") as NodeListOf<HTMLInputElement>).map((i) => i.value);
  const hintValues = (): string[] =>
    Array.from(document.querySelectorAll(".j-hint-in") as NodeListOf<HTMLInputElement>).map((i) => i.value);
  codeRows(["B12", "B17", "B23"]);
  const zoneOf = (name: string): string | null => {
    const c = document.querySelector(`input[name="${name}"]:checked`) as HTMLInputElement | null;
    if (c === null) return null;
    return c.value === "utc" ? "UTC" : "device";
  };
  try {
    (document.getElementById("j-code") as HTMLInputElement).value = sessionStorage.getItem("fp-code") ?? "";
  } catch {
    // Private mode: start blank.
  }
  (document.getElementById("j-add") as HTMLButtonElement).onclick = () => {
    const v = codeValues();
    if (v.length >= 10) return;
    codeRows([...v, ""], [...hintValues(), ""]);
  };
  (document.getElementById("j-go") as HTMLButtonElement).onclick = async () => {
    const out = document.getElementById("j-out") as HTMLElement;
    const go = document.getElementById("j-go") as HTMLButtonElement;
    if (go.disabled) return;
    go.disabled = true;
    try {
      out.innerHTML = "";
      const code = (document.getElementById("j-code") as HTMLInputElement).value;
      try {
        sessionStorage.setItem("fp-code", code);
      } catch {
        // Private mode: no persistence.
      }
      const headers: Record<string, string> = code === "" ? {} : { "x-requester-code": code };
      const rows = codeValues().map((c, i) => ({ code: c.trim(), hint: (hintValues()[i] ?? "").trim() }))
        .filter((r) => r.code !== "");
      if (rows.length < 1) throw new Error("need_one_code");
      const bidDl = jobInstant((document.getElementById("j-bid-dl") as HTMLInputElement).value, zoneOf("j-bidtz"));
      const checkDl = jobInstant((document.getElementById("j-check-dl") as HTMLInputElement).value, zoneOf("j-checktz"));
      if (bidDl === null || checkDl === null) throw new Error("need_timezone");
      const cur = (document.getElementById("j-currency") as HTMLSelectElement).value;
      // J2b: an empty budget box is a missing budget, never a silent 0.
      const money = (id: string): number => {
        const v = (document.getElementById(id) as HTMLInputElement).value.trim();
        return v === "" ? Number.NaN : Number(v);
      };
      const bMin = money("j-budget-min");
      const bMax = money("j-budget-max");
      if (!Number.isFinite(bMin) || !Number.isFinite(bMax)) throw new Error("need_budget");
      const skills = (document.getElementById("j-skills") as HTMLInputElement).value
        .split(",").map((s) => s.trim()).filter((s) => s !== "");
      const body = {
        title: (document.getElementById("j-title") as HTMLInputElement).value,
        outcome: (document.getElementById("j-outcome") as HTMLTextAreaElement).value,
        deliverables: (document.getElementById("j-deliverables") as HTMLTextAreaElement).value,
        region: (document.getElementById("j-region") as HTMLInputElement).value,
        windowStart: (document.getElementById("j-win-start") as HTMLInputElement).value,
        windowEnd: (document.getElementById("j-win-end") as HTMLInputElement).value,
        budget: {
          min: bMin,
          max: bMax,
          currency: cur,
        },
        skills,
        safetyNotes: (document.getElementById("j-safety") as HTMLTextAreaElement).value,
        bidDeadline: bidDl,
        siteLabel: (document.getElementById("j-site") as HTMLInputElement).value,
        items: rows.map((r) => r.hint === "" ? { expectedLabel: r.code } : { expectedLabel: r.code, photoHint: r.hint }),
        checkDeadline: checkDl,
        createdBy: "person",
      };
      const c = await calls.jobCreate(body, headers) as { jobId: string; ownerToken: string };
      const ol = jobOwnerLink(window.location.origin, c.jobId, c.ownerToken);
      out.innerHTML = `<div class="card links"><p class="ok">Job ${esc(c.jobId)} drafted.</p>`
        + `<p>Owner link (bearer link — keep it private):</p><a href="${esc(ol)}">${esc(ol)}</a><button id="j-cw">Copy owner link</button></div>`;
      (document.getElementById("j-cw") as HTMLButtonElement).onclick = () => void copyText(ol).then(() => {
        (document.getElementById("j-cw") as HTMLButtonElement).textContent = "Copied";
      });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      const special = jobErrorWords(m);
      out.innerHTML = special !== null ? `<p class="err">${esc(special)}</p>`
        : m.includes("requester_code_denied") ? `<p class="err">Wrong access code (${(document.getElementById("j-code") as HTMLInputElement).value.length} characters entered)</p>`
        : m.includes("need_one_code") ? `<p class="err">Enter at least one item code.</p>`
        : m.includes("need_timezone") ? `<p class="err">Choose a time zone for each deadline.</p>`
        : m.includes("need_budget") ? `<p class="err">Enter the budget minimum and maximum as numbers.</p>`
        : m.includes("job_leaks_code") ? `<p class="err">This text contains one of the item codes. Remove it so the people you invite never see the item codes.</p>`
        : errBox(e);
      go.disabled = false;
    }
  };
}

let ownerInviteJob = "";
let ownerInviteToken: string | null = null;

async function viewJobOwner(el: HTMLElement, jobId: string, token: string): Promise<void> {
  const r = await calls.jobOwner(jobId, token, "get") as { job: FieldJob; check?: OwnerCheck; invite?: { bidderToken: string } };
  const job = r.job;
  if (ownerInviteJob !== jobId) {
    ownerInviteJob = jobId;
    ownerInviteToken = null;
  }
  el.innerHTML = renderOwner(job, { origin: window.location.origin, inviteBidderToken: ownerInviteToken, check: r.check ?? null });
  const out = document.getElementById("jo-out") as HTMLElement;
  const act = async (action: string, extra: Record<string, unknown>, btn: HTMLButtonElement | null): Promise<void> => {
    if (btn !== null) {
      if (btn.disabled) return;
      btn.disabled = true;
    }
    try {
      const n = await calls.jobOwner(jobId, token, action, extra) as { invite?: { bidderToken: string } };
      if (n.invite !== undefined) ownerInviteToken = n.invite.bidderToken;
      await render();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      const special = jobErrorWords(m);
      out.innerHTML = special !== null ? `<p class="err">${esc(special)}</p>` : errBox(e);
    } finally {
      if (btn !== null) btn.disabled = false;
    }
  };
  const pub = document.getElementById("jo-publish") as HTMLButtonElement | null;
  if (pub !== null) pub.onclick = () => void act("publish", {}, pub);
  const can = document.getElementById("jo-cancel") as HTMLButtonElement | null;
  if (can !== null) can.onclick = () => void act("cancel", {}, can);
  const can2 = document.getElementById("jo-cancel2") as HTMLButtonElement | null;
  if (can2 !== null) can2.onclick = () => void act("cancel", {}, can2);
  const uns = document.getElementById("jo-unselect") as HTMLButtonElement | null;
  if (uns !== null) uns.onclick = () => void act("unselect", {}, uns);
  const go = document.getElementById("jo-go") as HTMLButtonElement | null;
  if (go !== null) {
    go.onclick = () => void act("invite", { name: (document.getElementById("jo-name") as HTMLInputElement).value }, go);
  }
  const cp = document.getElementById("jo-copy") as HTMLButtonElement | null;
  if (cp !== null && ownerInviteToken !== null) {
    const link = jobBidLink(window.location.origin, jobId, ownerInviteToken);
    cp.onclick = () => void copyText(link).then(() => {
      cp.textContent = "Copied";
    });
  }
  for (const b of Array.from(el.querySelectorAll("[data-jo-select]")) as HTMLButtonElement[]) {
    b.onclick = () => void act("select", { bidId: b.getAttribute("data-jo-select") ?? "" }, b);
  }
}

async function viewJobBid(el: HTMLElement, jobId: string, token: string): Promise<void> {
  const r = await calls.jobBid(jobId, token, "get") as { job: BidderJobView; check?: BidderCheck };
  el.innerHTML = renderBid(r.job, r.check ?? null, window.location.origin);
  const out = document.getElementById("jb-out") as HTMLElement | null;
  if (out === null) return;
  const act = async (action: string, extra: Record<string, unknown>, btn: HTMLButtonElement): Promise<void> => {
    if (btn.disabled) return;
    btn.disabled = true;
    try {
      await calls.jobBid(jobId, token, action, extra);
      await render();
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      const special = jobErrorWords(m);
      out.innerHTML = special !== null ? `<p class="err">${esc(special)}</p>` : errBox(e);
    } finally {
      btn.disabled = false;
    }
  };
  const send = document.getElementById("jb-send") as HTMLButtonElement | null;
  if (send !== null) {
    send.onclick = () => void act("submit", {
      price: {
        amount: Number((document.getElementById("jb-price") as HTMLInputElement).value),
        currency: (document.getElementById("jb-currency") as HTMLSelectElement).value,
      },
      method: (document.getElementById("jb-method") as HTMLTextAreaElement).value,
      availableFrom: (document.getElementById("jb-from") as HTMLInputElement).value,
      availableTo: (document.getElementById("jb-to") as HTMLInputElement).value,
      exclusions: (document.getElementById("jb-excl") as HTMLTextAreaElement).value,
      capability: (document.getElementById("jb-cap") as HTMLTextAreaElement).value,
    }, send);
  }
  const wd = document.getElementById("jb-withdraw") as HTMLButtonElement | null;
  if (wd !== null) wd.onclick = () => void act("withdraw", {}, wd);
  const acc = document.getElementById("jb-accept") as HTMLButtonElement | null;
  if (acc !== null) acc.onclick = () => void act("accept", {}, acc);
  const dec = document.getElementById("jb-decline") as HTMLButtonElement | null;
  if (dec !== null) dec.onclick = () => void act("decline", {}, dec);
}

function viewJobClaim(el: HTMLElement, jobId: string): void {
  el.innerHTML = renderClaim();
  try {
    (document.getElementById("jc-code") as HTMLInputElement).value = sessionStorage.getItem("fp-code") ?? "";
  } catch {
    // Private mode: start blank.
  }
  (document.getElementById("jc-open") as HTMLButtonElement).onclick = async () => {
    const out = document.getElementById("jc-out") as HTMLElement;
    const b = document.getElementById("jc-open") as HTMLButtonElement;
    if (b.disabled) return;
    b.disabled = true;
    try {
      const code = (document.getElementById("jc-code") as HTMLInputElement).value;
      try {
        sessionStorage.setItem("fp-code", code);
      } catch {
        // Private mode: no persistence.
      }
      const r = await calls.jobClaim(jobId, code === "" ? {} : { "x-requester-code": code }) as { ownerToken: string };
      window.location.hash = `#/job/${jobId}/${r.ownerToken}`;
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      const special = jobErrorWords(m);
      out.innerHTML = special !== null ? `<p class="err">${esc(special)}</p>`
        : m.includes("requester_code_denied") ? `<p class="err">That access code wasn't accepted</p>`
        : m.includes("not_found") ? `<p class="err">This job doesn't exist</p>`
        : errBox(e);
      b.disabled = false;
    }
  };
}

async function viewReview(el: HTMLElement, missionId: string, token: string): Promise<void> {
  const s = await calls.state(missionId, token) as {
    briefFingerprint?: string;
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
      brief?: { title?: string; role?: string; instructions?: string } | null;
      checkin?: unknown;
    };
  };
  const m = s.mission;
  if (m.state !== "in_review" && m.state !== "decided") {
    const photos = m.expected.filter((e) => m.observed[e.itemId]?.uploadId).length;
    el.innerHTML = `<h1>Client — Review ${esc(shortId(missionId))}</h1><div class="card"><p>Waiting for the field professional — ${photos} of ${m.expected.length} photos so far.</p><button id="r-refresh">Refresh</button></div>${checkinCard(m.checkin, geoFromMission(m))}`;
    bindMapButton(geoFromMission(m));
    (document.getElementById("r-refresh") as HTMLButtonElement).onclick = () => void render();
    return;
  }
  const cards: string[] = [];
  for (const e of m.expected) {
    const o = m.observed[e.itemId];
    cards.push(`<div class="card" data-item="${esc(e.itemId)}">
      <p><strong>${esc(e.itemId)}</strong> — expected ${esc(e.expectedLabel)}, observed ${esc(o.observedLabel ?? "—")} (${esc(o.readability)}, ${clientChip(o.state)})</p>
      <div data-sug="${esc(e.itemId)}">${suggestReview({ state: o.state, expectedLabel: e.expectedLabel, observedLabel: o.observedLabel, readability: o.readability, samStatus: o.samStatus?.status ?? null }).map((s) => `<p class="muted">${esc(s.text)}</p>`).join("")}</div><div data-photo="${esc(e.itemId)}"><p class="muted">Loading photo…</p></div>
      <div class="row"${m.state === "in_review" ? "" : " hidden"}><button data-yes="${esc(e.itemId)}">Confirm match</button><button data-no="${esc(e.itemId)}">Confirm mismatch</button></div>
      <button data-inc="${esc(e.itemId)}"${m.state === "in_review" ? "" : " hidden"}>Inconclusive</button><div data-msg="${esc(e.itemId)}"></div></div>`);
  }
  const note = flash;
  flash = "";
  // Stage 2a: concise two-axis summary above the item cards — exceptions
  // first, matches as a count, undecided mismatches never "confirmed".
  const summaryInner = (mm: typeof m): string => `<p><strong>Summary</strong></p>${summaryLines(summarizeReview(mm)).map((l) => `<p>${esc(l)}</p>`).join("")}`;
  const reviewSummary = `<div class="card" id="r-summary">${summaryInner(m)}</div>`;
  const geo = geoFromMission(m);
  const reviewBrief = m.brief == null ? ""
    : `<div class="card" id="r-brief"><p><strong>Brief</strong></p>${
      (m.brief.title === undefined || m.brief.title === "" ? "" : `<p><strong>${esc(m.brief.title)}</strong></p>`)
      + (m.brief.role === undefined || m.brief.role === "" ? "" : `<p>${esc(m.brief.role)}</p>`)
      + (m.brief.instructions === undefined || m.brief.instructions === "" ? "" : `<p>${esc(m.brief.instructions)}</p>`)
    }</div>`;
  el.innerHTML = `<h1>Client — Review ${esc(shortId(missionId))}</h1>${note === "" ? "" : `<p class="ok">${esc(note)}</p>`}<p class="muted">Status: ${esc(plainState(m.state))}</p>${reviewBrief}${checkinCard(m.checkin, geo)}${reviewSummary}
    <button id="r-ai">AI brief (suggestion, a person decides)</button><div id="r-bout"></div>
    <div id="r-items">${cards.join("")}</div>
    <button id="r-finish" class="primary"${m.state === "in_review" ? "" : " hidden"}>Finish review</button>
    <button id="r-dl"${m.state === "decided" ? "" : " hidden"}>Download evidence pack (JSON)</button>
    ${geo.fix === null ? "" : `<label><input type="checkbox" id="r-printloc" /> Include the check-in location (coordinates and diagram) in the report</label>`}
    <button id="r-print">Print report</button><div id="r-out"></div>
    ${m.state === "decided" ? `<div class="card" id="r-follow"><p><strong>Create follow-up</strong> <span class="muted">Mismatched or inconclusive items only — matched items are excluded.</span></p><div id="r-fitems"></div><label>Site<input id="r-fsite" type="text" /></label><label>Deadline<input id="r-fdl" type="datetime-local" /></label><p>Deadline time zone (required, choose one): <span id="r-ftzrow"></span></p><label>Access code<input id="r-fcode" type="password" autocomplete="off" /></label><button id="r-fgo">Create follow-up</button><div id="r-fout"></div><div id="r-fdone"></div></div>` : ""}`;
  bindMapButton(geo);
  // R1e: every recorded decision bumps this counter. A shown AI brief is then
  // marked out of date (never silently kept), and the summary is re-read.
  let decisionEpoch = 0;
  let summarySeq = 0;
  const showBriefStale = (): void => {
    const bout = document.getElementById("r-bout") as HTMLElement;
    bout.innerHTML = `<p class="err">Out of date: decisions changed since this brief.</p><button id="r-brefresh">Refresh AI brief</button>`;
    (document.getElementById("r-brefresh") as HTMLButtonElement).onclick = () => void askBrief();
  };
  const refreshSummary = async (): Promise<void> => {
    const seq = ++summarySeq;
    try {
      const cur = await calls.state(missionId, token) as typeof s;
      const box = document.getElementById("r-summary");
      if (seq === summarySeq && box !== null) box.innerHTML = summaryInner(cur.mission);
    } catch {
      // Best effort: the recorded decision already stands.
    }
  };
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
        decisionEpoch += 1;
        if (document.getElementById("r-bcard") !== null) showBriefStale();
        void refreshSummary();
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
  // A1b: one AI suggestion per deliberate click. Text only: no automatic
  // decisions, state transitions, or follow-up creation. After generation the
  // response fingerprint is compared with the current state fingerprint.
  const askBrief = async (): Promise<void> => {
    const bb = document.getElementById("r-ai") as HTMLButtonElement;
    const bout = document.getElementById("r-bout") as HTMLElement;
    if (bb.disabled) return;
    bb.disabled = true;
    const epochAtRequest = decisionEpoch;
    try {
      bout.innerHTML = `<p class="muted">Preparing an AI suggestion from the current evidence\u2026</p>`;
      const r = await calls.brief(missionId, token, crypto.randomUUID()) as {
        brief: { summary: string; recommendations: string[]; next_action: string }; fingerprint: string;
      };
      const cur = await calls.state(missionId, token) as { briefFingerprint?: string; mission?: { state?: string } };
      if (briefOutOfDate({ epochAtRequest, epochNow: decisionEpoch, briefFingerprint: r.fingerprint, currentFingerprint: cur.briefFingerprint })) {
        showBriefStale();
        return;
      }
      // M3: once the review is finished, the next step never says "Finish review".
      const finished = cur.mission?.state === "decided" || cur.mission?.state === "exported";
      const act = finished
        ? (r.brief.next_action === "send_follow_up" ? "Review finished; send a follow-up for the flagged items" : "Review finished; print or download the report")
        : r.brief.next_action === "finish_review" ? "Finish review"
        : r.brief.next_action === "send_follow_up" ? "Send follow-up"
        : r.brief.next_action === "decide_remaining" ? "Decide remaining items" : r.brief.next_action;
      bout.innerHTML = `<div class="card" id="r-bcard"><p><strong>AI brief (suggestion, a person decides)</strong></p>`
        + `<p>${esc(r.brief.summary)}</p>`
        + (r.brief.recommendations.length === 0 ? "" : `<ul>${r.brief.recommendations.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`)
        + `<p class="muted">Suggested next step: ${esc(act)}</p></div>`;
    } catch (e) {
      // R1c: show the short reference code so a failure can be diagnosed
      // without developer tools (sanitized on the server; escaped here).
      const code = e instanceof Error ? e.message : "error";
      const diag = (e as { diag?: unknown } | null)?.diag;
      const ref = typeof diag === "string" && diag !== "" ? `${code} \u00b7 ${diag}` : code;
      bout.innerHTML = `<p class="err">AI brief unavailable right now; your review is unaffected.</p><p class="muted">Reference: ${esc(ref)}</p>`;
    } finally {
      bb.disabled = false;
    }
  };
  (document.getElementById("r-ai") as HTMLButtonElement).onclick = () => void askBrief();
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
  // Stage 2b-2: follow-up panel (decided only). The parent reviewer token
  // travels in the request body, never the URL; the code goes in a header.
  // The idempotency key is random per panel opening, memory only.
  if (document.getElementById("r-fgo") !== null) {
    const fkey = `${Date.now().toString(36)}-${Math.floor(Math.random() * 2 ** 52)}`;
    const eligible = m.expected.filter((e) =>
      ["confirmed_mismatch", "inconclusive"].includes(m.reviewerDecision[e.itemId]));
    (document.getElementById("r-fitems") as HTMLElement).innerHTML = eligible.map((e) =>
      `<label><input type="checkbox" class="r-fitem" value="${esc(e.itemId)}" checked style="width:auto" /> ${esc(e.itemId)} — expected ${esc(e.expectedLabel)} (${esc(plainItem(m.reviewerDecision[e.itemId]))})</label>`).join("");
    (document.getElementById("r-fsite") as HTMLInputElement).value = m.siteLabel;
    (document.getElementById("r-fdl") as HTMLInputElement).value = toLocalInput(new Date(Date.now() + 24 * 3600 * 1000));
    const fdev = (() => {
      try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC";
      } catch {
        return "UTC";
      }
    })();
    (document.getElementById("r-ftzrow") as HTMLElement).innerHTML =
      `<label><input type="radio" name="r-ftz" value="device" /> Device (${esc(fdev)})</label> ` +
      `<label><input type="radio" name="r-ftz" value="utc" /> UTC</label>`;
    try {
      (document.getElementById("r-fcode") as HTMLInputElement).value = sessionStorage.getItem("fp-code") ?? "";
    } catch {
      // Private mode: start blank.
    }
    (document.getElementById("r-fgo") as HTMLButtonElement).onclick = async () => {
      const go = document.getElementById("r-fgo") as HTMLButtonElement;
      const fout = document.getElementById("r-fout") as HTMLElement;
      if (go.disabled) return;
      go.disabled = true;
      try {
        fout.innerHTML = "";
        const ids = Array.from(document.querySelectorAll(".r-fitem:checked") as NodeListOf<HTMLInputElement>).map((i) => i.value);
        if (ids.length === 0) throw new Error("need_selection");
        const site = (document.getElementById("r-fsite") as HTMLInputElement).value;
        const dlRaw = (document.getElementById("r-fdl") as HTMLInputElement).value;
        if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dlRaw)) throw new Error("bad_deadline");
        const tzc = document.querySelector('input[name="r-ftz"]:checked') as HTMLInputElement | null;
        if (tzc === null) throw new Error("need_timezone");
        const tz = tzc.value === "utc" ? "UTC" : fdev;
        const code = (document.getElementById("r-fcode") as HTMLInputElement).value;
        try {
          sessionStorage.setItem("fp-code", code);
        } catch {
          // Private mode: no persistence.
        }
        const c = await calls.followup(missionId, token, ids, site, dlRaw.slice(0, 16), tz, fkey,
          undefined, code === "" ? {} : { "x-requester-code": code }) as {
          missionId: string; workerToken: string; reviewToken: string; parentItemIds: string[];
        };
        const wl = workLink(window.location.origin, c.missionId, c.workerToken);
        const rl = reviewLink(window.location.origin, c.missionId, c.reviewToken);
        (document.getElementById("r-fdone") as HTMLElement).innerHTML =
          `<div class="card links"><p class="ok">Follow-up ${esc(shortId(c.missionId))} open.</p>` +
          `<p>Follow-up of ${esc(shortId(missionId))} — parent items: ${c.parentItemIds.map(esc).join(", ")}</p>` +
          `<p>Field professional link:</p><a href="${esc(wl)}">${esc(wl)}</a>` +
          `<p>Client link:</p><a href="${esc(rl)}">${esc(rl)}</a></div>`;
      } catch (e) {
        const s = e instanceof Error ? e.message : String(e);
        fout.innerHTML = s.includes("requester_code_denied") ? wrongCodeMsg()
          : s.includes("need_selection") ? `<p class="err">Tick at least one item.</p>`
          : s.includes("need_timezone") || s.includes("timezone_required") ? `<p class="err">Choose a time zone for the deadline.</p>`
          : s.includes("parent_not_decided") ? `<p class="err">The parent review is no longer decided — refresh.</p>`
          : s.includes("ineligible_selection") ? `<p class="err">Only mismatched or inconclusive items can start a follow-up — refresh.</p>`
          : s.includes("followup_conflict") ? `<p class="err">A follow-up with different details already exists for this panel — reload the page for a fresh one.</p>`
          : errBox(e);
        go.disabled = false;
      }
    };
  }
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
        // M1: coordinates go into the report only when the reviewer opts in.
        const withLoc = (document.getElementById("r-printloc") as HTMLInputElement | null)?.checked === true;
        w.document.write(reportDocument(data, urls, withLoc ? locationSectionHtml(geo, true) : null));
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
