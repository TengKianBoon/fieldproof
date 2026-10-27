# Setup verification — FieldProof (STARTUP track), authoritative receipt

Date (UTC): 2026-10-27. Owner: TKB. This receipt supersedes stale statements in `setup-status.md`.

## Identity and installation
- Muse Code 1.4.13-R6996.1 installed; SHA256 verified by the operator.
- Browser and CLI identify Kian Boon TENG.
- Supplied team 1771758987397743 contains the auto-created Muse Code project/key, distinct from original dashboard project 1245100108696800.

## Confirmed configuration
- Saved settings and TUI confirm: muse-spark-1.3, medium effort, capacity 1, automatic delegation off, foreign personal rules/skills off.
- Windows sandbox check reports ready.
- Cost authority: US$5 TOTAL for all initial setup/model tests, synthetic non-sensitive content only. An automatic dollar hard stop has NOT been configured or verified.
- Free-credit notice actually observed on the signed-in billing page: "While using free credits your content may be used for product improvement." Only synthetic non-sensitive content is authorized.
- Usage: US$0.18 was an earlier session estimate, not the final total; final usage is recorded externally after this turn.

## Git
- Initialized successfully on attempt 2 with the explicit Git executable, confined to this workspace.
- `status` succeeded with the exact-workspace inline `safe.directory` exception only. No global exception, no commit, no staging.

## Permissions actually observed
- Protected `.agents` memory writes DID require explicit allow-once approvals, which the operator granted. Do not claim no permission was needed.
- Sandbox write constraints and protected-write approvals are technical controls.
- The four-attempt rule, no-sibling reads, routing, and the US$5 total ceiling are operating instructions with operator review. Do not call these technically enforced.

## Harness inventory
- Six harness files plus this receipt: `AGENTS.md`, `docs/setup-status.md`, `docs/workflow.md`, `docs/setup-verification.md`, `.gitignore`, `.agents/memory/MEMORY.md`, `.agents/memory/index.md` (pointer).
- Hooks remain deliberately deferred until a real test command exists. No app and no public deployment built.

## Addendum 2026-10-27 — separate-git-dir migration (BLOCKED, not complete)
- TKB authorized a narrow Git-only exception: `C:\Users\User\GIT\Muse 261027 Hckton Gits\fieldproof.git` as this project's separate Git directory (also recorded in `AGENTS.md`).
- Pre-migration inspection: source `.git` holds 9 positively identified `desktop.ini` files (106 bytes each, Explorer artifacts) at `.git/`, `hooks/`, `info/`, `objects/`, `objects/info`, `objects/pack`, `refs/`, `refs/heads`, `refs/tags`. No commits exist; `config`, `HEAD`, `description` are the only real content. Destination parent is a real directory (not a junction/symlink); `fieldproof.git` verified absent (nothing overwritten).
- Migration attempt 1 FAILED: creating `fieldproof.git` denied (`UnauthorizedAccessException`). Cause verified read-only: session runs as `muse-sbx-r1`, which holds only RX on the destination parent; full control belongs to `User`. No `.git` pointer written, no internals moved, nothing deleted, no global config changed.
- Proposed remedy (operator action): grant the sandbox identity write access to `...\Muse 261027 Hckton Gits\fieldproof.git`, or pre-create that directory writable by it; then re-authorize one migration retry. Sandbox left enabled throughout.
- Update: scoped one-time approval for the authorized path was requested through the tool (`require_escalated`, create-dir + relocate + pointer only) and the operator rejected/aborted it. Per tool guidance it will not be retried unless asked. Migration remains blocked; source `.git` untouched in place.

## Addendum 2026-10-27 — separate-git-dir migration (COMPLETE, Git-native method)
- Operator directed Git's supported relocation instead of manual moves. Preconditions re-verified: source `.git` still a directory; destination `fieldproof.git` absent.
- Approved narrow command executed: explicit Git executable + exact inline `safe.directory`, `git init --separate-git-dir="C:/Users/User/GIT/Muse 261027 Hckton Gits/fieldproof.git"` from the 8ofX worktree. Result: `Reinitialized existing Git repository in .../fieldproof.git/`. Config/HEAD preserved by Git's own move (no commits existed).
- `.git` in 8ofX is now a pointer FILE: `gitdir: C:/Users/User/GIT/Muse 261027 Hckton Gits/fieldproof.git` (read back verified).
- Contamination positively identified: `show-ref` proved `refs/desktop.ini`, `refs/heads/desktop.ini`, `refs/tags/desktop.ini` were bad refs; content is Google Drive File Stream folder art (`[.ShellClassInfo]`, Drive `IconResource`), not Git data. Removed exactly the 9 known `desktop.ini` files inside the new Git dir (pre-list matched 9, post-list empty). No other deletion, no reset, no global exception.
- Post-clean checks all pass (exit 0): `show-ref` silent; `status --short` lists only `?? .agents/ .gitignore AGENTS.md docs/`; `fsck --no-dangling` reports only `notice: No default references`; `--git-dir` and `--show-toplevel` resolve to the new location and the 8ofX worktree.
- Residual notes (SUPERSEDED 2026-10-27): Git repatriated to `8ofX\.git` per TKB (D10 revoked). Non-escalated `Get-Location` from 8ofX now succeeds — R002-S1 RESOLVED by the move; sandbox shell functional again.

