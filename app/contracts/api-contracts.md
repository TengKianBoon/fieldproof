# FieldProof API contracts (R003 batch 1, local mocked; B1-B4 repaired)

Base: `/.netlify/functions/<name>`. JSON bodies. Errors: `{ "error": "<code>", "detail"?: string }`.
Auth: mission-scoped HMAC link token (`missionId.role.exp.sig`); server secret only.
Requester sign-in: local fake identity is DEVELOPMENT-ONLY and throws when
`FIELDPROOF_ENV=production`. Production choice: documented TODO (supported
provider), not selected in this batch.

## Endpoints
- `POST mission-create` `{ siteLabel, expectedItems[3], deadline } -> { missionId, inviteLink(worker), reviewLink }` (requester)
- `POST consent-accept` `{ missionId, workerId, consentVersion, token } -> { lease }` (versioned consent required before capture or upload-init)
- `POST upload-init` `{ missionId, itemId, manifest{...no uploadId...}, idempotencyKey, token } -> { uploadId (server UUID), chunkCount }` (B2: init requires capturing state + valid item; rejects over 48 MiB cap; same key returns same id)
- `POST upload-chunk` `{ uploadId, itemId, index, bytesB64, hash, token } -> { received }` (B3: 2 MiB max per chunk; duplicates dedupe; out-of-order accepted; record mission/item ownership enforced)
- `POST upload-complete` `{ uploadId, itemId, idempotencyKey, token } -> { serverHash, verified, clientHash }` (ownership enforced; final server hash; usage counter via CAS)
- `POST closeup-request` `{ missionId, itemId, token } -> { closeupsUsed }` (max 2 per item; 3rd rejected `closeup_exhausted`)
- `POST capture-submit` `{ missionId, itemId, uploadId, token } -> { itemState }` (B1: completed uploadId ONLY; any `observedLabel`/`readable` in body rejected; server validates record mission/item/completion/hash, reads evidence via server reader adapter, stores uploadId+serverHash)
- `POST review-decide` `{ missionId, itemId, decision: confirmed_match|confirmed_mismatch|inconclusive, token } -> { itemState }` (reviewer = link-holder unless verified identity present)
- `GET export-pack` `{ missionId, token-header } -> evidence pack JSON (expected beside observed, uploadIds, server hashes, ledger receipts, decisions)` (size-limited; over-limit rejected `export_too_large`)
- `GET mission-state` `{ missionId, token-header } -> full mission + item states` (ownership-scoped; cross-mission token rejected)

## Invariants
- Background functions receive IDs, never image payloads. No arbitrary blob-key endpoints.
- Bytes persist via BlobStore (file-backed locally); no process-only Maps.
- Mutations are versioned CAS writes; lost updates surface as `conflict`, never silent overwrites.
- Expiring links: tamper/expiry/cross-mission enforced in code; tokens never in logs/referrer (POST bodies/headers only).
- Double taps / platform retries reuse idempotency keys: no counter reset, no duplicate charge.
- Model key: META_API_KEY server-side from root `.env.local` only (never VITE_, never client); presence boolean only, value never logged. Paid spike paused until real-image gate + operator release.
