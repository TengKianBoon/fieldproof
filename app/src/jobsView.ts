// J2 Jobs and bids screens: pure HTML renderers (no DOM, no fetch), tested
// without a browser in app/tests/j2.test.ts. Every server string passes
// through esc(). The bidder view carries no expected labels, other bids or
// other names, so the renderer cannot show them. Tokens never appear here:
// links are built by the caller from its own origin.
import type { FieldBid, FieldJob } from "../shared/fieldJobs.ts";
import { jobBidLink, reviewLink, workLink } from "./client.ts";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// The example introduction fee is illustrative only: nothing is charged or
// invoiced by the app. The server's engagement.exampleFee is the source of
// truth; this mirrors its 3% example rate for bids without an engagement.
export const FEE_EXAMPLE_PCT = 3;

export function exampleFeeLine(amount: number, currency: string): string {
  const fee = Math.round(amount * (FEE_EXAMPLE_PCT / 100) * 100) / 100;
  return `Example introduction fee (not yet live): ${FEE_EXAMPLE_PCT}% = ${fee} ${currency}`;
}

// Wall-clock text plus an explicitly chosen zone becomes an absolute
// instant; anything else is null and the caller must ask, never assume.
export function jobInstant(wall: string, zone: string | null): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall)) return null;
  if (zone === "UTC") return `${wall}:00Z`;
  if (zone === "device") {
    const ms = Date.parse(wall);
    return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
  }
  return null;
}

// Plain words for job error codes. Null means "no special wording".
export function jobErrorWords(code: string): string | null {
  if (code.includes("contact_details_not_allowed")) {
    return "Please remove phone numbers, e-mails and links. Contact sharing is arranged separately after acceptance.";
  }
  if (code.includes("jobs_disabled")) return "Jobs isn't switched on for this site.";
  return null;
}

export function renderJobForm(): string {
  return `<h1>Client — Post a job (pilot)</h1><p class="muted">Describe the field job, invite professionals by private link, compare bids, and select one. Acceptance creates exactly one FieldProof check. The people you invite never see the item codes.</p>`
    + `<label>Job title (at most 80 characters)<input id="j-title" type="text" maxlength="80" placeholder="Morning market price check" /></label>`
    + `<label>Outcome (at most 600 characters)<textarea id="j-outcome" rows="3" maxlength="600" style="width:100%;box-sizing:border-box" placeholder="Photograph each stall price tag, whole label in frame"></textarea></label>`
    + `<label>Deliverables (optional, at most 400 characters)<textarea id="j-deliverables" rows="2" maxlength="400" style="width:100%;box-sizing:border-box" placeholder="Tag photos through the FieldProof link"></textarea></label>`
    + `<label>Region (broad, e.g. Riau, Sumatra)<input id="j-region" type="text" maxlength="80" placeholder="Riau, Sumatra" /></label>`
    + `<label>Window start<input id="j-win-start" type="date" /></label>`
    + `<label>Window end<input id="j-win-end" type="date" /></label>`
    + `<label>Budget min<input id="j-budget-min" type="text" inputmode="decimal" placeholder="150" /></label>`
    + `<label>Budget max<input id="j-budget-max" type="text" inputmode="decimal" placeholder="300" /></label>`
    + `<label>Currency<select id="j-currency"><option value="USD">USD</option><option value="SGD">SGD</option><option value="IDR">IDR</option></select></label>`
    + `<label>Skills (comma-separated, at most 8)<input id="j-skills" type="text" maxlength="400" placeholder="field sampling, photography" /></label>`
    + `<label>Safety notes (optional, at most 400 characters)<textarea id="j-safety" rows="2" maxlength="400" style="width:100%;box-sizing:border-box" placeholder="Site induction on arrival"></textarea></label>`
    + `<label>Bid deadline<input id="j-bid-dl" type="datetime-local" /></label>`
    + `<p>Bid deadline time zone (required, choose one): <span id="j-bidtzrow"><label><input type="radio" name="j-bidtz" value="device" /> Device</label> <label><input type="radio" name="j-bidtz" value="utc" /> UTC</label></span></p>`
    + `<label>Site label<input id="j-site" type="text" maxlength="80" placeholder="Sample store A" /></label>`
    + `<div id="j-codes"></div>`
    + `<button id="j-add">Add another box</button>`
    + `<label>FieldProof check deadline<input id="j-check-dl" type="datetime-local" /></label>`
    + `<p>Check deadline time zone (required, choose one): <span id="j-checktzrow"><label><input type="radio" name="j-checktz" value="device" /> Device</label> <label><input type="radio" name="j-checktz" value="utc" /> UTC</label></span></p>`
    + `<label>Access code<input id="j-code" type="password" autocomplete="off" /></label>`
    + `<button id="j-go" class="primary">Post job</button><div id="j-out"></div>`;
}

