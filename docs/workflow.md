# Workflow — FieldProof setup

Binding task lifecycle (from [AGENTS.md](../AGENTS.md)):

```
approved task -> plan -> build -> test -> self-review -> report -> external review -> next task / remedy
```

## Stage rules
1. **Approved task**: only work TKB approved. No self-added scope.
2. **Plan**: short, evidence-based; name files and checks before editing.
3. **Build**: smallest change satisfying the approved task; no speculative frameworks.
4. **Test**: run the project's real test command once it exists and is reviewed. Until then, read-back + `git status` is the setup-level check. Defer executable hooks until that command exists.
5. **Self-review**: re-read the request; confirm every clause is met; separate receipts from proposals.
6. **Report**: exact files, attempts used (max 4/step incl. first attempt), evidence observed, remedy proposed.
7. **External review**: TKB reviews. TKB authorizes final hackathon submission.
8. **Next task / remedy**: on failure, record changed-hypothesis retry or stop with blocker.

## Test receipts vs proposals
- **Receipts** (observed facts): command output, files read back, Git status, visible usage/cost.
- **Unresolved risks**: blockers, cost uncertainty, missing permissions — stated plainly.
- **Proposals** (not done): anything not yet executed, reviewed, and tested. Never present a proposal as a receipt.

## Test-before-release SOP (minimal, current)
- No public push, deploy, or submission during setup.
- No executable hooks, package installs, external MCPs, or shell hooks in this phase.
- A written workflow graph (this file) is sufficient now; no graph database or speculative framework.
- Support inspected 2026-10-27 from the installed binary help: a `skills` subcommand exists (list/inspect/enable/disable/validate/install/import/update/uninstall; nothing enabled or installed this turn); no top-level hooks subcommand exists. No packages, external MCPs, or shell hooks enabled.
- Release gate (when an app + real test command exist): tests pass -> self-review done -> TKB external review -> TKB authorizes submission.

## Build baseline gates (approved 2026-10-27; build NOT started)
- G0 (single worker): local mocked full mission-consent-capture-observation-targeted closeup-human review-export, plus storage adapters, server-only keys, persistent job/idempotency/retry/cost state. No insufficient-evidence-as-match.
- Observer validation must pass before any worker fan-out. At most THREE TOTAL workers after that: shared checkout, no worktrees; lead alone Git/shared contracts; capture worker distinct UI files; validation worker distinct tests; no recursion.
- First parallel batch cap S$10 including observers; keep integration reserve. Four total repair attempts across agents/models; runtime retries distinct. Two closeups maximum per item.
- Hooks: exact command review by 5ofX required before activation. No 3-worker start while R002-S1 sandbox-shell blocker is unresolved (recorded 2026-10-27 in setup verification).
