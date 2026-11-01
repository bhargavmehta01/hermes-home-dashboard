"""Home dashboard plugin backend.

Mounted at /api/plugins/home-dashboard/ by the Hermes dashboard host.
Persists the widget layout to a JSON file inside the plugin's own directory
so it survives Hermes updates (the plugin lives under ~/.hermes/plugins/,
outside the repo that `git reset --hard` touches).
"""
from __future__ import annotations

import asyncio
import json
import math
import os
import re
import stat
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

try:
    from hermes_constants import get_hermes_home
except ImportError:  # pragma: no cover - allows standalone unit tests
    import os as _os

    def get_hermes_home() -> Path:  # type: ignore[misc]
        val = (_os.environ.get("HERMES_HOME") or "").strip()
        return Path(val) if val else Path.home() / ".hermes"

try:
    from fastapi import APIRouter, HTTPException
    from pydantic import BaseModel
except Exception:  # pragma: no cover - allows local unit tests
    class APIRouter:  # type: ignore
        def get(self, *_a, **_k):
            return lambda fn: fn

        def put(self, *_a, **_k):
            return lambda fn: fn

    class BaseModel:  # type: ignore
        pass

    class HTTPException(Exception):  # type: ignore
        def __init__(self, status_code: int, detail: str = "") -> None:
            self.status_code = status_code
            self.detail = detail


router = APIRouter()

LAYOUT_FILE = get_hermes_home() / "plugins" / "home-dashboard" / "layout.json"
_MAX_WIDGETS = 64


def _valid_layout(layout: Any) -> bool:
    if not isinstance(layout, dict) or layout.get("version") != 1:
        return False
    widgets = layout.get("widgets")
    if not isinstance(widgets, list) or len(widgets) > _MAX_WIDGETS:
        return False
    for w in widgets:
        if not isinstance(w, dict) or not isinstance(w.get("id"), str):
            return False
        if not all(isinstance(w.get(k), int) for k in ("gx", "gy", "gw", "gh")):
            return False
    return True


@router.get("/layout")
async def get_layout() -> Dict[str, Any]:
    """Return the saved layout, or {"layout": null} for the client default."""
    if LAYOUT_FILE.exists():
        try:
            data = json.loads(LAYOUT_FILE.read_text("utf-8"))
            if _valid_layout(data):
                return {"layout": data}
        except Exception:
            pass
    return {"layout": None}


class LayoutBody(BaseModel):
    layout: dict


@router.put("/layout")
async def set_layout(body: "LayoutBody") -> Dict[str, Any]:
    """Persist the widget layout (positions/sizes/per-widget props)."""
    if not _valid_layout(body.layout):
        raise HTTPException(status_code=400, detail="invalid layout document")
    LAYOUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    LAYOUT_FILE.write_text(json.dumps(body.layout), encoding="utf-8")
    return {"ok": True}


# Hermes Desktop deliberately exposes plugin-scoped REST instead of a generic
# core-API escape hatch.  These read-only routes adapt the same current Hermes
# services the web dashboard uses, keeping the Desktop bundle inside its public
# ``ctx.rest`` boundary while preserving the richer Home widgets.
@router.get("/system")
async def get_desktop_system() -> Dict[str, Any]:
    from hermes_cli.web_routers.status import get_system_stats

    return await get_system_stats()


@router.get("/analytics")
async def get_desktop_analytics(days: int = 30, profile: str | None = None) -> Dict[str, Any]:
    from hermes_cli.web_routers.analytics import get_usage_analytics

    return await get_usage_analytics(days=max(1, min(365, days)), profile=profile)


@router.get("/cron")
async def get_desktop_cron(profile: str = "all") -> list[Dict[str, Any]]:
    from hermes_cli.web_routers.cron import list_cron_jobs

    return await list_cron_jobs(profile=profile or "all")


