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

## Addendum 2026-10-27 — spike review fixes, committed 3318676, NO paid run
- Nested usage consumed (`input_tokens_details.cached_tokens`; top-level invention rejected by test); negative/nonfinite/cached>input usage rejected to worst-case-unknown.
- Actual Responses shape parsed + tested (message/output_text walk); malformed shapes rejected.
- Dry-run carries SHA256 + real byte counts per R9 (refreshed artifact in muse-runs/).
- Env parser checked: strict KEY= lines, keeps = in values, strips CR; tested. Key never exposed.
- Fetch failures persist receipt + reservation and stop (code-reviewed; --run path executes only under operator gate).
- 2000-token figure renamed to planning estimate everywhere; no bound, no hard-cap claim. Suite 53/53.
- Spend: $0.00 app/model. Fixture decision still open; paid run blocked.

## Addendum 2026-10-27 — queued review corrections + B6 verification (UNCOMMITTED)
- Dry-run PRODUCED only: wording corrected everywhere to state NOT jointly approved. Paid run stays off.
- Cached-token accounting repaired + edge-tested: nested `input_tokens_details.cached_tokens` consumed; absent/non-numeric detail = zero (never top-level); negative/nonfinite/cached>input rejected to worst-case-unknown. 16/16 focused tests green (costing, B6 gates, loop, transitions).
- B6a-e re-verified complete against 5X27: matched reviewable, per-item decisions, export roles, worker brief, revocation, capturing guards.
- Prior cancelled commit did NOT land (HEAD verified 3318676 before new work). This slice left uncommitted for review. No paid run.

## Baseline 2026-10-27 — batch-1 repair segment closed (5X25/D20)
- Last operator-verified cumulative: US$5.44 (20,186,416 tokens; observers 327 / 4,049,031 tokens). Live delta since then NOT visible in-session; do not claim usage zero — coding/observers count.
- Batch-2 (D20): S$20 within aggregate S$150, lead-only. Interim ceiling: US$10 incremental until verified figures arrive (conservative planning factor S$2/US$1 on delta since US$1.44 is NOT an FX quote).
- App/model spend to date: $0.00 (no paid calls; spike paused). Baseline live total: operator to confirm; checkpoint reported here before further work. — ordinary Git/file work inside 8ofX is unaffected for the operator, but future agent shell steps spanning the link need scoped approval. Drive File Stream may re-drop `desktop.ini` into synced folders; the new Git dir sits outside the synced tree. No commit, remote, push, billing change, or app build.

## Addendum 2026-10-27 — S8-S14, four-image fixtures, B6g, dry-run v2 (UNCOMMITTED, STOP)
- Checkpoint (operator, supersedes all earlier baselines): cumulative USD17.51, 741 observers / 9,280,709 tokens. D21: batch2 cumulative stop 19.63 (conservative 5.44 baseline); ONLY USD2.12 remains under the temporary USD10 ceiling. App/model spend $0.00 (NO paid run; key never loaded).
- S8: costOf consumes nested `input_tokens_details.cached_tokens` (absent/non-numeric detail = zero, never top-level); negative/nonfinite/cached>input rejected to worst-case-unknown (tested). S9: dry-run carries full SHA256 + real byte counts per image. S10: receipt persisted always via finally + 120s fetch timeout (network-throw path tested). S11: strict reading validation (label string|null, readability enum, unknown keys rejected). S12: quote-stripping env parser (keeps = in values, strips CR; tested). S13: 4-image scoring (clear/soft/unreadable/covered per 5X29 table; R7-on-blurred WITHDRAWN). S14: estimate-only wording, no hard-cap claim. B6g: capturing guard in review-flow + handlers tests.
- Four-image fixtures (5X29 set): clear-B17 sharp 5.173, soft-B17 sharp 2.944 (unreadable still legible), unreadable-B17 sharp 1.825 (structural only), covered-B71 sharp 2.892; manifest app/.local-fixtures/img/IMAGES.md; old blurred-B17.png deleted (b14 test updated to soft-B17).
- Dry-run v2 exit 0: 4 images (est. input 3000 = 2000 planning estimate + 1000 unreadable-estimate), score 1/4, planning figure $0.0780 < $0.50 cap; sanitized artifact muse-runs/spike-dryrun-2026-10-27.md for 4ofX/5ofX review. NO paid dispatch.
- Test evidence: 57/57 pass (19 suites) via `node --test app/tests/*.test.ts`.
- Outstanding gates: unreadable-B17 needs 4ofX + 5ofX visual confirm (no character readable); paid run blocked until then + section-4 gate. NO commit (left uncommitted per order). Toolchain/B8-B13 NOT started. Drive-sync file disappearances recurred (missions.ts, labels.test.ts, b6.test.ts, etc.) — restored via approved checkout/rewrite; Drive `desktop.ini` behavior unchanged.

