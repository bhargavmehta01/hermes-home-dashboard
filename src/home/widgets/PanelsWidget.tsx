import { useEffect, useState, type ReactNode } from "react";
import type { PanelDoc, PanelsResponse } from "../../api-types";
import { HoverCtl } from "./HoverArrows";
import {
  ALL_PANELS, deltaTone, formatScalar, isStale, panelOptionLabel,
  relativeAge, resolvePanel, safeHref, stepIndex,
} from "./panelLogic";

const ROTATE_MS = 15_000;
const TICK_MS = 30_000;

interface Props {
  panels: PanelsResponse | null;
  widgetProps: Record<string, unknown>;
  onWidgetPropsChange: (next: Record<string, unknown>) => void;
}

function swallow(e: { stopPropagation: () => void }) {
  e.stopPropagation();
}

function ExtLink({ href, className, children }: {
  href: string | undefined; className?: string; children: ReactNode;
}) {
  const safe = safeHref(href);
  if (!safe) return <span className={className}>{children}</span>;
  return (
    <a
      className={`panel-link${className ? ` ${className}` : ""}`}
      href={safe}
      target="_blank"
      rel="noopener noreferrer"
      onClick={swallow}
      onPointerDown={swallow}
    >
      {children}
    </a>
  );
}

function PanelBody({ p }: { p: PanelDoc }) {
  switch (p.kind) {
    case "stat": {
      const tone = deltaTone(p.delta);
      return (
        <div className="panel-stat">
          <div className="panel-stat-line">
            <span className="bigval panel-value">{formatScalar(p.value)}</span>
            {p.unit && <span className="panel-unit dim">{p.unit}</span>}
            {p.delta !== undefined && (
              <span className={`panel-delta panel-delta-${tone}`}>{formatScalar(p.delta)}</span>
            )}
          </div>
          {p.subtitle && <div className="panel-sub dim">{p.subtitle}</div>}
        </div>
      );
    }
    case "list":
      return (
        <div className="panel-scroll">
          {p.subtitle && <div className="panel-sub dim">{p.subtitle}</div>}
          {(p.items ?? []).length === 0 && <span className="dim">nothing to show</span>}
          {(p.items ?? []).map((it, i) => (
            <div className="row" key={`${i}-${it.label}`}>
              <ExtLink href={it.url} className="row-name">
                <span title={it.label}>{it.label}</span>
              </ExtLink>
              {it.value !== undefined && <span className="ok">{formatScalar(it.value)}</span>}
            </div>
          ))}
        </div>
      );
    case "table":
      return (
        <div className="panel-scroll">
          {p.subtitle && <div className="panel-sub dim">{p.subtitle}</div>}
          <table className="panel-table">
            <thead>
              <tr>{(p.columns ?? []).map((c, i) => <th key={i}>{c}</th>)}</tr>
            </thead>
            <tbody>
              {(p.rows ?? []).map((r, i) => (
                <tr key={i}>
                  {r.map((c, j) => (
                    <td key={j} className={typeof c === "number" ? "num" : undefined}>
                      {formatScalar(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "text":
    default:
      return (
        <div className="panel-scroll">
          {p.subtitle && <div className="panel-sub dim">{p.subtitle}</div>}
          <div className="panel-text">{p.text}</div>
        </div>
      );
  }
}

/** Agent-published panels: small JSON files that agents and cron jobs write
 *  to $HERMES_HOME/panels/<id>.json. One widget shows one chosen panel, or
 *  rotates through all of them. The hover control picks which (persisted in
 *  widgetProps.panel) and, in rotate mode, steps ‹ ›. A panel whose
 *  stale_after_minutes has passed dims and says so. */
export function PanelsWidget({ panels, widgetProps, onWidgetPropsChange }: Props) {
  const chosen = typeof widgetProps.panel === "string" && widgetProps.panel ? widgetProps.panel : ALL_PANELS;
  const [index, setIndex] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const list = panels?.panels ?? [];
  const rotating = chosen === ALL_PANELS;
  const n = list.length;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(t);
  }, []);

  // Auto-advance in rotate mode; stepping by hand restarts the timer.
  useEffect(() => {
    if (!rotating || n < 2) return;
    const t = setInterval(() => setIndex((i) => stepIndex(i, n, 1)), ROTATE_MS);
    return () => clearInterval(t);
  }, [rotating, n, index]);

  if (!panels) return <span className="dim">loading…</span>;

  const panel = rotating ? (n > 0 ? list[Math.min(index, n - 1)] : null) : resolvePanel(list, chosen);

  const control = (
    <HoverCtl className="panel-ctl">
      {rotating && n > 1 && (
        <>
          <button className="hv-arrow" aria-label="previous panel"
            onClick={(e) => { swallow(e); setIndex((i) => stepIndex(i, n, -1)); }}>‹</button>
          <span className="hv-label">{Math.min(index, n - 1) + 1}/{n}</span>
          <button className="hv-arrow" aria-label="next panel"
            onClick={(e) => { swallow(e); setIndex((i) => stepIndex(i, n, 1)); }}>›</button>
        </>
      )}
      <select
        className="panel-pick"
        aria-label="Choose panel"
        value={rotating ? ALL_PANELS : chosen}
        onClick={swallow}
        onPointerDown={swallow}
        onChange={(e) => {
          setIndex(0);
          onWidgetPropsChange({ ...widgetProps, panel: e.target.value });
        }}
      >
        <option value={ALL_PANELS}>all · rotate</option>
        {list.map((p) => (
          <option key={p.key} value={p.key}>{panelOptionLabel(p)}</option>
        ))}
        {!rotating && !resolvePanel(list, chosen) && (
          <option value={chosen}>{chosen} (missing)</option>
        )}
      </select>
    </HoverCtl>
  );

  if (!panel) {
    return (
      <div className="home-panel">
        {control}
        <span className="dim">
          {n === 0
            ? "no panels yet — agents write ~/.hermes/panels/<id>.json"
            : `panel "${chosen}" is gone — pick another`}
        </span>
      </div>
    );
  }

  const stale = isStale(panel, now);
  return (
    <div className={`home-panel${stale ? " panel-stale" : ""}`}>
      {control}
      <div className="panel-head">
        <ExtLink href={panel.link} className="panel-title">{panel.title}</ExtLink>
        {panel.profile && <span className="panel-profile dim">{panel.profile}</span>}
      </div>
      <PanelBody p={panel} />
      <div className="panel-foot dim" title={panel.updated_at}>
        {stale && <span className="panel-stale-tag">stale · </span>}
        updated {relativeAge(panel.updated_at, now)}
        {panel.source && <> · {panel.source}</>}
      </div>
    </div>
  );
}
