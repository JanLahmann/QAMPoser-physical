"""``qamposer-hardware`` CLI — generate 3D-printable multi-colour gate tiles.

    qamposer-hardware generate [--variant tile|cube|all] [--gates H,X,...|all]
                               [--magnets] [--out DIR]

Writes, per variant, ``out/hardware/<variant>/`` containing per-colour STL
parts and a coloured 3MF for every requested tile, plus a ``plates.md`` MMU
guide.
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

from qamposer_assets.config import AssetsConfig, load_config
from qamposer_vision.markers import MARKER_TABLE, GateSpec

from .build import build_tile
from .export import export_tile_3mf, export_tile_stls, tile_slug, write_plates_md
from .params import HardwareParams, variant_height, variant_names

__all__ = ["main"]

_DEFAULT_OUT = Path("out/hardware")


def _all_gate_ids() -> list[int]:
    return sorted(mid for mid, spec in MARKER_TABLE.items() if spec.kind == "gate")


def _gate_family(spec: GateSpec) -> str:
    """The ``--gates`` token that selects this tile (e.g. ``H``, ``RX``, ``CNOT``)."""
    return spec.gate


def _resolve_gates(arg: str) -> list[int]:
    """Map a ``--gates`` value to marker IDs.

    ``all`` → every gate tile. Otherwise a comma list of gate families
    (``H,X,RX,CNOT,S``) and/or explicit marker IDs (``10,21``).
    """
    if arg.strip().lower() == "all":
        return _all_gate_ids()
    wanted_families: set[str] = set()
    wanted_ids: set[int] = set()
    for tok in arg.split(","):
        tok = tok.strip()
        if not tok:
            continue
        if tok.isdigit():
            wanted_ids.add(int(tok))
        else:
            wanted_families.add(tok.upper())
    ids: list[int] = []
    for mid in _all_gate_ids():
        spec = MARKER_TABLE[mid]
        if mid in wanted_ids or _gate_family(spec).upper() in wanted_families:
            ids.append(mid)
    unknown_ids = wanted_ids - set(_all_gate_ids())
    if unknown_ids:
        raise SystemExit(f"unknown marker id(s): {sorted(unknown_ids)}")
    if not ids:
        raise SystemExit(f"no gate tiles matched --gates {arg!r}")
    return ids


def _resolve_variants(arg: str) -> list[str]:
    if arg == "all":
        return variant_names()
    if arg not in variant_names():
        raise SystemExit(
            f"unknown --variant {arg!r}; choose tile|cube|all"
        )
    return [arg]


def _generate(
    config: AssetsConfig,
    variants: list[str],
    ids: list[int],
    out_root: Path,
    *,
    magnets: bool,
) -> int:
    params = HardwareParams()
    total_files = 0
    total_bytes = 0
    grand_t0 = time.time()

    for variant in variants:
        height = variant_height(variant)
        vdir = out_root / variant
        vdir.mkdir(parents=True, exist_ok=True)
        print(f"[{variant}] height={height:g} mm -> {vdir}")
        for mid in ids:
            spec = MARKER_TABLE[mid]
            t0 = time.time()
            parts = build_tile(
                mid, config, variant=variant, height=height,
                params=params, magnets=magnets,
            )
            stls = export_tile_stls(parts, vdir)
            tmf = export_tile_3mf(parts, vdir)
            dt = time.time() - t0
            files = list(stls) + ([tmf] if tmf else [])
            nbytes = sum(p.stat().st_size for p in files)
            total_files += len(files)
            total_bytes += nbytes
            print(
                f"    {tile_slug(spec):16s} id={mid:<3d} "
                f"{len(files)} files {nbytes/1024:7.1f} KiB  {dt:4.2f}s"
            )
        write_plates_md(config, vdir)
        total_files += 1

    dt = time.time() - grand_t0
    print(
        f"\nDone: {total_files} files, {total_bytes/1024/1024:.2f} MiB, "
        f"{dt:.1f}s total."
    )
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="qamposer-hardware",
        description="Generate 3D-printable multi-colour Entangible gate tiles.",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    gen = sub.add_parser("generate", help="generate STL/3MF tiles")
    gen.add_argument(
        "--variant", default="tile",
        help="tile (6 mm) | cube (60 mm) | all (default: tile)",
    )
    gen.add_argument(
        "--gates", default="all",
        help="comma list of gate families/IDs, or 'all' (default: all)",
    )
    gen.add_argument(
        "--magnets", action="store_true",
        help="add two magnet pockets to the underside (default: off)",
    )
    gen.add_argument(
        "--out", default=str(_DEFAULT_OUT), type=Path,
        help=f"output root (default: {_DEFAULT_OUT})",
    )

    args = parser.parse_args(argv)
    if args.command == "generate":
        config = load_config()
        variants = _resolve_variants(args.variant)
        ids = _resolve_gates(args.gates)
        return _generate(
            config, variants, ids, args.out, magnets=args.magnets
        )
    parser.error("unknown command")
    return 2


if __name__ == "__main__":
    sys.exit(main())
