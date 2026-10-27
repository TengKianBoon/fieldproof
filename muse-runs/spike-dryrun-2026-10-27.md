# Spike dry-run v2 PRODUCED 2026-10-27 — joint review complete, 5X32 (no network, no spend)

Command: `node app/scripts/spike.mts --dry-run` (exit 0).
Endpoint/model hard-coded: POST https://api.meta.ai/v1/responses, muse-spark-1.3, reasoning medium.

## Per-image request bodies (R9/S9: base64 replaced by `<b64, N bytes, sha256 ...>`; no key material)

### clear-B17.png (2061 bytes, sha256 efb9ca53091c05d1f67db473f9daa44618b8df9ee19184ddd4ab2831ce527764)
Same body shape as below; image `<b64, 2061 bytes, sha256 efb9ca53091c05d1f67db473f9daa44618b8df9ee19184ddd4ab2831ce527764>`.

### soft-B17.png (2050 bytes, sha256 df6210eeaeaaa9887e4024d5b7659659b41ce120561b7d1e48135907c8ad373b)
Same body shape; image `<b64, 2050 bytes, sha256 df6210eeaeaaa9887e4024d5b7659659b41ce120561b7d1e48135907c8ad373b>`.

### unreadable-B17.png (33699 bytes, sha256 1458639eabdbd619c7feea59f4a27b3fd0f8b57b5d780aeea24be04ee22f9a35)
Same body shape; image `<b64, 33699 bytes, sha256 1458639eabdbd619c7feea59f4a27b3fd0f8b57b5d780aeea24be04ee22f9a35>`.

### covered-B71.png (1645 bytes, sha256 8913988fdd54721addfe7e92c6ae356dd2b87441ad5ec2020d60a0afdd89622c)
{"model":"muse-spark-1.3","store":false,"reasoning":{"effort":"medium"},"max_output_tokens":4000,"input":[{"type":"message","role":"user","content":[{"type":"input_text","text":"Look at the warehouse box label in this image and report its readability. If the lot code is clearly readable, give it exactly as printed (letters and digits only). Otherwise return an empty lot_code. Never guess a code you cannot clearly read."},{"type":"input_image","image_url":"<b64, 1645 bytes, sha256 8913988fdd54721addfe7e92c6ae356dd2b87441ad5ec2020d60a0afdd89622c>","detail":"high"}]}],"text":{"format":{"type":"json_schema","name":"lot_code_reading","strict":true,"schema":{"type":"object","additionalProperties":false,"required":["readability","lot_code"],"properties":{"readability":{"type":"string","enum":["clear","blurred","covered","absent"]},"lot_code":{"type":"string","description":"Exact code as printed, letters and digits only. Empty string unless readability is clear."}}}}}}

All four hashes match app/.local-fixtures/img/IMAGES.md and the 5X32 verification.

## Prompt audit
- 244 chars. No expected lot values anywhere.
- Transcribe-only-if-clear, else empty lot_code, never guess.

## Cost bound (planning figure, NOT a bound, NOT a provider cap)
- Per call planning figure: 2,000 input est. x US$1.25/1M + 4,000 output x US$4.25/1M = US$0.0195.
- Four calls: US$0.0780 < US$0.50 reserve. Usage-driven actuals settle from documented `usage` (nested cached tokens); missing/invalid/non-completed charges the figure marked unknown and stops the run.
- Key gate tested (presence boolean only); env parser tested (strict KEY= lines).

## Gate status (section-4 checklist)
1. S8-S14 + review fixes implemented, dry-run v2 posted: YES (this file).
2. Joint review: COMPLETE — 5X32 approves four fixtures, spike code, B6g. Round 2 closed.
3. Network approval for api.meta.ai: PENDING (4ofX to confirm visibly scoped to api.meta.ai only).
4. TKB spend agreement: batch3 S$20 ceiling recorded (4X40/5X32-D22); paid dispatch awaits scoped run instruction.
5. Paid run: NOT DONE (SPIKE_CONFIRMED unset, key never loaded).
