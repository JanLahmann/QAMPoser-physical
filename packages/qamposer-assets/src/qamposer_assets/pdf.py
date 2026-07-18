"""SVG → PDF rendering backend with graceful degradation.

Primary path is :mod:`cairosvg` (system ``libcairo``). On macOS/Homebrew the
dynamic loader often can't find ``libcairo`` without help, so we prepend common
library directories to the loader search path *before* importing cairosvg —
this makes ``uv run`` work out of the box on a stock Homebrew machine.

If cairosvg (or its native library) is unavailable, we fall back to
``svglib`` + ``reportlab`` (the ``[fallback]`` extra). If neither is present the
caller is told to install one, and SVGs can still be emitted on their own.
"""

from __future__ import annotations

import os
import sys
from functools import lru_cache
from pathlib import Path

__all__ = [
    "BackendUnavailable",
    "available_backend",
    "svg_to_pdf",
]

# Directories where libcairo commonly lives, per platform. Prepended to the
# dynamic loader path so cairocffi's find_library() can locate it.
_LIB_DIRS = [
    "/opt/homebrew/lib",  # Homebrew (Apple Silicon)
    "/opt/homebrew/opt/cairo/lib",
    "/usr/local/lib",  # Homebrew (Intel) / manual installs
    "/usr/local/opt/cairo/lib",
    "/usr/lib",
    "/usr/lib/x86_64-linux-gnu",  # Debian/Ubuntu
    "/opt/local/lib",  # MacPorts
]


class BackendUnavailable(RuntimeError):
    """No SVG→PDF backend could be used."""


def _prime_library_path() -> None:
    """Prepend known cairo library dirs to the platform loader search var."""
    var = "DYLD_FALLBACK_LIBRARY_PATH" if sys.platform == "darwin" else "LD_LIBRARY_PATH"
    existing = os.environ.get(var, "")
    have = existing.split(os.pathsep) if existing else []
    additions = [d for d in _LIB_DIRS if Path(d).is_dir() and d not in have]
    if additions:
        os.environ[var] = os.pathsep.join(additions + have)


@lru_cache(maxsize=1)
def available_backend() -> str | None:
    """Return ``'cairosvg'``, ``'svglib'`` or ``None`` (first that imports)."""
    _prime_library_path()
    try:
        import cairosvg  # noqa: F401

        return "cairosvg"
    except Exception:  # pragma: no cover - depends on host libs
        pass
    try:
        import reportlab  # noqa: F401
        import svglib  # noqa: F401

        return "svglib"
    except Exception:  # pragma: no cover
        pass
    return None


def svg_to_pdf(svg: str, out_path: str | Path) -> None:
    """Render ``svg`` (a full SVG document string) to a PDF at ``out_path``."""
    backend = available_backend()
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    if backend == "cairosvg":
        import cairosvg

        cairosvg.svg2pdf(bytestring=svg.encode("utf-8"), write_to=str(out))
        return

    if backend == "svglib":  # pragma: no cover - exercised only on fallback hosts
        import io

        from reportlab.graphics import renderPDF
        from svglib.svglib import svg2rlg

        drawing = svg2rlg(io.StringIO(svg))
        if drawing is None:
            raise BackendUnavailable("svglib failed to parse the SVG")
        renderPDF.drawToFile(drawing, str(out))
        return

    raise BackendUnavailable(
        "No SVG->PDF backend available. Install system libcairo (e.g. "
        "`brew install cairo` / `apt install libcairo2`) so cairosvg works, "
        "or install the fallback extra: `uv pip install 'qamposer-assets[fallback]'`."
    )
