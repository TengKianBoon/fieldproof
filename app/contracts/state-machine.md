# FieldProof state machine (R003 batch 1, lead-authored)

## Mission states
`draft -> open -> consented -> capturing -> in_review -> decided -> exported`
Side exits: any non-terminal state `-> abandoned` (stale recovery).

## Item states (per expected lot item, 3 per mission)
`expected -> observed_clear | unclear`
`unclear -> closeup_requested -> observed_clear | unclear` (max 2 close-ups per item)
`unclear` after 2 close-ups `-> inconclusive`
`observed_clear` vs expected `-> matched | mismatched`
`mismatched -> human_review -> confirmed_match | confirmed_mismatch | inconclusive`
Terminal per item: `matched | confirmed_match | confirmed_mismatch | inconclusive | abandoned`.

## Rules (binding)
- `null`/`unclear` is never a match. Insufficient evidence never resolves to `matched`.
- Comparison is plain code on structured observed labels, never model judgment.
- Expected lot values are NEVER supplied as OCR hints to any reader (mocked or model).
- A plot pin and a file hash prove nothing about presence/authenticity on their own.
- Human `decided` is a separate explicit action; the pipeline may only recommend.
- Transitions validate `(from, event)` pairs in code; illegal transitions throw (tested).
- Stale recovery: `capturing` with no activity past TTL `-> abandoned`; leases expire; idempotency keys make resume safe.
