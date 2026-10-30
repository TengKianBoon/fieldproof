# Sample agent run

Synthetic demonstration recorded on 30 October 2026. The two agent excerpts come from the same conversation. Credential-entry prompts, local setup commands and the claim link have been omitted.

## Request

You: Get the sample-bag tags B12, B17 and B23 at Sample store A in Riau photographed and checked. This is a synthetic demonstration. Budget 50 to 100 US dollars. Bids close 31 October 2026 at 18:00 Singapore time; work on 1–2 November 2026; check due 3 November 2026 at 18:00 Singapore time.

[tool] post_field_job: ok

Agent: Draft job for Sample store A saved as DRAFT — 3 tags, work 1–2 Nov.

Open claim link to review and publish, then invite and choose:
[claim link omitted]
Enter access code to publish. I can't publish, invite or choose.

## Website steps

Between the two messages, the website steps (claim, publish, invite, bid, select, accept, three synthetic photo submissions and the review decisions) were carried out on the live site in the client, field-professional and reviewer roles, with synthetic data.

## Evidence returned to the agent

You: How did the job go? Please get the evidence.

[tool] get_job_status: ok
[tool] get_field_check_status: ok
[tool] get_evidence_pack: ok

Agent: Review finished for Sample store A — person decided all items:

- 2 confirmed matches
- 1 confirmed mismatch needing attention: expected B17 read as B71

Evidence pack exported 2026-10-30:
- B12 / B12 match — fingerprint fa174c72…
- B17 / B71 mismatch — fingerprint 6d2d46f8…
- B23 / B23 match — fingerprint ddb25699…

Fingerprints show stored photo bytes unchanged.

## Companion evidence

The report PDF and unsigned JSON evidence pack document the same three decisions. The abbreviated fingerprints above match their full SHA-256 values. Times in the report are server record times. A fingerprint verifies the stored bytes; it does not establish where or when a photo was captured. This demonstration used synthetic labels and no real customer data.
