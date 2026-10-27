# FieldProof acceptance criteria (batch 2; G1 NOT accepted — B-review pending)

## Batch exit
- [x] Mocked phone loop passes on server-derived evidence to a decided export (41/41).
- [x] B14: only clear+label compared; blurred B17 never matched, value retained, inconclusive after 2 close-ups.
- [x] B7: null/empty labels route unclear, never mismatched.
- [x] Spike harness dry-run passes (prompt has no expected values); paid dispatch quarantined (no endpoint confirmed, no key loaded).
- [ ] Spend within caps (operator-verified figures); reserve intact.
- [ ] 5X25 review of B14/B6/upload-CAS/cross-mission additions.

## Test matrix (all mocked, synthetic only)
- Flow, classification on real PNG bytes, ownership/isolation incl. cross-mission chunk/complete, chunks/hash (2 MiB cap, 12 MiB/6-chunk, restart persistence, sweep), no-double-charge, timeout-uncertain, exhaustion, export limits, CAS concurrency, key gate, role-scoped views.
- D-cases used by tests. H1..H6 sealed random bytes are NOT image eval. B5 PNGs are dev fixtures for a released spike only.
- Paid smoke tests need ledger receipts; mocked passes are NOT model accuracy evidence.

## Caps enforced in code
- 2 MiB max chunk; 48 MiB mission cap; 812 MB declared upload rejected.
- 2 close-ups per item; expiring links enforced; versioned CAS with conflict surfacing.
- Budget: reserve/settle/uncertain/release; exhaustion blocks dispatches; US$0.50 spike reserve built into harness.
