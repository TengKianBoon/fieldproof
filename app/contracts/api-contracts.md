# FieldProof API contracts (batch 2; B1-B4 + B6a-e/B14 gates repaired)

Base: `/.netlify/functions/<name>`. JSON bodies. Errors: `{ "error": "<code>", "detail"?: string }`.
Auth: mission-scoped HMAC link token; server secret only; revocation enforced on every endpoint (B6d; persistence is B9).
Requester sign-in: local fake identity is DEVELOPMENT-ONLY and throws when
`FIELDPROOF_ENV=production`. Production choice: documented TODO, not selected.

## Endpoints
- `POST mission-create` `{ siteLabel, expectedItems[3], deadline } -> { missionId, workerToken, reviewToken, requesterToken }`
- `POST consent-accept` `{ missionId, workerId, consentVersion, token } -> { state }`
- `POST upload-init/chunk/complete` (worker; B2 UUIDs + ownership; init/chunk/complete all require capturing — no late evidence after review starts)
- `POST closeup-request` `{ missionId, itemId, token } -> { closeupsUsed }` (capturing only; max 2 per item)
- `POST capture-submit` `{ missionId, itemId, uploadId, token } -> { itemState }` (B1: completed uploadId only, client labels rejected; B14: only clear+label compared, blurred/null retained as unclear)
- `POST review-to` worker: `toReview` (needs every item matched/mismatched/inconclusive), `markInconclusive` (exhausted unclear). Reviewer: `review-decide` (B6a: matched AND mismatched reviewable, requires in_review), `finishReview` (B6a: every matched/mismatched item needs an explicit reviewer decision).
- `GET export-pack` `{ missionId, token-header }` (B6b: requester/reviewer only, worker 403; requires decided; size-limited)
- `GET mission-state` `{ missionId, token-header }` (B6c: worker gets capture brief — IDs + states, no expected labels, no reviewer decisions)

## Invariants
- Background functions receive IDs, never image payloads. No arbitrary blob-key endpoints.
- Bytes persist via BlobStore (file-backed locally); see `storage-production.md` (D15/D18) for Postgres/Blobs requirements.
- Mutations are versioned CAS writes (missions, ledger, upload records, counters); lost updates surface as `conflict`.
- Expiring links: tamper/expiry/cross-mission enforced; tokens never in logs/referrer.
- Idempotency keys: no counter reset, no duplicate charge.
- Model key: META_API_KEY server-side from root `.env.local` only; presence boolean only. Paid spike quarantined (operator-confirmed endpoint + SPIKE_CONFIRMED=1).
