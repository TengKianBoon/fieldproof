# FieldProof acceptance criteria (R003 batch 1)

## Batch exit
- [ ] Mocked phone loop passes: mission -> consent -> capture x3 (incl. 1 unreadable -> <=2 close-ups) -> review (B17 vs B71 mismatch) -> human decision -> export pack.
- [ ] All mocked unit/function tests pass; failures/limitations reported, none hidden.
- [ ] Spike has a result or an explicit skip reason (key absent expected).
- [ ] Spend within S$10 batch cap incl. observers; reserve intact.

## Test matrix (all mocked, synthetic only)
- Complete flow, evidence classification (clear/blurred/covered/unreadable), access isolation (cross-mission denied), chunk reconstruction + final hash, duplicate-job/no-double-charge, provider-timeout cost uncertainty, budget exhaustion, export/download limits.
- Cases: D1..D6 development (used by tests). H1..H6 held-out (fixtures sealed in `tests/heldout/`, sha256 logged here, never imported by tests).
  - H1 clear B17 match / H2 B17-vs-B71 mismatch / H3 blurred readable after 1 close-up / H4 covered unreadable after 2 close-ups -> inconclusive / H5 null observed -> never match / H6 cross-mission token reuse -> denied.
  - Sealed sha256 (recorded at freeze, verified by re-hash at review): see `tests/heldout/MANIFEST.md`.
- Paid smoke tests need ledger receipts; mocked passing tests are NOT model accuracy evidence.

## Caps enforced in code
- 12 MiB max chunk; 48 MiB overall evidence cap per mission; 812 MB declared upload rejected at init.
- 2 close-ups per item; 3rd rejected. Expiring links enforced (tamper/expiry/cross-mission tested).
- Budget: reserve-before-dispatch, settle-actuals, retain-uncertain-on-timeout; exhaustion blocks new dispatches.