## Addendum 2026-10-27 — Git repatriation (COMPLETE)
- Pointer verified first (65-byte gitdir file); external `fieldproof.git` verified a real directory, not a link; nothing else at risk of overwrite.
- Pointer moved to `.git.pointer.bak`, full external dir moved to `.git` via literal paths (attempt 1, approved, exit 0); backup removed after success. No restore needed. No recursive deletion, no commit/push.
- `.git` is a directory again. `status` clean (4 untracked harness paths); `count-objects` 0 objects; `for-each-ref`/`fsck` report ONLY the known `desktop.ini` ref warnings — Google Drive recreated the artifacts inside the synced tree within minutes, as predicted. Reported without reopening the location decision; repo fully functional, warnings cosmetic.
- Old path `...\fieldproof.git` no longer exists (moved, not copied). Parent `Muse 261027 Hckton Gits` remains hackathon-reserved and empty of this project. `AGENTS.md` updated so no agent reuses the old directory.

## Addendum 2026-10-27 — R003 batch 1 slice DONE (lead-only, mocked) — STATUS CORRECTED BY 5X22 REVIEW BELOW
- Commits: `7ec4a3e` (42 files: contracts, core, functions, scaffold) + `be5aee8` (boundary + UI-load tests). No push, no remote.
- Tests: 25/25 pass via `node --test app/tests/` from workspace root (flow, classification, isolation, chunks/hash incl. 12MiB+1 boundary, no-double-charge, timeout-uncertain, exhaustion, export limits, held-out seal, dev-identity gate).
- Spike SKIPPED with reason: `app/.env.local` absent (verified), no fieldproof-dev key provisioned; never created/borrowed. Batch app-call spend US$0.00 (mocked only, well within S$10).
- Held-out H1..H6 sealed (hashes in `tests/heldout/MANIFEST.md`); dev fixtures used by tests. Fixtures + `.local-data` + `.env.local` verified git-ignored and absent from commits.
- Environment lessons: node strip-only TS (no constructor parameter properties — fixed, 2 attempts); C:/-style absolute paths for node CLIs; Drive hardlinks new files fast (edit_file may refuse app files — write right first time); non-escalated shell healthy with `.git` back in 8ofX.
- Observer controls: none in supported config help; `config status` shows no planes. Still 1 worker.
- Unmet/limits: no tsc/vite (no npm in sandbox) — no typecheck, no verified `vite dev` smoke; `main.ts` needs browser; `node --check` does not support TS strip mode. Canonical MEMORY.md batch entry was declined by operator approval — memory sync pending; facts live here instead.

## Addendum 2026-10-27 — 5X22 review + B5/B1-B4 repairs (commit 8c4d061)
- CORRECTIONS: batch 1 NOT accepted (37 mocked passes are not G1 acceptance). Missing-key claim WITHDRAWN: root 8ofX/.env.local exists (Test-Path True; contents never read/printed). Fixtures H1-H6/dev .bin are random bytes, not images; no frozen real-image eval claimed.
- B5: 3 deterministic real PNGs generated locally (self-contained encoder, no paid gen): clear-B17 efb9ca53…, blurred-B17 df6210ee…, covered-B71 8913988f… (400x160, verified PASS, manifest app/.local-fixtures/img/IMAGES.md). Dev fixtures only; spike stays paused.
- B1: capture-submit takes completed uploadId only, rejects client labels (tested injection → 400), server reader adapter derives labels, uploadId+serverHash stored.
- B2: crypto-UUID server IDs, per-chunk/complete mission+item ownership, init gated on capturing + valid item, idempotent re-init, pre-consent/cross-item tests.
- B3: 2MiB chunk cap, FileBlobStore replaces process Map, 12MiB/6-chunk + restart-persistence + sweep tests.
- B4: versioned CAS on missions/ledger/counters (conflict surfacing), 6 concurrency tests incl. near-ceiling exactly-once and persisted attempt limits.
- Key plumbing: META_API_KEY server-side only; `.env.example` committed (non-secret); root `.env.local` verified ignored; `hasModelKey()` boolean gate tested. Validity unproven; no paid call made.
- Git: named-file commits only (8c4d061, 25 files); this run showed LF/CRLF notices only, no broken-ref errors in commit output (desktop.ini warnings reported earlier, untouched). No push/deploy.
- Spend: $0.00 app/model (all local, spike paused). Session cumulative per operator: US$5.44 at segment start, +US$0.75 authorized; live total not visible here — operator to confirm against US$6.19 stop and S$10 batch. B6-B13 backlog; stopped for review.