function jobChip(status: string): string {
  return `<span class="chip">${esc(
    status === "draft" ? "Draft"
    : status === "open" ? "Open for bids"
    : status === "accepted" ? "Professional accepted"
    : status === "cancelled" ? "Cancelled" : status,
  )}</span>`;
}

function bidChip(status: string): string {
  return `<span class="chip">${esc(
    status === "invited" ? "Invited"
    : status === "submitted" ? "Submitted"
    : status === "withdrawn" ? "Withdrawn"
    : status === "selected" ? "Selected"
    : status === "accepted" ? "Accepted"
    : status === "declined" ? "Declined"
    : status === "not_selected" ? "Not selected" : status,
  )}</span>`;
}

export interface OwnerCheck {
  missionId: string;
  reviewToken: string;
}

export function renderOwner(
  job: FieldJob,
  opts: { origin: string; inviteBidderToken?: string | null; check?: OwnerCheck | null },
): string {
  const pending = job.selection !== null && job.engagement === null;
  const selectedName = pending
    ? job.bids.find((b) => b.bidId === (job.selection as { bidId: string }).bidId)?.invitedName ?? ""
    : "";
  const summary = `<div class="card" id="jo-summary"><p><strong>${esc(job.title)}</strong> — ${jobChip(job.status)}</p>`
    + `<p class="muted">${esc(job.region)} · ${esc(job.windowStart)} to ${esc(job.windowEnd)} · budget ${esc(String(job.budget.min))}–${esc(String(job.budget.max))} ${esc(job.budget.currency)}</p>`
    + `<p>${esc(job.outcome)}</p>`
    + (job.deliverables === "" ? "" : `<p>${esc(job.deliverables)}</p>`)
    + (job.skills.length === 0 ? "" : `<p class="muted">Skills: ${job.skills.map(esc).join(", ")}</p>`)
    + (job.safetyNotes === "" ? "" : `<p class="muted">Safety: ${esc(job.safetyNotes)}</p>`)
    + `<p class="muted">Bids close ${esc(job.bidDeadline)} · ${job.items.length} items to photograph at ${esc(job.siteLabel)}</p></div>`;
  let action = "";
  if (job.status === "draft") {
    action = `<div class="row"><button id="jo-publish" class="primary">Publish</button><button id="jo-cancel">Cancel job</button></div>`;
  } else if (job.status === "open") {
    const inv = opts.inviteBidderToken === undefined || opts.inviteBidderToken === null ? ""
      : `<div class="card links" id="jo-link"><p class="ok">Private bid link (bearer link — show it to the invited professional only):</p>`
      + `<a href="${esc(jobBidLink(opts.origin, job.jobId, opts.inviteBidderToken))}">${esc(jobBidLink(opts.origin, job.jobId, opts.inviteBidderToken))}</a>`
      + `<button id="jo-copy">Copy bid link</button></div>`;
    action = `<div class="card" id="jo-invite"><p><strong>Invite a professional</strong></p>`
      + `<label>Name<input id="jo-name" type="text" maxlength="60" /></label>`
      + `<button id="jo-go">Create private bid link</button>`
      + `<p class="muted">Anyone with this private link can access this bid. Share only with the intended professional. Create a new link for each person.</p></div>`
      + inv;
  }
  const pendingLine = pending
    ? `<div class="card" id="jo-pending"><p>Waiting for ${esc(selectedName)} to accept.</p><button id="jo-unselect">Undo selection</button></div>`
    : "";
  const cards = job.bids.map((b: FieldBid) => {
    const price = b.price === null ? "no price yet" : `${b.price.amount} ${b.price.currency}`;
    const fee = (b.status === "selected" || b.status === "accepted") && b.price !== null
      ? `<p class="muted">${esc(exampleFeeLine(b.price.amount, b.price.currency))}</p>` : "";
    const sel = b.status === "submitted" && !pending
      ? `<button data-jo-select="${esc(b.bidId)}">Select</button>` : "";
    const dates = b.availableFrom === "" ? "" : `<p class="muted">Available ${esc(b.availableFrom)} to ${esc(b.availableTo)}</p>`;
    return `<div class="card" data-jo-bid="${esc(b.bidId)}"><p><strong>${esc(b.invitedName)}</strong> — ${bidChip(b.status)}</p>`
      + `<p>${esc(price)}</p>${dates}`
      + (b.method === "" ? "" : `<p>${esc(b.method)}</p>`)
      + (b.exclusions === "" ? "" : `<p class="muted">Exclusions: ${esc(b.exclusions)}</p>`)
      + (b.capability === "" ? "" : `<p class="muted">What they can do: ${esc(b.capability)}</p>`)
      + fee + sel + `</div>`;
  }).join("");
  const engaged = job.engagement === null ? "" : `<div class="card" id="jo-engaged"><p><strong>Professional accepted</strong></p>`
    + `<p>${esc(job.engagement.providerName)} · ${esc(String(job.engagement.value.amount))} ${esc(job.engagement.value.currency)} · accepted ${esc(job.engagement.acceptedAt)}</p>`
    + `<p class="muted">Scope: ${esc(job.engagement.scope)}</p>`
    + (opts.check === undefined || opts.check === null ? ""
      : `<p><a href="${esc(reviewLink(opts.origin, opts.check.missionId, opts.check.reviewToken))}">Open the FieldProof review</a></p>`)
    + `</div>`;
  const cancel = job.status === "accepted" || job.status === "cancelled" ? ""
    : `<button id="jo-cancel2">Cancel job</button>`;
  return `<h1>Client — Job ${esc(job.jobId.length > 12 ? `${job.jobId.slice(0, 12)}…` : job.jobId)}</h1>`
    + summary + action + pendingLine
    + (cards === "" ? "" : `<div id="jo-bids">${cards}</div>`)
    + engaged + cancel + `<div id="jo-out"></div>`;
}

