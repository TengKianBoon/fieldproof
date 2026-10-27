# FieldProof API contracts (batch 2; B1-B4 + B6/B14 gates repaired)

Base: `/.netlify/functions/<name>`. JSON bodies. Errors: `{ "error": "<code>", "detail"?: string }`.
Auth: mission-scoped HMAC link token (`missionId.role.exp.sig`); server secret only.
Requester sign-in: local fake identity is DEVELOPMENT-ONLY and throws when
`FIELDPROOF_ENV=production`. Production choice: documented TODO (supported
provider), not selected in this batch.

## Endpoints
- `POST mission-create` `{ siteLabel, expectedItems[3], deadline } -> { missionId, workerToken, reviewToken, requesterToken }` (requester)
- `POST consent-accept` `{ missionId, workerId, consentVersion, token } -> { state }` (versioned consent before capture or upload-init)
- `POST upload-init` `{ missionId, manifest{...no uploadId...}, idempotencyKey, token } -> { uploadId (server UUID), chunkCount }` (B2: capturing + valid item; 48 MiB cap; same key returns same id)
- `POST upload-chunk` `{ uploadId, itemId, index, bytesB64, hash, token } -> { received }` (B3: 2 MiB max; duplicates dedupe; out-of-order ok; record mission/item ownership enforced)
- `POST upload-complete` `{ uploadId, itemId, idempotencyKey, token } -> { serverHash, verified, clientHash }` (ownership enforced; server hash; CAS usage counter)
- `POST closeup-request` `{ missionId, itemId, token } -> { closeupsUsed }` (max 2 per item; 3rd `closeup_exhausted`)
- `POST capture-submit` `{ missionId, itemId, uploadId, token } -> { itemState }` (B1: completed uploadId ONLY; client labels rejected; server validates record/hash, reads via server adapter, stores uploadId+serverHash; B14: only clear+label compared, blurred/null retained as unclear)
- `POST review-to` worker: `toReview` (capturing->in_review); `markInconclusive` (exhausted unclear, worker). Reviewer: `review-decide` (B6: requires in_review), `finishReview` (B6: requires all items terminal -> decided).
- `GET export-pack` `{ missionId, token-header } -> evidence pack` (B6: requires decided; size-limited)
- `GET mission-state` `{ missionId, token-header } -> mission` (B6: worker view excludes reviewerDecision; cross-mission denied)

## Invariants
- Background functions receive IDs, never image payloads. No arbitrary blob-key endpoints.
- Bytes persist via BlobStore (file-backed locally); no process-only Maps. See `storage-production.md` for Postgres/Blobs requirements.
- Mutations are versioned CAS writes (missions, ledger, upload records, counters); lost updates surface as `conflict`.
- Expiring links: tamper/expiry/cross-mission enforced; tokens never in logs/referrer.
- Double taps / retries reuse idempotency keys: no counter reset, no duplicate charge.
- Model key: META_API_KEY server-side from root `.env.local` only; presence boolean only, value never logged. Paid spike quarantined behind operator-confirmed endpoint + SPIKE_CONFIRMED=1.