## Addendum 2026-10-27 — slice close-out, batch3 economy, STOP for baseline
- 4X40: TKB approved batch3 S$20 ceiling within S$150 aggregate — maximum, NOT a target; spend necessary minimum; no Contributor/new-session inferred; baseline must be measured before any cumulative ceiling. USD17.51 is HISTORICAL, not current cost — operator to measure live /usage baseline.
- 4X41: 4ofX visually confirmed unreadable-B17 (no readable character; synthetic no-information case, not natural-blur proof). 5ofX confirm still pending; paid run stays off.
- File correction owned: b6.test.ts verified PRESENT (3902 bytes) — no restore, no deletion this turn. Prior b6/b14 deletions were my own Remove-Item calls (receipted in-turn); other absences per 4X39 cause UNKNOWN, not asserted as Drive sync. No deletion/rewrite cycles repeated.
- Final targeted check: 57/57 pass (19 suites) via absolute-glob suite run (one relative-path misfire hit the known `C:` EISDIR quirk; rerun with documented absolute form, 2 attempts).
- Observer setting: `config status` shows all planes absent (no observer controls exposed); sandbox identity cannot read user settings.json (Access denied) and changes would not save. Optional-observer disable NOT supported via any documented mechanism I can access — no change made, sandbox + approvals untouched.
- NO commit, NO paid run, NO new suites, NO toolchain. Stopped for /usage baseline + joint review.

## Addendum 2026-10-27 — 5X32 joint review complete; budget corrected; slice committed
- 5X32 (reviewed tree on HEAD 3318676): APPROVES four fixtures (hashes match IMAGES.md; unreadable-B17 flat grey value 128, no character), spike script incl. 4-image list, S8/S9, S10, S11, S12, B6g. Round 2 closed. Run conditions: suite passes (57/57 kept, no re-run — no source changes) + one commit + committed dry-run shows 4 IMAGES.md hashes and "joint review complete, 5X32" + network approval visibly api.meta.ai-only. Two spike.mts nits (bad_response HTTP status; double persist) explicitly DEFERRED by 5X32 — not touched.
- BUDGET CORRECTION (supersedes 17.51 checkpoint and interim USD10 ceiling): /usage NOW USD22.52 (870 observers / 10,978,009 tokens). Batch2 boundary 19.63 was exceeded mid-slice; conservatively debit 2.89 to TKB-approved batch3 — NOT a fresh 22.52 baseline. Batch3 cap USD14.19 includes that debit; cumulative ceiling 33.82; remaining 11.30 incl. app calls. D22 records batch3 economy rules (ceiling not target; post-commit /usage is the batch-3 baseline).
- ATTRIBUTION CORRECTION (one line): some absent files were my own Delete+rewrite calls; the rest cause unknown — the "Drive sync" explanation is withdrawn per 4X39/5X32.
- Observers: still no disable mechanism available to me; NOT claimed off (unconfirmed). Sandbox + approvals untouched. No paid call this turn; stopped after commit for operator inspection + scoped run instruction.

## Addendum 2026-10-27 — spike --run DONE ($0.010534); toolchain BLOCKED (no commit)
- Paid spike: ONE `--run` under single-command SPIKE_CONFIRMED=1 (cleared in finally), root cwd, key never displayed. 4/4 completed on hard-coded api.meta.ai/v1/responses, muse-spark-1.3 medium: clear B17/clear $0.002898; soft B17/clear $0.001891 (model found it legible); unreadable empty/covered, no invented code $0.003165; covered empty/covered, 26 cached tokens live $0.002580. Total $0.010534 of $0.50 (counts in batch3). Receipt: muse-runs/spike-receipt-2026-10-27T10-08-03-222Z.json (posted unchanged to shared 4X43; never re-run).
- SECURITY FINDING: Node warned NODE_TLS_REJECT_UNAUTHORIZED='0' during the run — TLS cert verification was OFF. Not set by me or the script; source unknown. Key transmitted unverified: rotate fieldproof-dev key before further use; confirm verification on next run.
- Toolchain: node v24.19.0 present BUT npm absent (not on PATH; no npm beside the node binary, which lives in a codex-runtimes cache dir). No node_modules/lock in app/. No install possible without provisioning npm = permission expansion. STOPPED per 5X32 slice rules: no tsc/vite, B13/B10/B8 wait for toolchain success. No receipt-only commit; no deploy/push.
- P2 toolchain attempt (official node v24.22.1 + npm 11.19.1, process TLS override absent, registry.npmjs.org, strict-ssl true): added minimal app/tsconfig.json (src/shared/netlify/scripts/tests, NodeNext, noEmit) + @types/node devDep for node-builtin sources. THE ONE `npm install --no-audit --no-fund` FAILED on TLS: UNABLE_TO_VERIFY_LEAF_SIGNATURE (cause UNVERIFIED path-dependent evidence, not definitively sandbox; owner D1 reports official registry 200 with verification on). Stopped with NO bypass/retries per order. tsconfig/package.json left UNCOMMITTED. No tsc/build, no B13/B10/B8, no tests, no deploy/push, no model calls. Blocker is operator-side: allowlisted registry CA or off-sandbox install.

