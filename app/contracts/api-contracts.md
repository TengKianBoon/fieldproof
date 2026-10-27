# FieldProof API contracts (R003 batch 1, local mocked)

Base: `/.netlify/functions/<name>`. JSON bodies. Errors: `{ "error": "<code>", "detail"?: string }`.
Auth: mission-scoped HMAC link token (`missionId.role.exp.sig`); server secret only.
Requester sign-in: local fake identity is DEVELOPMENT-ONLY and throws when
`FIELDPROOF_ENV=production`. Production choice: documented TODO (supported
provider), not selected in this batch.

## Endpoints
- `POST mission-create` `{ siteLabel, expectedItems[3], deadline } -> { missionId, inviteLink(worker), reviewLink }` (requester)
- `POST consent-accept` `{ missionId, workerId, consentVersion, token } -> { lease }` (versioned consent required before capture)
- `POST upload-init` `{ missionId, itemId, attemptId, bytesTotal, chunkSize, manifestHash, idempotencyKey, token } -> { uploadId, chunkCount }` (rejects over 48 MiB cap; 812 MB declared total is rejected here)
- `POST upload-chunk` `{ uploadId, index, bytesB64, sha256, idempotencyKey, token } -> { received }` (12 MiB max per chunk; duplicates deduped; out-of-order accepted)
- `POST upload-complete` `{ uploadId, token } -> { serverHash, verified }` (final server hash; client-reported original hash recorded separately, never trusted as verified)
- `POST closeup-request` `{ missionId, itemId, reason, token } -> { closeupId }` (max 2 per item; 3rd rejected `closeup_exhausted`)
- `POST capture-submit` `{ missionId, itemId, uploadId, observedLabel | null, readability, token } -> { itemState }`
- `POST review-decide` `{ missionId, itemId, decision: confirmed_match|confirmed_mismatch|inconclusive, reviewerNote, token } -> { itemState }` (reviewer = link-holder unless verified identity present)
- `GET export-pack` `{ missionId, token } -> evidence pack JSON (expected beside observed, hashes, ledger receipts, decisions)` (size-limited; over-limit split or rejected with `export_too_large`)
- `GET mission-state` `{ missionId, token } -> full mission + item states` (ownership-scoped; cross-mission token rejected)

## Invariants
- Background functions receive IDs, never image payloads. No arbitrary blob-key endpoints.
- Expiring links: tamper/expiry/cross-mission enforced in code; tokens never in logs/referrer (POST bodies only, no GET query tokens except export-pack body-equivalent — export uses POST-shaped GET with header token; documented).
- Double taps / platform retries reuse idempotency keys: no counter reset, no duplicate charge.
