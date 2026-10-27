# FieldProof acceptance criteria (R003 batch 1; G1 NOT accepted per 5X22 — B1-B4 repaired, awaiting review)

## Batch exit
- [x] Mocked phone loop passes on server-derived evidence (B1).
- [x] Mocked unit/function tests pass (36/36); failures fixed, none hidden.
- [x] Spike SKIPPED with reason (paused per 5X22: fixtures were random bytes; B5 real PNGs now exist but paid spike needs operator release).
- [ ] Spend within S$10 batch cap incl. observers; reserve intact (operator-verified).
- [ ] 5X22 review of B1-B4 repairs (this report).

## Test matrix (all mocked, synthetic only)
- Complete flow, evidence classification on real PNG bytes, access/ownership isolation, chunk reconstruction + final hash, duplicate-job/no-double-charge, provider-timeout cost uncertainty, budget exhaustion, export/download limits, CAS concurrency.
- Cases: D1..D6 development (used by tests). H1..H6 held-out random-byte fixtures remain SEALED and are NOT image eval (no frozen real-image eval claimed).
- B5 PNGs (clear-B17/blurred-B17/covered-B71, manifest `app/.local-fixtures/img/IMAGES.md`) are dev fixtures for a future released spike only.
- Paid smoke tests need ledger receipts; mocked passing tests are NOT model accuracy evidence.

## Caps enforced in code
- 2 MiB max chunk (B3); 48 MiB overall evidence cap per mission; 812 MB declared upload rejected at init.
- 2 close-ups per item; 3rd rejected. Expiring links enforced (tamper/expiry/cross-mission tested).
- Budget: reserve-before-dispatch, settle-actuals, retain-uncertain-on-timeout; exhaustion blocks new dispatches.
- Server-minted UUID uploadIds; ownership enforced on chunk/complete/capture; init gated on capturing + valid item.
