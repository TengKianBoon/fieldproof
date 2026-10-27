# AGENTS.md — FieldProof (Meta Hackathon, STARTUP track)

Owner: TKB. This file governs all agents working in this workspace.

## 1. Brief (demo scope, phone-first)
- FieldProof: adaptive field-evidence product for a remote requester + on-site worker.
- Initial demo: one supplier collection mission, three labelled boxes vs a synthetic delivery note.
- Key flow: unreadable third label -> targeted close-up request while worker is on site; expected B17 vs observed B71 -> evidence-linked discrepancy requiring human review.
- Seeded profiles must be labelled demo data. No real customer data.
- OUT OF SCOPE for this setup: payments, broad marketplace, glasses integration, public deployment/push/submission.

## 2. Ownership boundary (exclusive workspace)
- Exclusive application workspace: `C:\Leon G Drive\A Daily Routine\Hackathons\Muse 261027 8ofX`.
- Muse alone writes this application workspace: only Muse may write, edit, add, delete, or run local Git here.
- Git-location decision REVOKED 2026-10-27 (TKB, supersedes D10): the Git directory lives at `8ofX\.git` again. The old path `C:\Users\User\GIT\Muse 261027 Hckton Gits\fieldproof.git` is NOT in use — no agent shall read, write, or point Git there. That parent folder is hackathon-reserved but must remain empty of this project. No other path exception granted.
- Do NOT read or change: sibling folders, other agents' private folders, unrelated personal context.
- Do NOT import Codex/Claude rules, memories, skills, or MCP servers.
- Do NOT create worktrees or output outside this folder.
- Normal application installation/authentication/settings storage is allowed; never expose credentials.
- Sandbox-enforced write scope (tool-level) is distinct from these read restrictions (instruction-level). A writable path is not automatically a permitted read.
- Never self-expand permissions or budget. Improvements must be proposed, reviewed, and tested.
- TKB authorizes the final hackathon submission. No public push/deploy/submission during setup.

## 3. Model routing
- Default: Spark 1.3 at medium reasoning for all routine work.
- Use ordinary code (not model judgment) for exact validation, permission checks, comparison, and hashes.
- Propose Wonder high only for difficult architecture/security/debugging; no automatic escalation, no model fan-out now.
- SAM is for boxes/masks; Spark interprets/reads the images.
- Keep Standard selected; the approved free credits carry their own product-improvement condition (advisory until verified in writing).

## 4. Evidence standards
- Unreadable evidence requires recapture or `inconclusive` status — never a confident guess.
- Keep test receipts and unresolved risks distinct from proposals (see [docs/workflow.md](docs/workflow.md)).
- Verify by reading back created config and checking Git status where available.
- Report: exact files created, actual model/effort, sandbox state, enforced-vs-advisory items, costs if visible, remaining blockers.

## 5. Approved budget (R003 amendment by 5X20 — supersedes the US$5 setup-only ceiling)
- Aggregate ceiling: S$150 for prior setup + all app/model calls. No subscription, no deployment spend.
- This lead-only batch: maximum S$10 all-in, including observers, with integration/demo reserve.
- Capability spike (inside G1, inside the ceilings above): maximum US$0.50.
- Last cumulative Muse estimate: US$1.44 (operator-recorded). Verify current use via operator records; final billing external.
- Stop before cap with conservative dated FX conversion and in-flight allowances.
- App/spike calls use ONLY a separately provisioned fieldproof-dev Model API key supplied at runtime (expected `.env.local`). Never borrow Muse's sign-in credential, print or commit keys. If absent, skip the spike and report; mocked development continues.
- App calls reserve allowed cost before dispatch, settle actuals, retain uncertain cost on provider timeout.
- Stop if you cannot determine whether continuing fits the approved allowance.
- Do not claim a provider hard spending cap unless verified. Report usage/cost only if visible.

## 6. Retry rule (binding)
- Maximum FOUR TOTAL attempts per error/task step, including the first attempt.
- No reset on model changes. Each retry needs a changed, evidence-based hypothesis.
- Stop earlier on: identical failure, missing permission/input, cost uncertainty, or unsafe data.
- Report attempts taken and proposed remedy. See workflow: approved task -> plan -> build -> test -> self-review -> report -> external review -> next task/remedy.

## 7. Build baseline (approved 2026-10-27; NOT started — no application coding yet)
- Product: FieldProof STARTUP. Stack: TypeScript Vite mobile UI + Netlify Functions.
- Order: local mocked full mission-consent-capture-observation-targeted closeup-human review-export first; separate storage adapters; server-only keys; persistent job/idempotency/retry/cost state; no insufficient-evidence-as-match.
- Budget: aggregate S$150 ceiling includes prior setup + app model calls; prior cumulative Muse estimate US$1.44 (currency mix as stated by operator). No subscription or deployment. First parallel batch cap S$10 including observers; keep integration reserve.
- Workers: at most THREE TOTAL workers, only AFTER G0 and observer validation. Shared checkout, no worktrees. Lead alone touches Git/shared contracts. Capture worker: distinct UI files. Validation worker: distinct tests. No recursion.
- Repairs: four total repair attempts across agents/models; runtime retries distinct from repair attempts. Two closeups maximum per item.
- Data: no real data until participant/site consent receipts. Synthetic non-sensitive content only until then.
- Hooks need exact command review by 5ofX before activation. See [docs/workflow.md](docs/workflow.md).
