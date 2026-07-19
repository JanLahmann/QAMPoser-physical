"""``qamposer-assets`` — generate printable tiles and board mats as PDFs.

Subcommands:

* ``tiles`` — tile cut-sheets (booth kit + one-of-everything) for a paper format.
* ``board`` — the board mat: full single page **and** the tiled multi-page set.
* ``cheatsheet`` — the one-page booth-staff quick reference (A4).
* ``all``   — everything above.

SVG is the source of truth; PDFs are rendered via :mod:`cairosvg` (falling back
to ``svglib``/``reportlab``). If no PDF backend is available the SVGs are still
written and the process exits non-zero with a hint.
"""

from __future__ import annotations

import argparse
import sys
from collections.abc import Iterable
from pathlib import Path

from .board import board_svg, board_tiled_svgs
from .cheatsheet import cheatsheet_svgs
from .config import AssetsConfig, load_config
from .pdf import BackendUnavailable, available_backend, svg_to_pdf
from .sheets import kit_sheet_svgs, sample_sheet_svgs, tile_sheet_svgs
from .paper import PAGE_SIZES

__all__ = ["main", "build_parser"]

_DEFAULT_OUT = Path("out/assets")


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="qamposer-assets",
        description="Generate Entangible printable assets (tiles + board mat).",
    )
    parser.add_argument(
        "--format",
        choices=sorted(PAGE_SIZES),
        default="A4",
        help="paper format for cut-sheets and the tiled board (default: A4).",
    )
    parser.add_argument(
        "--out",
        type=Path,
        default=_DEFAULT_OUT,
        help=f"output directory (default: {_DEFAULT_OUT}).",
    )
    parser.add_argument(
        "--svg",
        action="store_true",
        help="also keep the intermediate SVG next to each PDF.",
    )
    parser.add_argument(
        "--assets-toml",
        type=Path,
        default=None,
        help="explicit path to assets.toml (default: auto-locate).",
    )
    parser.add_argument(
        "command",
        choices=("tiles", "board", "cheatsheet", "all"),
        help="what to generate.",
    )
    return parser


# ---------------------------------------------------------------------------
# Rendering helpers
# ---------------------------------------------------------------------------


class _Writer:
    """Writes SVG pages to PDF (and optionally SVG), tracking what it produced."""

    def __init__(self, out_dir: Path, *, keep_svg: bool, svg_only: bool) -> None:
        self.out_dir = out_dir
        self.keep_svg = keep_svg
        self.svg_only = svg_only
        self.written: list[Path] = []

    def _write_svg(self, svg: str, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(svg, encoding="utf-8")
        self.written.append(path)

    def emit(self, svgs: Iterable[str], subdir: str, stem: str) -> None:
        """Render an ordered list of pages to ``<out>/<subdir>/<stem>-pNN``."""
        pages = list(svgs)
        multi = len(pages) > 1
        for i, svg in enumerate(pages, start=1):
            name = f"{stem}-p{i:02d}" if multi else stem
            base = self.out_dir / subdir / name
            if self.keep_svg or self.svg_only:
                self._write_svg(svg, base.with_suffix(".svg"))
            if not self.svg_only:
                pdf_path = base.with_suffix(".pdf")
                svg_to_pdf(svg, pdf_path)
                self.written.append(pdf_path)


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------


def _do_tiles(cfg: AssetsConfig, writer: _Writer, fmt: str) -> None:
    writer.emit(kit_sheet_svgs(cfg, fmt), "tiles", f"booth-kit_{fmt}")
    writer.emit(sample_sheet_svgs(cfg, fmt), "tiles", f"sample_{fmt}")


def _do_board(cfg: AssetsConfig, writer: _Writer, fmt: str) -> None:
    writer.emit([board_svg(cfg)], "board", "board_full")
    writer.emit(board_tiled_svgs(cfg, fmt), "board", f"board_{fmt}_tiled")


def _do_cheatsheet(cfg: AssetsConfig, writer: _Writer) -> None:
    writer.emit(cheatsheet_svgs(cfg), "cheatsheet", "cheatsheet")


def generate(
    command: str,
    cfg: AssetsConfig,
    out_dir: Path,
    fmt: str,
    *,
    keep_svg: bool,
    svg_only: bool,
) -> list[Path]:
    """Run ``command`` and return the list of written files."""
    writer = _Writer(out_dir, keep_svg=keep_svg, svg_only=svg_only)
    if command in ("tiles", "all"):
        _do_tiles(cfg, writer, fmt)
    if command in ("board", "all"):
        _do_board(cfg, writer, fmt)
    if command in ("cheatsheet", "all"):
        _do_cheatsheet(cfg, writer)
    return writer.written


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    cfg = load_config(args.assets_toml)

    backend = available_backend()
    svg_only = backend is None
    if svg_only:
        print(
            "warning: no SVG->PDF backend found (cairosvg/libcairo or "
            "svglib+reportlab). Writing SVG files only.\n"
            "  Fix: `brew install cairo` / `apt install libcairo2`, or "
            "`uv pip install 'qamposer-assets[fallback]'`.",
            file=sys.stderr,
        )
    else:
        print(f"Using SVG->PDF backend: {backend}", file=sys.stderr)

    try:
        written = generate(
            args.command,
            cfg,
            args.out,
            args.format,
            keep_svg=args.svg,
            svg_only=svg_only,
        )
    except BackendUnavailable as exc:  # pragma: no cover - defensive
        print(f"error: {exc}", file=sys.stderr)
        return 2

    for path in written:
        try:
            size = path.stat().st_size
        except OSError:
            size = 0
        print(f"  {path}  ({size:,} bytes)")
    print(f"Wrote {len(written)} file(s) to {args.out}", file=sys.stderr)

    return 3 if svg_only else 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
