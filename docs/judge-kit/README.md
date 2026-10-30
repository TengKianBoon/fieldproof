# FieldProof judge kit

Synthetic materials for trying FieldProof without real field samples. They show no real company, shipment or person.

| File | Use it for |
|---|---|
| `label-B12.png`, `label-B17.png`, `label-B23.png` | Tags that match the sample delivery note |
| `label-B71.png` | A deliberate look-alike. Photograph it for the **B17** item to see a flagged mismatch |
| `label-SB0412.png` | A field sample-bag tag, for a check of your own (enter `SB0412` as an item code) |
| `sample-delivery-note.png` | Choose it under **Draft from delivery note**. Muse Spark drafts the site, codes and deadline with the text it read. The note shows no time zone, so you pick one before creating |

## Sample agent run

[`sample-run/`](sample-run/) holds the output of one synthetic run on the live site: Muse Spark, as the client's agent, drafted a job; the website steps were carried out in the client, field-professional and reviewer roles; and the agent then fetched the evidence. No real customer, field professional, payment or location is involved.

| File | What it is |
|---|---|
| [`agent-transcript.md`](sample-run/agent-transcript.md) | The agent's two messages and replies, with the tools it called (the claim link and credential prompts are omitted) |
| [`evidence-report.pdf`](sample-run/evidence-report.pdf) | The printed evidence report: each photo, its decision and its SHA-256 fingerprint |
| [`evidence-pack.json`](sample-run/evidence-pack.json) | The unsigned JSON evidence pack for the same three decisions |

**How to use the tags:** show a tag on another screen (or print it) and photograph it from the field professional link. On a desktop browser, the photo button lets you choose the image file instead.