// What one invited professional sees: the job without expected labels,
// other bids or other names, plus only their own bid. Shape mirrors
// bidderView() in shared/fieldJobs.ts.
export interface BidderJobView {
  jobId: string;
  status: string;
  title: string;
  outcome: string;
  deliverables: string;
  region: string;
  windowStart: string;
  windowEnd: string;
  budget: { min: number; max: number; currency: string };
  skills: string[];
  safetyNotes: string;
  bidDeadline: string;
  itemCount: number;
  photoHints: string[];
  checkDeadline: string;
  bid: {
    bidId: string;
    status: string;
    submittedAt: string | null;
    price: { amount: number; currency: string } | null;
    method: string;
    availableFrom: string;
    availableTo: string;
    exclusions: string;
    capability: string;
  };
  selectedForYou: boolean;
  engagedWithYou: boolean;
}

export interface BidderCheck {
  missionId: string;
  workerToken: string;
}

export function renderBid(view: BidderJobView, check: BidderCheck | null, origin: string): string {
  const head = `<h1>Field professional — Job</h1>`
    + `<div class="card" id="jb-job"><p><strong>${esc(view.title)}</strong></p><p>${esc(view.outcome)}</p>`
    + (view.deliverables === "" ? "" : `<p>${esc(view.deliverables)}</p>`)
    + `<p class="muted">${esc(view.region)} · ${esc(view.windowStart)} to ${esc(view.windowEnd)} · budget ${esc(String(view.budget.min))}–${esc(String(view.budget.max))} ${esc(view.budget.currency)}</p>`
    + (view.skills.length === 0 ? "" : `<p class="muted">Skills: ${view.skills.map(esc).join(", ")}</p>`)
    + (view.safetyNotes === "" ? "" : `<p class="muted">Safety: ${esc(view.safetyNotes)}</p>`)
    + `<p class="muted">Bids close ${esc(view.bidDeadline)} · ${esc(String(view.itemCount))} items to photograph</p>`
    + (view.photoHints.some((h) => h !== "")
      ? `<ul>${view.photoHints.map((h, i) => h === "" ? "" : `<li>Box ${i + 1}: ${esc(h)}</li>`).join("")}</ul>` : "")
    + `</div>`;
  if (view.status === "cancelled") {
    return head + `<div class="card" id="jb-closed"><p>This job was cancelled.</p></div>`;
  }
  if (view.engagedWithYou) {
    const link = check === null ? ""
      : `<p><a href="${esc(workLink(origin, check.missionId, check.workerToken))}">Open your FieldProof link to start</a></p>`;
    return head + `<div class="card" id="jb-accepted"><p><strong>Job accepted.</strong></p>${link}`
      + `<p class="muted">Contact sharing is arranged separately after acceptance.</p></div>`;
  }
  if (view.selectedForYou) {
    return head + `<div class="card" id="jb-selected"><p><strong>You've been selected.</strong></p>`
      + `<div class="row"><button id="jb-accept" class="primary">Accept the job</button><button id="jb-decline">Decline</button></div></div>`
      + `<div id="jb-out"></div>`;
  }
  if (view.status !== "open" || ["withdrawn", "declined", "not_selected"].includes(view.bid.status)) {
    const word = view.bid.status === "withdrawn" ? "withdrawn"
      : view.bid.status === "declined" ? "declined"
      : view.bid.status === "not_selected" ? "not selected" : view.bid.status;
    return head + `<div class="card" id="jb-closed"><p>Your bid is ${esc(word)}.</p></div>`;
  }
  const b = view.bid;
  const cur = b.price?.currency ?? view.budget.currency;
  const opt = (c: string): string => `<option value="${c}"${c === cur ? " selected" : ""}>${c}</option>`;
  return head + `<div class="card" id="jb-form"><p><strong>Your bid</strong></p>`
    + `<label>Price<input id="jb-price" type="text" inputmode="decimal" value="${b.price === null ? "" : esc(String(b.price.amount))}" /></label>`
    + `<label>Currency<select id="jb-currency">${opt("USD")}${opt("SGD")}${opt("IDR")}</select></label>`
    + `<label>Method (at most 300 characters)<textarea id="jb-method" rows="3" maxlength="300" style="width:100%;box-sizing:border-box">${esc(b.method)}</textarea></label>`
    + `<label>Available from<input id="jb-from" type="date" value="${esc(b.availableFrom)}" /></label>`
    + `<label>Available to<input id="jb-to" type="date" value="${esc(b.availableTo)}" /></label>`
    + `<label>Exclusions (optional, at most 300 characters)<textarea id="jb-excl" rows="2" maxlength="300" style="width:100%;box-sizing:border-box">${esc(b.exclusions)}</textarea></label>`
    + `<label>What you can do (at most 500 characters)<textarea id="jb-cap" rows="3" maxlength="500" style="width:100%;box-sizing:border-box">${esc(b.capability)}</textarea></label>`
    + `<div class="row"><button id="jb-send" class="primary">${b.status === "submitted" ? "Update bid" : "Send bid"}</button>`
    + `<button id="jb-withdraw">Withdraw</button></div></div>`
    + `<div id="jb-out"></div>`;
}

export function renderClaim(): string {
  return `<h1>A job was drafted for you</h1>`
    + `<div class="card" id="jc-card"><p>An AI agent drafted this field job. Enter the client access code to open it as the job owner — this link itself carries no access.</p>`
    + `<label>Access code<input id="jc-code" type="password" autocomplete="off" /></label>`
    + `<button id="jc-open" class="primary">Open this job</button></div><div id="jc-out"></div>`;
}