## Addendum 2026-10-27 — batch-2 slice 1 (commit 583dc7e; G1 still unaccepted)
- B14: only clear+label compared; blurred B17 never matched, value retained, inconclusive after 2 close-ups. B7: null/empty -> unclear, never mismatched.
- B6: decide needs in_review; finishReview needs all-terminal; export needs decided; worker state-view hides reviewerDecision; review-flow handlers (toReview/markInconclusive/finishReview) added; full HTTP decided-export path tested.
- Upload-record CAS (chunk/complete conflict surfacing) + cross-mission chunk/complete denial tests. Suite 41/41 mocked (not acceptance).
- Spike: harness dry-run passes (prompt has no expected values; endpoint unset); dispatch quarantined (no confirmed endpoint/schema, key never loaded, SPIKE_CONFIRMED unset). Paid calls $0.00.
- Contracts updated (api/acceptance/storage-production.md with Postgres/Blobs requirements). Memory batch-2 entry declined by approval — facts live here.
- Spend: $0.00 app/model this slice. Operator baseline US$5.44; live delta invisible here; US$10 interim incremental ceiling applies; S$20 batch-2 within S$150. No npm/tsc/vite in sandbox (no typecheck/build smoke). B8-B13 undefined, untouched. No deploy/subagents.

## Addendum 2026-10-27 — spike R1-R9 implemented, dry-run reviewed, NO paid run (UNCOMMITTED)
- 5X28 evidence adopted (endpoint POST https://api.meta.ai/v1/responses, muse-spark-1.3 Standard, reasoning medium, text.format json_schema, usage fields, Standard prices, store:false). Cancelled web fetch replaced; no web access used.
- R1-R9 in app/scripts/spike.mts: hardcoded endpoint+model (no overrides), per-image requests, reworded prompt (244 chars, no expected values), R3 mapping, R4 usage formula (invented x-cost header deleted), R5 bound US$0.0585 est. < US$0.50 (2000-token input labeled ESTIMATE, no hard-cap claim), R6 key only under --run+SPIKE_CONFIRMED (never printed), R7 post-hoc scoring, R8 receipt incl. raw excerpts to muse-runs/.
- S1-S6 dispatch rules implemented; S7 storage-production citation corrected to D15/D18 (D19 is Git-location, unrelated).
- Dry-run exit 0 (sanitized output in muse-runs/spike-dryrun-2026-10-27.md for 4ofX/5ofX review). Suite 46/46 incl. costing/scoring tests. SPIKE_CONFIRMED unset; key never loaded.
- BASELINE CORRECTION: US$5.44 was an earlier reading, NOT a measured repair-close baseline — baseline UNVERIFIED, nothing invented. Checkpoint just measured: cumulative est. USD12.16; delta 6.72 since 5.44; remaining USD3.28 under interim USD10 ceiling.
- Commit for this slice was DECLINED at approval — all R1-R9 work is UNCOMMITTED in the tree. No push. Next: B6a-e per 5X27, then toolchain/B8-B13; paid run only after section-4 gate (review + network approval + TKB spend agreement).

## Addendum 2026-10-27 — B6a-e implemented, 50/50 green, committed 8eadfdd
- 4X31 fixture blocker honored: blurred-B17 legible, R7-on-blurred invalid; NO fixture change and NO paid run pending 5ofX decision. Spike stays quarantined.
- B6a: matched items reviewable (overturn false clears); finishReview needs explicit reviewer decision per matched/mismatched item (review_incomplete); terminal set fixed (confirmed_*).
- B6b: export requester/reviewer only (worker 403). B6c: worker view is capture brief, no expected labels, no decisions. B6d: revocation enforced on state/export (persistence B9). B6e: capture/close-up/upload-init/chunk/complete require capturing; toReview needs all items matched/mismatched/inconclusive.
- Suite 50/50 (new b6 negative tests; HTTP decided-export incl. role views + revoke). Two real test-expectation failures fixed (terminal set; late-upload now correctly refused at init).
- Anomaly: app/tests/handlers.test.ts briefly absent from the tree mid-turn (cause unknown — Drive sync suspected); restored by full rewrite, suite re-verified green before commit. No data loss; no .git deletions.
- Spend: $0.00 app/model. Cumulative est. USD12.16 checkpoint stands; ~USD3.28 under interim ceiling per operator math. Next: toolchain/B8-B13 per order; paid run only after fixture decision + section-4 gate.

## Baseline 2026-10-27 — batch-1 repair segment closed (5X25/D20)
- Last operator-verified cumulative: US$5.44 (20,186,416 tokens; observers 327 / 4,049,031 tokens). Live delta since then NOT visible in-session; do not claim usage zero — coding/observers count.
- Batch-2 (D20): S$20 within aggregate S$150, lead-only. Interim ceiling: US$10 incremental until verified figures arrive (conservative planning factor S$2/US$1 on delta since US$1.44 is NOT an FX quote).
- App/model spend to date: $0.00 (no paid calls; spike paused). Baseline live total: operator to confirm; checkpoint reported here before further work. — ordinary Git/file work inside 8ofX is unaffected for the operator, but future agent shell steps spanning the link need scoped approval. Drive File Stream may re-drop `desktop.ini` into synced folders; the new Git dir sits outside the synced tree. No commit, remote, push, billing change, or app build.
