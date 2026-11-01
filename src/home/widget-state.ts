// Kept free of imports so it can be unit-tested without the SDK/React graph.
type HomeDataSource = "status" | "system" | "analytics" | "cron" | "sessions" | "logs" | "panels";

/** What a data-backed widget should render:
 *  - ok          fresh data (or the widget has no data source)
 *  - loading     nothing received yet
 *  - stale       the last poll failed but earlier data is still shown
 *  - offline     the backend itself is unreachable (status poll failing too)
 *  - unavailable the backend answers, but this one source fails */
export type WidgetState = "ok" | "loading" | "stale" | "offline" | "unavailable";

type StateInput = { errors: ReadonlySet<string> } & Partial<Record<HomeDataSource, unknown>>;

export function widgetState(source: HomeDataSource | null, data: StateInput): WidgetState {
  if (source === null) return "ok";
  const failing = data.errors.has(source);
  const has = data[source] != null;
  if (!failing) return has ? "ok" : "loading";
  if (has) return "stale";
  return data.errors.has("status") && data.status == null ? "offline" : "unavailable";
}
