# Spike dry-run for joint 4ofX/5ofX review (2026-10-27, refreshed; no network, no spend)

Command: `node app/scripts/spike.mts --dry-run` (exit 0).
Endpoint/model hard-coded: POST https://api.meta.ai/v1/responses, muse-spark-1.3, reasoning medium.

## Per-image request bodies (R9: base64 replaced by `<b64, N bytes, sha256 ...>`; no key material)

### clear-B17.png (2061 bytes, sha256 efb9ca53091c05d1...)
{"model":"muse-spark-1.3","store":false,"reasoning":{"effort":"medium"},"max_output_tokens":4000,"input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"Look at the warehouse box label in this image and report its readability. If the lot code is clearly readable, give it exactly as printed (letters and digits only). Otherwise return an empty lot_code. Never guess a code you cannot clearly read."},{"type":"input_image","image_url":"<b64, 2061 bytes, sha256 efb9ca53091c05d1>","detail":"high"}]}],"text":{"format":{"type":"json_schema","name":"lot_code_reading","strict":true,"schema":{"type":"object","additionalProperties":false,"required":["readability","lot_code"],"properties":{"readability":{"type":"string","enum":["clear","blurred","covered","absent"]},"lot_code":{"type":"string","description":"Exact code as printed, letters and digits only. Empty string unless readability is clear."}}}}}}

### blurred-B17.png (2050 bytes, sha256 df6210eeaeaaa988...)
Same body shape; image `<b64, 2050 bytes, sha256 df6210eeaeaaa988>`.

### covered-B71.png (1645 bytes, sha256 8913988fdd54721a...)
Same body shape; image `<b64, 1645 bytes, sha256 8913988fdd54721a>`.

## Prompt audit
- 244 chars. No expected lot values anywhere.
- Transcribe-only-if-clear, else empty lot_code, never guess.

## Cost bound (planning figure, NOT a bound, NOT a provider cap)
- Per call planning figure: 2,000 input est. x US$1.25/1M + 4,000 output x US$4.25/1M = US$0.0195.
- Three calls: US$0.0585 < US$0.50 reserve. Usage-driven actuals settle from documented `usage` (nested cached tokens); missing/invalid/non-completed charges the figure marked unknown and stops the run.
- Key gate tested (presence boolean only); env parser tested (strict KEY= lines).

## Gate status (section-4 checklist)
1. R1-R9 + review fixes implemented, dry-run posted: YES (this file).
2. 5X26/4X31 review + 4ofX concurrence: PENDING (fixture decision open: blurred-B17 legible).
3. Network approval for api.meta.ai: PENDING.
4. TKB spend agreement: PENDING.
5. Paid run: NOT DONE (SPIKE_CONFIRMED unset, key never loaded).