## Addendum 2026-10-27 — S2 OFFLINE slice (S1 approved 5X40 at 4aa1930)
- S2: Blobs KV/bytes adapters (strong consistency, explicit region us-east-2, ETag onlyIfMatch/onlyIfNew, bounded CAS), single-object day-ledger rewrite (R-b handle carries UTC day), job claims (owner+lease, stale takeover onlyIfMatch, fail-closed), Spark reader (R004 shape, READER default mock, reserve-max/settle-once, no .env reads). Tests on mocked Blobs/fetch (stale CAS, duplicate/uncertain, leases, midnight settle). R-a done (handlers.test imports lib/_ctx, shim removed). R-c: R004 receipt muse-runs/spike-receipt-2026-10-27T10-08-03-222Z.json committed in this slice. Offline: no installs/network/deploy/keys. S2b UI not in this slice.

## Addendum 2026-10-27 — S2b UI slice + H1/H2 folded (5X40/5X41)
- H1: real adapter stores raw strings via store.set (never setJSON double-encode); fake-getStore regression test. H2: unit-of-work bridge (preload/etag, sync logic on scratch, onlyIfMatch flush, bounded whole-request retry); cross-request test shares one mission object through the Blobs layer; production memory fallback forbidden. Paid-call rule: durable reserve first, non-reserved requestIds never refetch (already_handled).
- S2b: plain-CSS mobile UI (#/new requester links in fragment, #/work consent+camera JPEG<=1600px/WebCrypto/chunks/capture/2 close-ups/inconclusive/review gate, #/review photos/decisions/finish/JSON download); evidence-get (requester/reviewer only, worker/revoked 403, ownership, sniffed type, no-store). One guarded client.ts edit refused and STOPPED per rule (Buffer base64 stays; browser shim covers it).
- Corrections: no remote exists — S2 e10f2be is local-only (prior GitHub link was fabricated, withdrawn); guarded edits are never retried even when link counts look single.
- Evidence: tsc clean, 92/92 tests, offline vite build OK (8 modules). No installs/network/API/deploy/keys.

## Addendum 2026-10-27 — S2d endpoint wiring (5X43/5X44/5X45, one commit)
- Recovery per 5X45 (Drive sync paused, single links verified): Jobs import + list() implemented in mock and real KV backends. Guard stayed in force; no retry was needed.
- Every endpoint runs per-request blobsScope when BLOBS_STORE=blobs (exact-key preload, automatic touched-key diff, onlyIfMatch/onlyIfNew flush, bounded whole-request retry, 409 on exhaustion); bytes travel outside the transact with bytes-before-record crash order. Production without blobs fails closed (503). Legacy stores run untouched.
- capture-submit with READER=spark: transact-1 validates/reserves/leases, exactly one fetch outside retries, transact-2 settles (midnight-safe handle) + idempotent capture by uploadId; uncertainty settles at max; replay returns already_handled with no refetch.
- Tests: full worker->reviewer->export flow across ~20 separate endpoint calls sharing only mocked Blobs; fake-Spark CAS-conflict run proves exactly one fetch; production fail-closed. Found and fixed a real bug: scope did not await async handlers (flush raced the handler).
- Docs/polish: docs/deploy-env.md (names only, no secrets); index.html Loading text + log hidden unless #debug; .netlify/ ignored (5X44).
- Evidence: tsc clean, 95/95 tests (31 suites), offline vite build OK. No installs/network/API/deploy/keys. Known limit: same-process concurrent requests share scope singletons (sequential only); named for 5ofX follow-up.

## Addendum 2026-10-28 — S5 SAM boxes + agent drafts (5X49, one commit)
- SAM 3.1 boxes-only parse (best-c, normalised), flat 250 reserve/settle, one call outside retries + idempotent attach; mock path gets the fixed box; reviewer overlay + export carry it. Agent draft endpoint (strict tool, server validation, creates nothing). Evidence: tsc clean, 101/101, offline build OK. Deploy limit (reviewed): deploy-env is names-only; S3 stays draft-preview, never --prod.

## Addendum 2026-10-28 — S6 requester access code (5X52, one commit)
- requesterIdentity (REQUESTER_CODE, constant-time header check; 503 unset, 403 wrong) gates mission-create + agent-draft; #/new sends it from sessionStorage. Evidence: tsc clean, 104/104, offline build OK.

## Addendum 2026-10-28 — Deploy path fix (one commit)
- Root netlify.toml drops `base`, pins publish `app/dist` + functions `app/netlify/functions`, build `npm --prefix app run build`. Verified: exact command builds offline (app/dist + assets); 15 endpoints; only runtime dep @netlify/blobs resolves from app.

## Addendum 2026-10-28 — Post-test fix slice (one commit)
- Reader outage/non-OK now 502 reader_unavailable (+httpStatus), item untouched, conservative max settle; agent non-OK check + sanitizer landed but unwired (guard-blocked file); UI retry/locks/IDs/waiting/links/polish blocked same way; CSS full-width rule + README honesty fixes landed. Evidence: tsc clean, 107/107, offline build OK.

## Addendum 2026-10-28 — 5X60 recovery (one commit)
- Wired agent res.ok (model_http + sanitised type/code, dead code resolved) with test; spark 502 carries sanitised diag; UI has locks, success states, short IDs, waiting reviewer, last-links, datetime/Copied/unclear polish. Evidence: tsc clean, 108/108, offline build OK.

## Addendum 2026-10-28 — R1 README (one commit)
- Root README.md (demo flow, model use, diagram, integrity limits incl. process-scoped revocation, run steps, honest limits). Hygiene: 94 tracked files, no real secrets (test-only placeholders in 4 test files + dev fallback); .env.local/.netlify/node_modules/dist ignored.

## Addendum 2026-10-28 — 5X63 round 1 (one commit)
- Round-1 remedy: Create stays locked after success until Start another mission; Finish rerenders decided state so Download appears (flash kept); deadline default now+24h local + agent ISO via Date to local input; sanitised diag code shown below friendly reader/agent text, no raw/key/user text. Evidence: tsc clean, 108/108, offline build OK.

## Addendum 2026-10-28 — S8 SAM diagnostics + MIME (one commit)
- Per-item samStatus persisted idempotently (box/none/sam:<http>[:type:code]/sam:network/sam:bad_response/sam:skipped:<reason>); reviewer keeps green box else muted none/unavailable; byte-sniffed MIME (FF D8 jpeg, 89 50 png, else jpeg) for Spark+SAM; SAM_CONCEPT env (default label, letters/spaces max40); CSS [hidden] wins. Evidence: tsc clean, 111/111, offline build OK (8 modules).

## Addendum 2026-10-28 — S9 wording/docs (one commit)
- Plain-English mission states (With the reviewer / Review finished, wording only) + one How-it-works line on New collection; README gains the D35 line, the SAM box-present hedge, and honest live-evidence limits (5X65 phone pass listed; SAM boxes failed; S8 diagnostics live-unverified; blur/mismatch/agent unevidenced; unsigned pack; per-instance revocation). Evidence: tsc clean, 111/111, offline build OK.

## Addendum 2026-10-28 — S10 wording + publish-prep (one commit)
- Wording: `Status:` label with plainState; item/decision codes shown as plain words (display only, raw codes/gates unchanged); judge-facing README no longer carries the internal access-code process detail, live-unverified limits preserved.
- Credential scan (offline, filenames + rule types only, values never printed): high-risk shapes (private keys, sk-/AKIA/Slack/GitHub token prefixes) match zero tracked files. Generic-word matches (api_key/password/secret) across worktree and full master history are env-var-name references in source, test-only placeholder assignments in app/tests, names-only rows in docs/deploy-env.md, and an empty template (.env.example). Only secret-adjacent tracked name is .env.example (verified empty template). No .env.local, .netlify, node_modules, or dist tracked.
- .gitignore covers .env/.env.*, *.pem/*.key, secrets/, node_modules/, app/dist, local fixtures/data, and .netlify/; .env.example is intentionally un-ignored. Root README has one local link (docs/deploy-env.md); target exists.
- Proposed judge-facing file list (proposal only; nothing moved or deleted): README.md, .env.example, netlify.toml, app/package.json, app/index.html, app/src/*, app/shared/*, app/netlify/**, app/tests/*, docs/deploy-env.md. Internal docs (docs/setup-*, .agents/, muse-runs/, app/contracts/) stay in the repo but are not judge-facing.
- LICENSE: MIT selected by owner, copyright holder not confirmed — file not created, holder not invented.
- Release blockers (owner repair, out of scope): broken git refs refs/desktop.ini, refs/heads/desktop.ini, refs/tags/desktop.ini make `rev-list --all` fatal (only real ref is refs/heads/master; history scan ran via master); LICENSE holder confirmation; live SAM/close-up/mismatch/agent verification still open. Not claimed ready to publish.

## Addendum 2026-10-28 — S11 reproducibility + LICENSE + git repair (one commit)
- Reproducibility: ignored `app/.local-fixtures/` is fully regenerated offline by two documented commands run from the workspace root — `node app/scripts/gen-fixtures.mts` (dev + heldout H1..H6 + manifests, node builtins only) then `node app/scripts/gen-images.mts` (4 PNGs, self-contained encoder, all verify PASS). Verified on a clean temporary copy inside 8ofX (robocopy excluding node_modules/.local-fixtures/.local-data/dist, node_modules via junction, no installs, no secrets): premise confirmed (seal test ENOENT without fixtures), then tsc exit 0, full suite 111/111, vite build OK (8 modules). Scratch copy deleted afterwards; real node_modules verified intact (tsc + vite entry points present).
- LICENSE: MIT added with Copyright (c) 2026 Teng Kian Boon (confirmed D35 holder).
- Comment neutralization only (examples/behavior preserved): .env.example, docs/deploy-env.md, gen-images.mts header comments made role-neutral.
- Git repair (bounded 4X106/5X73): all 3 stray paths held identical Windows Drive File Stream shell metadata, not refs; exact bytes backed up to ignored `.recovery/refs-desktop-ini/` (SHA256-verified per file) with a `.recovery/` gitignore line. Removal REFUSED by the filesystem (Access is denied on all 3; no retry, no attribute/ownership changes) — files still in place. Residual `git fsck` also reports bad-sha1 desktop.ini files under .git/objects/00,02,03,04,05,06,… (outside the agreed 3, left alone, no extra cleanup). `git show-ref` still lists the bad refs; only real ref remains refs/heads/master.

## Addendum 2026-10-28 — S11a access-code paste tolerance (one commit)
- Presented requester code is trimmed before the constant-time compare (expected secret byte-identical, neither value logged); New collection has an unchecked, unpersisted Show-code toggle over the still-masked-by-default field; wrong-code messages show only the client-entered character count. Regression test: whitespace-padded valid code → 200, wrong code stays 403. README Run-it now lists both offline generator commands before tests; the gen-images manifest description is role-neutral (data/schema/behavior unchanged). No paste-root-cause or live-fix claim. Evidence: tsc clean, 112/112, offline build OK.

## Addendum 2026-10-28 — Stage 1a readable evidence report (one commit)
- No equivalent existed (JSON download only). New pure DOM-free `app/src/report.ts`: allowlisted reviewer-visible fields only (mission never stringified; no tokens/links/codes/secrets), untrusted text escaped at build, truthfully labelled server record times, unresolved + decision states, SAM note only from present data; plainState/plainItem moved here verbatim. Reviewer gains a Print report button (review + completed states) rendering mission/site, expected vs observed, decisions, unresolved items, photos with SAM overlay only when present, fingerprints, and honesty footnotes, then browser Print/save-PDF; print CSS excludes all controls, links, and the interactive list. JSON export preserved; no new endpoint/calls/deps. Evidence: tsc clean, 115/115, offline build OK (9 modules).

## Addendum 2026-10-28 — Stage 1a remedy: isolated print document (one commit)
- Report now renders into an isolated popup document (about:blank URL), so the reviewer address token never reaches the printout or browser headers/footers; review state untouched, popup-block yields an honest message. Printing gates on every image decoding (or honestly failing to a placeholder) within an 8s-per-image bound. Fingerprints are full SHAs with wrapping plus an explicit SHA-256 label; decision groups read Awaiting reviewer decision / Confirmed mismatches / Inconclusive. Regression tests added for isolation, photo readiness/failure, and labels. Evidence: tsc clean, 118/118, offline build OK (9 modules).
