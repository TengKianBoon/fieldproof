// M1: the consented check-in location on a map, for the client who reviews.
// The field professional agreed to share one device location "so the client
// sees one location, accuracy and time"; only the reviewer view carries the
// coordinates, and the printed report includes them only when the reviewer
// opts in. Everything here is built from numbers and fixed text only.
export interface GeoView {
  fix: { lat: number; lon: number; accuracyM: number; distanceM: number | null } | null;
  site: { lat: number; lon: number; radiusM: number } | null;
}

const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

// Accepts the reviewer's stored record ({attempts, fix:{latitude,...}}) or a
// coordinate-free public view (then fix is null), and the planned site
// (a requester-redacted {radiusM} gives null).
export function geoFromMission(m: { checkin?: unknown; siteLocation?: unknown }): GeoView {
  let fix: GeoView["fix"] = null;
  const c = m.checkin;
  if (typeof c === "object" && c !== null) {
    const o = c as Record<string, unknown>;
    const f = (typeof o.fix === "object" && o.fix !== null ? o.fix : o) as Record<string, unknown>;
    if (num(f.latitude) && num(f.longitude) && num(f.accuracyM)) {
      fix = { lat: f.latitude, lon: f.longitude, accuracyM: f.accuracyM, distanceM: num(f.distanceM) ? f.distanceM : null };
    }
  }
  let site: GeoView["site"] = null;
  const s = m.siteLocation;
  if (typeof s === "object" && s !== null) {
    const o = s as Record<string, unknown>;
    if (num(o.latitude) && num(o.longitude) && num(o.radiusM)) site = { lat: o.latitude, lon: o.longitude, radiusM: o.radiusM };
  }
  return { fix, site };
}

export function fmtCoord(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

// Google Maps URL (no API key): opens the exact coordinates.
export function googleMapsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)}%2C${lon.toFixed(6)}`;
}

// OpenStreetMap embed (no API key) centred on the point, spanning about
// spanM metres each way, with a marker.
export function osmEmbedUrl(lat: number, lon: number, spanM: number): string {
  const dLat = spanM / 111_320;
  const cos = Math.max(0.01, Math.cos((lat * Math.PI) / 180));
  const dLon = spanM / (111_320 * cos);
  const f = (x: number): string => x.toFixed(6);
  return `https://www.openstreetmap.org/export/embed.html?bbox=${f(lon - dLon)}%2C${f(lat - dLat)}%2C${f(lon + dLon)}%2C${f(lat + dLat)}&layer=mapnik&marker=${f(lat)}%2C${f(lon)}`;
}

export function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = (d: number): number => (d * Math.PI) / 180;
  const y = Math.sin(r(bLon - aLon)) * Math.cos(r(bLat));
  const x = Math.cos(r(aLat)) * Math.sin(r(bLat)) - Math.sin(r(aLat)) * Math.cos(r(bLat)) * Math.cos(r(bLon - aLon));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function distM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = (d: number): number => (d * Math.PI) / 180;
  const s = Math.sin(r(bLat - aLat) / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(r(bLon - aLon) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.min(1, Math.sqrt(s)));
}

const SIZE = 240;
const C = SIZE / 2;
const REACH = 92;

// Where the check-in point sits in the diagram (exported for tests): the
// site centre is the middle; north is up.
export function diagramPoint(g: GeoView): { x: number; y: number; k: number } | null {
  if (g.fix === null) return null;
  if (g.site === null) return { x: C, y: C, k: REACH / Math.max(g.fix.accuracyM, 1) };
  const d = distM(g.site.lat, g.site.lon, g.fix.lat, g.fix.lon);
  const k = REACH / Math.max(g.site.radiusM, d + g.fix.accuracyM, 1);
  const b = (bearingDeg(g.site.lat, g.site.lon, g.fix.lat, g.fix.lon) * Math.PI) / 180;
  return { x: C + Math.sin(b) * d * k, y: C - Math.cos(b) * d * k, k };
}

