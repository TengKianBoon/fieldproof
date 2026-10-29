# Deploy environment (S2d; owner route at S3)

Names and meanings only. Secret VALUES live in the Netlify UI (never in
PowerShell history, never in git). Beginner setup steps are provided
separately after S2d approval.

| Variable | Meaning | Safe value / source |
|---|---|---|
| FIELDPROOF_ENV | Runtime mode. `production` arms fail-closed gates (server secret required, test seams forbidden, memory store fallback refused). | `production` |
| BLOBS_STORE | Which state backend endpoints use. `blobs` runs every request inside a per-request Blobs transact; anything else is dev/test only. | `blobs` |
| READER | Label-reading path. `spark` calls the model once per capture (reserve-max/settle-once); `mock` keeps the PNG stand-in. | `spark` |
| META_API_KEY | Model key, server-side only. Fresh key per T6 rotation; the old key is deleted after S3. | New key in Netlify UI only |
| SAM_CONCEPT | SAM label prompt noun phrase (letters/spaces only, max 40 chars; anything else falls back to `label`, never blocks capture). | `label` |
| SAM_MODE | `off` switches SAM 3.1 off entirely: no call, no spend, no per-item "AI box" line. Unset or any other value leaves SAM on. | Unset (SAM on), or `off` |
| FIELDPROOF_SECRET | Signs mission links (requester/worker/reviewer). | Random value in Netlify UI only |
| REQUESTER_CODE | Access code for mission-create and agent-draft in production (header `x-requester-code`, constant-time check). | Secret in Netlify UI only; type it once on the #/new page |
| LEDGER_CEILING_USD | Model-spend ceiling per UTC day. Missing or invalid fails closed (US$2 demo default only in non-production code). | `2` |
| FIELDPROOF_DATA_DIR | Local file-store directory. Dev/test only; never set in production (ephemeral disk, per-instance memory loss). | Unset in production |

Notes:

- Blobs region is explicit in code (`us-east-2`, the site default). Field
  photos therefore rest in the US; revisit before any real pilot (H3, D12).
- `.netlify/` (CLI state, site ID) is git-ignored per 5X44 and must never
  reach a public repo.
- S3 deploys a draft preview only, inside the D18 credit guard; never
  `--prod` from this flow.
- Deployment limitation (5X46, reviewed): Netlify serves one request per
  instance — the per-request transact design assumes no shared in-process
  state between requests.
