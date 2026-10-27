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
- Unmet/limits: no tsc/vite (no npm in sandbox) — no typecheck, no verified `vite dev` smoke; `main.ts` needs browser; `node --check` does not support TS strip mode. Canonical MEMORY.md batch entry was declined by operator approval — memory sync pending; facts live here instead. — ordinary Git/file work inside 8ofX is unaffected for the operator, but future agent shell steps spanning the link need scoped approval. Drive File Stream may re-drop `desktop.ini` into synced folders; the new Git dir sits outside the synced tree. No commit, remote, push, billing change, or app build.
