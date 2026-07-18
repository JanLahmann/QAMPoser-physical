"""Event branding (white-label slot) + its REST endpoints.

The topbar's "presented at" zone and attract-mode co-brand are configured via
``branding.toml`` (event name, logo file, QR target override), served at
``/api/branding`` with the logo file itself at ``/api/branding/logo``. When no
``branding.toml`` exists the defaults below apply (plain Entangible, no logo).

``branding.toml`` schema (all keys optional)::

    name = "Quantum Fair 2026"
    logo = "logo.svg"                 # relative to the toml's dir, or absolute
    qr_target = "https://example.org" # overrides the default "scan to learn" URL
"""

from __future__ import annotations

import logging
import tomllib
from dataclasses import dataclass
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

logger = logging.getLogger("qamposer_host.branding")

router = APIRouter()

DEFAULT_NAME = "Entangible"


@dataclass
class Branding:
    """Resolved event branding. ``logo_path`` is absolute when set and present."""

    name: str = DEFAULT_NAME
    logo_path: Path | None = None
    qr_target: str | None = None

    def logo_available(self) -> bool:
        return self.logo_path is not None and self.logo_path.is_file()

    def api_dict(self) -> dict:
        """The ``/api/branding`` body: ``{name, logoUrl|null, qrTarget}``."""
        return {
            "name": self.name,
            "logoUrl": "/api/branding/logo" if self.logo_available() else None,
            "qrTarget": self.qr_target,
        }


def load_branding(path: Path | str | None) -> Branding:
    """Load branding from ``branding.toml``; defaults when the file is absent.

    A relative ``logo`` is resolved against the toml file's directory so a
    config dir is self-contained (logo alongside the toml).
    """
    branding = Branding()
    if path is None:
        return branding
    path = Path(path)
    if not path.is_file():
        return branding
    try:
        with path.open("rb") as fh:
            data = tomllib.load(fh)
    except (OSError, tomllib.TOMLDecodeError):
        logger.warning("could not read branding file %s; using defaults",
                       path, exc_info=True)
        return branding

    name = data.get("name")
    if isinstance(name, str) and name.strip():
        branding.name = name
    qr_target = data.get("qr_target")
    if isinstance(qr_target, str) and qr_target.strip():
        branding.qr_target = qr_target
    logo = data.get("logo")
    if isinstance(logo, str) and logo.strip():
        logo_path = Path(logo)
        if not logo_path.is_absolute():
            logo_path = (path.parent / logo_path).resolve()
        branding.logo_path = logo_path
    return branding


@router.get("/api/branding")
async def get_branding(request: Request) -> dict:
    branding: Branding = request.app.state.branding
    return branding.api_dict()


@router.get("/api/branding/logo")
async def get_branding_logo(request: Request) -> FileResponse:
    branding: Branding = request.app.state.branding
    if not branding.logo_available():
        raise HTTPException(status_code=404)
    # FileResponse guesses the content-type from the extension (svg/png/…).
    return FileResponse(branding.logo_path)
