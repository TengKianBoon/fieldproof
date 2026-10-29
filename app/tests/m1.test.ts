// M1: the consented check-in location for the client who reviews: parsing
// (coordinates only from the reviewer's record), Google Maps and OpenStreetMap
// links, a drawn diagram with north up, the report section only on opt-in,
// and the review page wiring.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bearingDeg, diagramPoint, fmtCoord, geoFromMission, googleMapsUrl, locationSectionHtml, osmEmbedUrl, osmIframe, siteDiagramSvg } from "../src/locationMap.ts";
import { buildReport, reportDocument } from "../src/report.ts";

const SITE = { latitude: -0.5, longitude: 101.45, radiusM: 150 };
const record = (lat: number, lon: number, acc = 12) => ({
  attempts: 1,
  fix: { latitude: lat, longitude: lon, accuracyM: acc, fixTime: "2026-10-29T10:00:00.000Z", receivedAt: "2026-10-29T10:00:05.000Z", distanceM: 40, status: "within", stale: false, lowAccuracy: false },
  keptEarlier: false,
});

describe("M1 location parsing and links", () => {
  it("takes coordinates only from the reviewer's stored record", () => {
    const g = geoFromMission({ checkin: record(-0.4996, 101.45), siteLocation: SITE });
    assert.deepEqual(g.site, { lat: -0.5, lon: 101.45, radiusM: 150 });
    assert.equal(g.fix?.lat, -0.4996);
    const pub = geoFromMission({ checkin: { attempts: 1, fix: { status: "within", accuracyM: 12, fixTime: "x", distanceM: 40 } }, siteLocation: { radiusM: 150 } });
    assert.deepEqual(pub, { fix: null, site: null });
    assert.deepEqual(geoFromMission({}), { fix: null, site: null });
  });

  it("formats coordinates and builds key-free map links", () => {
    assert.equal(fmtCoord(-0.4996, 101.45), "-0.49960, 101.45000");
    assert.equal(googleMapsUrl(-0.4996, 101.45), "https://www.google.com/maps/search/?api=1&query=-0.499600%2C101.450000");
    const u = new URL(osmEmbedUrl(1.3521, 103.8198, 200));
    assert.equal(u.hostname, "www.openstreetmap.org");
    const [w, s, e, n] = (u.searchParams.get("bbox") as string).split(",").map(Number);
    assert.ok(w < 103.8198 && e > 103.8198 && s < 1.3521 && n > 1.3521);
    assert.equal(u.searchParams.get("marker"), "1.352100,103.819800");
    const f = osmIframe(geoFromMission({ checkin: record(1.3521, 103.8198) })) as string;
    assert.ok(f.includes('referrerpolicy="no-referrer"') && f.includes("OpenStreetMap contributors"));
  });

  it("draws north up: a check-in north of the site sits above the centre, east sits right", () => {
    assert.ok(Math.abs(bearingDeg(0, 0, 0.001, 0)) < 0.01);
    assert.ok(Math.abs(bearingDeg(0, 0, 0, 0.001) - 90) < 0.01);
    const north = diagramPoint(geoFromMission({ checkin: record(-0.4996, 101.45), siteLocation: SITE })) as { x: number; y: number };
    assert.ok(north.y < 120 && Math.abs(north.x - 120) < 0.5);
    const east = diagramPoint(geoFromMission({ checkin: record(-0.5, 101.4504), siteLocation: SITE })) as { x: number; y: number };
    assert.ok(east.x > 120 && Math.abs(east.y - 120) < 0.5);
    const svg = siteDiagramSvg(geoFromMission({ checkin: record(-0.4996, 101.45), siteLocation: SITE })) as string;
    assert.ok(svg.startsWith("<svg") && svg.includes("150 m radius") && svg.includes("from the site centre"));
    assert.ok(!svg.includes("NaN"));
    const onlyFix = siteDiagramSvg(geoFromMission({ checkin: record(1, 1) })) as string;
    assert.ok(onlyFix.includes("Check-in, accuracy ±12 m") && !onlyFix.includes("NaN"));
    assert.equal(siteDiagramSvg({ fix: null, site: null }), null);
  });
});

describe("M1 report and review page", () => {
  const mission = {
    missionId: "m-m1", state: "decided", siteLabel: "Riau plot 7",
    deadline: "2026-11-30T10:00:00.000Z", createdAt: "2026-10-29T09:00:00.000Z",
    expected: [{ itemId: "box1", expectedLabel: "B17" }], observed: {}, reviewerDecision: {},
    checkin: record(-0.4996, 101.45), siteLocation: SITE,
  };

  it("keeps the default report coordinate-free and adds the location only on opt-in", () => {
    const data = buildReport(mission);
    const plain = reportDocument(data, [null]);
    assert.ok(!plain.includes("-0.49960") && !plain.includes("google.com/maps"));
    const withLoc = reportDocument(data, [null], locationSectionHtml(geoFromMission(mission), true));
    assert.ok(withLoc.includes("Check-in coordinates: -0.49960, 101.45000"));
    assert.ok(withLoc.includes("https://www.google.com/maps/search/?api=1&amp;query") || withLoc.includes("https://www.google.com/maps/search/?api=1&query"));
    assert.ok(withLoc.includes("<svg") && !withLoc.includes('id="r-map"'));
    assert.ok(withLoc.includes("Not the photo capture location"));
  });

  it("the review page shows the location to the reviewer and loads the live map only on request", () => {
    const html = locationSectionHtml(geoFromMission(mission), false) as string;
    assert.ok(html.includes('id="r-map"') && html.includes('id="r-mapbox"') && !html.includes("<iframe"));
    // M1b: the third-party map is named on the control, and the professional's consent mentions a map.
    assert.ok(html.includes("Show on OpenStreetMap") && html.includes("openstreetmap.org, which receives these coordinates"));
    assert.ok(html.includes("(google.com)"));
    const src = readFileSync("app/src/ui.ts", "utf8");
    assert.ok(src.includes("the client sees one location, accuracy and time, including on a map."));
    assert.match(src, /checkinCard\(m\.checkin, geo\)/);
    assert.match(src, /bindMapButton\(geo\);/);
    assert.match(src, /<input type="checkbox" id="r-printloc" \/>/);
    assert.match(src, /withLoc \? locationSectionHtml\(geo, true\) : null/);
  });
});
