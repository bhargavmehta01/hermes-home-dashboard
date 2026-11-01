import assert from "node:assert/strict";
import test from "node:test";

import {
  ALL_PANELS,
  PANEL_SLOTS,
  catalogIds,
  deltaTone,
  formatScalar,
  isStale,
  relativeAge,
  resolvePanel,
  safeHref,
  stepIndex,
} from "../src/home/widgets/panelLogic.ts";
import { widgetState } from "../src/home/widget-state.ts";

const NOW = Date.parse("2026-11-01T20:00:00Z");
const ago = (min) => new Date(NOW - min * 60_000).toISOString();

const panels = [
  { id: "daily-cost", key: "daily-cost", profile: null, title: "Daily cost", kind: "stat", value: 1.2, updated_at: ago(5) },
  { id: "bgroute", key: "ops/bgroute", profile: "ops", title: "bgroute", kind: "list", items: [], updated_at: ago(90), stale_after_minutes: 60 },
  { id: "daily-cost", key: "coder/daily-cost", profile: "coder", title: "Daily cost", kind: "stat", value: 3, updated_at: ago(1) },
];

test("relativeAge reads like a status line", () => {
  assert.equal(relativeAge(ago(0.2), NOW), "just now");
  assert.equal(relativeAge(ago(4), NOW), "4m ago");
  assert.equal(relativeAge(ago(180), NOW), "3h ago");
  assert.equal(relativeAge(ago(60 * 24 * 3), NOW), "3d ago");
  assert.equal(relativeAge(new Date(NOW + 600_000).toISOString(), NOW), "just now");
  assert.equal(relativeAge("not a date", NOW), "unknown");
});

test("isStale only when the publisher set stale_after_minutes and it passed", () => {
  assert.equal(isStale(panels[0], NOW), false);
  assert.equal(isStale(panels[1], NOW), true);
  assert.equal(isStale({ updated_at: ago(30), stale_after_minutes: 60 }, NOW), false);
  assert.equal(isStale({ updated_at: "garbage", stale_after_minutes: 60 }, NOW), true);
});

test("resolvePanel: exact key, then a bare id prefers the root panel", () => {
  assert.equal(resolvePanel(panels, "coder/daily-cost").profile, "coder");
  assert.equal(resolvePanel(panels, "daily-cost").profile, null);
  assert.equal(resolvePanel(panels, "bgroute").key, "ops/bgroute");
  assert.equal(resolvePanel(panels, "gone"), null);
  assert.equal(resolvePanel(panels, ALL_PANELS), null);
});

test("stepIndex wraps both ways and survives an empty list", () => {
  assert.equal(stepIndex(0, 3, -1), 2);
  assert.equal(stepIndex(2, 3, 1), 0);
  assert.equal(stepIndex(5, 0, 1), 0);
});

test("delta tone, scalar format and link safety", () => {
  assert.equal(deltaTone("+4%"), "up");
  assert.equal(deltaTone("-$2"), "down");
  assert.equal(deltaTone(-0.5), "down");
  assert.equal(deltaTone("flat"), "flat");
  assert.equal(formatScalar("ok"), "ok");
  assert.equal(formatScalar(undefined), "");
  assert.equal(formatScalar(18.42), (18.42).toLocaleString());
  assert.equal(formatScalar(1234.5), (1234.5).toLocaleString());
  assert.equal(safeHref("https://example.com/x"), "https://example.com/x");
  assert.equal(safeHref("javascript:alert(1)"), undefined);
  assert.equal(safeHref("/local"), undefined);
});

test("catalog offers one free panel slot at a time", () => {
  const ids = ["clock", ...PANEL_SLOTS];
  assert.deepEqual(catalogIds(ids, new Set()), ["clock", "panels"]);
  assert.deepEqual(catalogIds(ids, new Set(["clock", "panels"])), ["panels-2"]);
  assert.deepEqual(catalogIds(ids, new Set(PANEL_SLOTS)), ["clock"]);
});

test("panels data source follows the shared widget-state rules", () => {
  const base = { status: { version: "x" }, errors: new Set() };
  assert.equal(widgetState("panels", { ...base }), "loading");
  assert.equal(widgetState("panels", { ...base, panels: { panels: [] } }), "ok");
  assert.equal(widgetState("panels", { ...base, errors: new Set(["panels"]) }), "unavailable");
});