// A small drawn site diagram that prints reliably (no map tiles needed).
export function siteDiagramSvg(g: GeoView): string | null {
  if (g.fix === null && g.site === null) return null;
  const r1 = (x: number): string => x.toFixed(1);
  const parts: string[] = [];
  const H = SIZE + 50;
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${H}" width="${SIZE}" height="${H}" role="img" aria-label="Check-in location diagram">`);
  parts.push(`<rect x="0" y="0" width="${SIZE}" height="${SIZE}" fill="#f4f7f2" stroke="#9bb3a3"/>`);
  parts.push(`<text x="${SIZE - 18}" y="20" font-size="12" font-family="sans-serif" fill="#333">N</text><path d="M${SIZE - 14} 26 L${SIZE - 14} 44" stroke="#333" stroke-width="1.5"/><path d="M${SIZE - 18} 32 L${SIZE - 14} 25 L${SIZE - 10} 32" fill="none" stroke="#333" stroke-width="1.5"/>`);
  const p = diagramPoint(g);
  if (g.site !== null) {
    const k = p === null ? REACH / Math.max(g.site.radiusM, 1) : p.k;
    parts.push(`<circle cx="${C}" cy="${C}" r="${r1(Math.max(2, g.site.radiusM * k))}" fill="rgba(31,90,64,.12)" stroke="#1f5a40" stroke-dasharray="4 3"/>`);
    parts.push(`<circle cx="${C}" cy="${C}" r="2.5" fill="#1f5a40"/>`);
  }
  if (g.fix !== null && p !== null) {
    parts.push(`<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="${r1(Math.max(3, g.fix.accuracyM * p.k))}" fill="rgba(30,90,200,.18)" stroke="#1e5ac8"/>`);
    parts.push(`<circle cx="${r1(p.x)}" cy="${r1(p.y)}" r="3.5" fill="#1e5ac8"/>`);
  }
  const lines: string[] = [];
  if (g.site !== null) lines.push(`Site centre, ${Math.round(g.site.radiusM)} m radius (dashed)`);
  if (g.fix !== null) {
    lines.push(`Check-in, accuracy ±${Math.round(g.fix.accuracyM)} m (blue)`);
    if (g.site !== null && p !== null) {
      const d = g.fix.distanceM ?? distM(g.site.lat, g.site.lon, g.fix.lat, g.fix.lon);
      lines.push(`${Math.round(d)} m from the site centre`);
    }
  }
  lines.forEach((t, i) => parts.push(`<text x="4" y="${SIZE + 14 + i * 14}" font-size="11" font-family="sans-serif" fill="#222">${t}</text>`));
  parts.push(`</svg>`);
  return parts.join("");
}

// The location block for the review page (with an on-request live map) or
// the printed report (diagram + coordinates + Google Maps link).
export function locationSectionHtml(g: GeoView, forPrint: boolean): string | null {
  if (g.fix === null && g.site === null) return null;
  const rows: string[] = [];
  if (g.fix !== null) {
    rows.push(`<p>Check-in coordinates: ${fmtCoord(g.fix.lat, g.fix.lon)} (accuracy ±${Math.round(g.fix.accuracyM)} m) · <a href="${googleMapsUrl(g.fix.lat, g.fix.lon)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a> <span class="muted">(google.com)</span></p>`);
  }
  if (g.site !== null) {
    rows.push(`<p class="muted">Planned site: ${fmtCoord(g.site.lat, g.site.lon)}, radius ${Math.round(g.site.radiusM)} m · <a href="${googleMapsUrl(g.site.lat, g.site.lon)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a></p>`);
  }
  const svg = siteDiagramSvg(g);
  return `<div class="geo">${rows.join("")}${svg ?? ""}`
    + (forPrint || g.fix === null ? "" : `<p><button id="r-map" type="button">Show on OpenStreetMap</button> <span class="muted">Loads a map from openstreetmap.org, which receives these coordinates.</span></p><div id="r-mapbox"></div>`)
    + `<p class="muted">The device's location when the field professional checked in, shared with their consent. Not the photo capture location.</p></div>`;
}

export function osmIframe(g: GeoView): string | null {
  if (g.fix === null) return null;
  const span = Math.max(150, g.fix.accuracyM * 3, g.site === null ? 0 : g.site.radiusM * 1.5);
  return `<iframe src="${osmEmbedUrl(g.fix.lat, g.fix.lon, span)}" title="Map of the check-in location" width="100%" height="280" loading="lazy" referrerpolicy="no-referrer" style="border:0"></iframe><p class="muted">Map © OpenStreetMap contributors</p>`;
}
