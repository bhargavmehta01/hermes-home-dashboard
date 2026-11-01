// Pure helpers for the Panels widget. Kept free of runtime imports so they
// can be unit-tested with `node --experimental-strip-types --test`.
import type { PanelDoc, PanelScalar } from "../../api-types";

/** Layout ids are unique per widget, so Panels gets a few slots: each slot
 *  is an independent widget that shows its own chosen panel (or rotates). */
export const PANEL_SLOTS = ["panels", "panels-2", "panels-3", "panels-4"] as const;

/** Catalog chips: every unplaced widget, but only the FIRST free panel slot
 *  (so the strip shows one "+ panels", not four). */
export function catalogIds(ids: readonly string[], placed: ReadonlySet<string>): string[] {
  const slots: readonly string[] = PANEL_SLOTS;
  const freeSlot = slots.find((s) => ids.includes(s) && !placed.has(s));
  return ids.filter((id) => !placed.has(id) && (!slots.includes(id) || id === freeSlot));
}

/** widgetProps.panel value meaning "rotate through every panel". */
export const ALL_PANELS = "*";

export function panelTimeMs(iso: string): number {
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? NaN : ms;
}

/** "just now", "4m ago", "3h ago", "2d ago" (future clocks read "just now"). */
export function relativeAge(iso: string, nowMs: number): string {
  const t = panelTimeMs(iso);
  if (Number.isNaN(t)) return "unknown";
  const s = Math.max(0, Math.round((nowMs - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(s / 3600);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(s / 86_400)}d ago`;
}

/** Stale only when the publisher set stale_after_minutes and it has passed. */
export function isStale(panel: Pick<PanelDoc, "updated_at" | "stale_after_minutes">, nowMs: number): boolean {
  const limit = panel.stale_after_minutes;
  if (!limit || limit <= 0) return false;
  const t = panelTimeMs(panel.updated_at);
  if (Number.isNaN(t)) return true;
  return nowMs - t > limit * 60_000;
}

/** The chosen panel for a saved key. Accepts "<profile>/<id>" or a bare id
 *  (a bare id prefers the root panel, then the first profile that has it). */
export function resolvePanel(panels: readonly PanelDoc[], key: string): PanelDoc | null {
  if (!key || key === ALL_PANELS) return null;
  return (
    panels.find((p) => p.key === key) ??
    panels.find((p) => p.id === key && p.profile === null) ??
    panels.find((p) => p.id === key) ??
    null
  );
}

export function stepIndex(i: number, n: number, step: number): number {
  if (n <= 0) return 0;
  return (((i + step) % n) + n) % n;
}

export function formatScalar(v: PanelScalar | null | undefined): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return v;
}

/** Colour hint for a delta: a leading +/- (or the number's sign). */
export function deltaTone(delta: PanelScalar | undefined): "up" | "down" | "flat" {
  if (delta === undefined) return "flat";
  if (typeof delta === "number") return delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const s = delta.trim();
  if (s.startsWith("+") || s.startsWith("▲")) return "up";
  if (s.startsWith("-") || s.startsWith("−") || s.startsWith("▼")) return "down";
  return "flat";
}

/** Only absolute http(s) links ever become anchors (backend checks too). */
export function safeHref(url: string | undefined): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

export function panelOptionLabel(p: PanelDoc): string {
  return p.profile ? `${p.title} · ${p.profile}` : p.title;
}