@router.get("/sessions")
async def get_desktop_sessions(
    limit: int = 20,
    offset: int = 0,
    profile: str | None = None,
) -> Dict[str, Any]:
    from hermes_cli.web_routers.sessions import get_sessions

    return await asyncio.to_thread(
        get_sessions,
        limit=max(1, min(100, limit)),
        offset=max(0, offset),
        order="recent",
        profile=profile,
    )



# ── Panels ────────────────────────────────────────────────────────────────
# Agents and cron jobs publish small JSON "panels" by atomically writing
# $HERMES_HOME/panels/<id>.json (profiles: <root>/profiles/<name>/panels/).
# This route only READS those files: fixed directories, *.json only, regular
# files only (no symlinks), size-capped, strictly validated and normalized.
# Nothing in a panel file is ever executed, imported, or used as a path.

PANELS_SCHEMA_VERSION = 1
PANEL_MAX_BYTES = 64 * 1024
PANEL_MAX_FILES = 200          # per directory scanned
PANEL_MAX_RETURNED = 100
_PANEL_KINDS = ("stat", "list", "table", "text")
_PANEL_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
_PROFILE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
_MAX_ITEMS = 50
_MAX_COLUMNS = 8
_MAX_ROWS = 50
_MAX_STALE_MINUTES = 60 * 24 * 366


def _hermes_root() -> Path:
    """Root Hermes home (profiles live under <root>/profiles/<name>)."""
    try:
        from hermes_constants import get_default_hermes_root  # type: ignore

        return Path(get_default_hermes_root())
    except Exception:
        return get_hermes_home()


def _panel_dirs() -> List[Tuple[Optional[str], Path]]:
    root = _hermes_root()
    dirs: List[Tuple[Optional[str], Path]] = [(None, root / "panels")]
    profiles = root / "profiles"
    try:
        if profiles.is_dir() and not profiles.is_symlink():
            for p in sorted(profiles.iterdir())[:64]:
                if _PROFILE_RE.match(p.name) and p.is_dir() and not p.is_symlink():
                    dirs.append((p.name, p / "panels"))
    except OSError:
        pass
    return dirs


def _clip(v: Any, n: int) -> Optional[str]:
    if v is None:
        return None
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        if isinstance(v, float) and not math.isfinite(v):
            return None
        v = str(v)
    if not isinstance(v, str):
        return None
    v = v.strip()
    return v[:n] if v else None


def _scalar(v: Any, n: int = 200) -> Any:
    """A display value: finite number or short string; else None."""
    if isinstance(v, bool) or v is None:
        return None
    if isinstance(v, int):
        return v
    if isinstance(v, float):
        return v if math.isfinite(v) else None
    return _clip(v, n)


def _safe_url(v: Any) -> Optional[str]:
    u = _clip(v, 2048)
    if not u or not re.match(r"^https?://[^\s/$.?#][^\s]*$", u, re.I):
        return None
    return u


def _parse_iso(v: Any) -> Optional[str]:
    s = _clip(v, 64)
    if not s:
        return None
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    # A naive time is the writer's local time; the browser reads it the same way.
    return dt.isoformat()


