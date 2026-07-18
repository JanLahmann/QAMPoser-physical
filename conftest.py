"""Pytest bootstrap: make the repo root importable.

Ensures ``import tests.utils.render_board`` resolves from both the repo-root
suite and the ``packages/qamposer-vision`` suite when running::

    uv run pytest packages/qamposer-vision/ tests/ -q
"""

from __future__ import annotations

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))
