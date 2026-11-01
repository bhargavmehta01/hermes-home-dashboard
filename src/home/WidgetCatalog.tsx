import { WIDGET_REGISTRY } from "./widgets/registry";
import type { HomeLayout } from "./layout-schema";
import { catalogIds } from "./widgets/panelLogic";

interface Props {
  layout: HomeLayout;
  /** Begin dragging a widget out of the catalog onto the grid. A plain
   *  tap also adds it (handled by the grid's drag end). */
  onChipPointerDown: (id: string, e: React.PointerEvent) => void;
}

/** Edit-mode strip listing widgets not currently on the grid. Also the drop
 *  zone for deleting widgets dragged off the grid. The outer collapse/fade
 *  animation is driven by `.home-catalog-wrap` in HomePage. */
export function WidgetCatalog({ layout, onChipPointerDown }: Props) {
  const placed = new Set(layout.widgets.map((w) => w.id));
  const available = catalogIds(Object.keys(WIDGET_REGISTRY), placed)
    .map((id) => [id, WIDGET_REGISTRY[id]] as const);
  return (
    <div className="home-catalog">
      <div className="home-catalog-inner">
        <span className="home-catalog-hint">drag a widget here to remove it</span>
        {available.map(([id, def]) => (
          <button
            key={id}
            className="home-catalog-chip"
            onPointerDown={(e) => onChipPointerDown(id, e)}
          >
            + {def.title}
          </button>
        ))}
      </div>
    </div>
  );
}