def validate_panel(raw: Any, file_id: str) -> Optional[Dict[str, Any]]:
    """Normalize one panel document, or None if it is not a valid v1 panel."""
    if not isinstance(raw, dict):
        return None
    pid = raw.get("id", file_id)
    if not isinstance(pid, str) or pid != file_id or not _PANEL_ID_RE.match(pid):
        return None
    kind = raw.get("kind")
    if kind not in _PANEL_KINDS:
        return None
    title = _clip(raw.get("title"), 80)
    updated_at = _parse_iso(raw.get("updated_at"))
    if not title or not updated_at:
        return None
    out: Dict[str, Any] = {"id": pid, "title": title, "kind": kind, "updated_at": updated_at}
    for key, n in (("unit", 16), ("subtitle", 200), ("source", 80)):
        v = _clip(raw.get(key), n)
        if v:
            out[key] = v
    delta = _scalar(raw.get("delta"), 24)
    if delta is not None:
        out["delta"] = delta
    link = _safe_url(raw.get("link"))
    if link:
        out["link"] = link
    stale = raw.get("stale_after_minutes")
    if isinstance(stale, (int, float)) and not isinstance(stale, bool) and math.isfinite(stale) and stale > 0:
        out["stale_after_minutes"] = int(min(stale, _MAX_STALE_MINUTES))

    if kind == "stat":
        value = _scalar(raw.get("value"), 40)
        if value is None:
            return None
        out["value"] = value
    elif kind == "list":
        items_raw = raw.get("items")
        if not isinstance(items_raw, list):
            return None
        items = []
        for it in items_raw[:_MAX_ITEMS]:
            if not isinstance(it, dict):
                continue
            label = _clip(it.get("label"), 120)
            if not label:
                continue
            item: Dict[str, Any] = {"label": label}
            v = _scalar(it.get("value"), 60)
            if v is not None:
                item["value"] = v
            u = _safe_url(it.get("url"))
            if u:
                item["url"] = u
            items.append(item)
        out["items"] = items
    elif kind == "table":
        cols_raw, rows_raw = raw.get("columns"), raw.get("rows")
        if not isinstance(cols_raw, list) or not isinstance(rows_raw, list):
            return None
        cols = [_clip(c, 40) or "" for c in cols_raw[:_MAX_COLUMNS]]
        if not cols:
            return None
        rows = []
        for r in rows_raw[:_MAX_ROWS]:
            if not isinstance(r, list):
                continue
            cells = [_scalar(c, 80) for c in r[: len(cols)]]
            cells += [None] * (len(cols) - len(cells))
            rows.append(cells)
        out["columns"], out["rows"] = cols, rows
    else:  # text
        text = _clip(raw.get("text"), 4000) or _clip(raw.get("value"), 4000)
        if not text:
            return None
        out["text"] = text
    return out


def _read_panel_file(path: Path, base: Path) -> Optional[Dict[str, Any]]:
    try:
        st = path.lstat()
        if not stat.S_ISREG(st.st_mode) or st.st_size > PANEL_MAX_BYTES:
            return None
        if path.resolve().parent != base.resolve():
            return None
        flags = os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0)
        fd = os.open(path, flags)
        with os.fdopen(fd, "rb") as fh:
            blob = fh.read(PANEL_MAX_BYTES + 1)
        if len(blob) > PANEL_MAX_BYTES:
            return None
        raw = json.loads(blob.decode("utf-8"))
    except (OSError, ValueError, UnicodeDecodeError, RecursionError):
        return None
    return validate_panel(raw, path.stem)


def list_panels() -> Dict[str, Any]:
    panels: List[Dict[str, Any]] = []
    skipped = 0
    for profile, d in _panel_dirs():
        try:
            if not d.is_dir() or d.is_symlink():
                continue
            names = sorted(n for n in os.listdir(d) if n.endswith(".json") and not n.startswith("."))
        except OSError:
            continue
        for name in names[:PANEL_MAX_FILES]:
            if not _PANEL_ID_RE.match(name[:-5]):
                skipped += 1
                continue
            p = _read_panel_file(d / name, d)
            if p is None:
                skipped += 1
                continue
            p["profile"] = profile
            p["key"] = f"{profile}/{p['id']}" if profile else p["id"]
            panels.append(p)
    panels.sort(key=lambda p: (p["profile"] or "", p["title"].lower(), p["id"]))
    return {"version": PANELS_SCHEMA_VERSION, "panels": panels[:PANEL_MAX_RETURNED], "skipped": skipped}


@router.get("/panels")
async def get_panels() -> Dict[str, Any]:
    """Read-only list of agent-published panels (see README → Panels)."""
    return await asyncio.to_thread(list_panels)
