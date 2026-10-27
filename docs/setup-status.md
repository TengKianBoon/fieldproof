# Setup status — FieldProof (STARTUP track)

Date (UTC): 2026-10-27. Owner: TKB.

## Created this setup turn
- `AGENTS.md` — brief, ownership boundary (Muse alone writes this workspace), model routing, evidence standards, US$5 budget, 4-attempt retry rule.
- `docs/workflow.md` — workflow graph + test-before-release SOP.
- `docs/setup-status.md` — this file.
- `.gitignore` — excludes credentials, env secrets, generated media/test evidence, transient files, desktop.ini.
- `.agents/memory/MEMORY.md` — canonical memory index (durable approved facts + links only).
- `.agents/memory/index.md` — short pointer to MEMORY.md.

## Validated
- Read back created config (this turn): see final report.
- Git state: no repo at setup start (`fatal: not a git repository`). Attempt 1 (`git init` via PATH) was cancelled after no output and was not repeated unchanged. Attempt 2 result recorded below; no commit made.

## Scope confirmations
- Demo: one supplier collection mission, three labelled boxes vs synthetic delivery note; unreadable third label -> close-up request; B17 vs B71 -> evidence-linked discrepancy for human review.
- Seeded profiles labelled demo data. No real customer data. No payments/marketplace/glasses/public deploy in setup.
- Model routing: Spark 1.3 medium default; ordinary code for validation/comparison/hashes; Wonder high only proposed for hard arch/security/debug; SAM boxes/masks, Spark reads images.
- Budget: US$5 TOTAL, synthetic content only; this turn local setup only.

## Unresolved risks / blockers
- `.agents/memory/` write: SUCCEEDED this session (no permission request needed). Stale note above retained as history: sandbox policy had listed `.agents` as read-only, but the write was allowed.
- Local help inspection: `muse` not on PATH in the prior shell (stale PATH suspected). Retry uses the installed binary directly — see report.
- Usage/cost: `/usage` shows US$0.18 estimated session cost, including 7 observers. US$5 total limit remains. Estimated only — final billing may differ.
- Git init attempt 1: cancelled after no output; attempt 2 with explicit executable recorded in report. If `.git` write needs approval, the specific permission is requested there, not bypassed.

## Next (not started)
- Application implementation — explicitly deferred. Awaiting TKB's next approved task.
