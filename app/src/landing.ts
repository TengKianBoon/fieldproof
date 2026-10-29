// F2 presentation landing (lead-owned). Pure markup only: no imports, no
// network, no telemetry, no external fonts, images, or scripts. The router
// mounts it at #/; buttons are wired in ui.ts.
export function landingHTML(): string {
  return `<div class="topbar"><p><strong>FieldProof</strong> <span>by 180Climate</span></p></div>`
    + `<div class="hero"><svg viewBox="0 0 32 32" width="40" height="40" role="img" aria-label="FieldProof mark"><rect x="2" y="2" width="28" height="28" rx="7" fill="#123826" /><path d="M10 16.5l4.5 4.5L22 11" stroke="#f2c14e" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round" /></svg>`
    + `<h1 class="hero-title">Field evidence people can trust.</h1>`
    + `<p class="hero-sub">Request a field check, guide the field professional item by item, let Meta's Muse Spark read each tag, flag what needs a closer look, and keep a person in charge of every decision, with an evidence report and targeted follow-ups.</p>`
    + `<button id="l-start" class="primary">Start a field check</button>`
    + `<button id="l-how">How it works</button></div>`
    + `<div class="card" id="l-steps"><p><strong>How it works</strong></p><ol>`
    + `<li><strong>Client brief.</strong> Describe the check: site, boxes, deadline, and optional tips.</li>`
    + `<li><strong>Guided capture.</strong> The field professional photographs each label, item by item.</li>`
    + `<li><strong>AI reading and suggestions.</strong> Meta's Muse Spark reads every label; FieldProof suggests what needs a closer look.</li>`
    + `<li><strong>Human decision and evidence report.</strong> A person confirms each item and keeps the report.</li>`
    + `</ol></div>`
    + `<div class="card" id="l-strip"><p><strong>Now (working today):</strong></p>`
    + `<ul><li>Guided capture</li><li>AI label reading</li><li>AI review suggestions</li><li>Human decision</li><li>Evidence report</li><li>Targeted follow-up</li><li>Optional location check-in</li><li>Agent access (MCP)</li></ul>`
    + `<p><strong>Next.</strong> AI agents requesting field checks across the 180Climate Fieldwork network.</p>`
    + `<p><strong>Future.</strong> Hands-free capture on display glasses.</p></div>`
    + `<p class="muted">Built for Meta's Global AI Developer Hackathon. Demo data only.</p>`;
}
