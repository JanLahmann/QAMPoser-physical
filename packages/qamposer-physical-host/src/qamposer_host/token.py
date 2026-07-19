"""Operator-token lifecycle — the booth's single shared staff credential.

Staff-only surfaces (``/debug`` + its MJPEG preview, ``/api/qr``, the
``/ws/frames`` phone-camera intake, and the ``select_camera`` / ``select_mode`` /
``select_layout`` control messages on ``/ws/state``) are gated behind one shared
**operator token**. There are no accounts — possession of the token *is* the
credential, which is right-sized for a booth appliance whose staff carry a
printed cheat sheet with a ``/debug?key=…`` QR.

The token is generated on first run and persisted next to the TLS material in the
cert dir (see :mod:`qamposer_host.certs`), so a booth keeps the same token across
restarts. :func:`ensure_token` is idempotent (generate-once, reuse-thereafter);
:func:`rotate_token` mints a fresh one (invalidating every printed sheet). The
file is written ``0o600`` — same restrictive posture as the private key.

The token itself is a URL-safe string (``secrets.token_urlsafe``) so it drops
straight into a ``?key=`` query parameter and a QR payload with no escaping.
"""

from __future__ import annotations

import hmac
import logging
import os
import secrets
from pathlib import Path

logger = logging.getLogger("qamposer_host.token")

#: File name (next to ``cert.pem`` / ``key.pem``) holding the operator token.
TOKEN_NAME = "operator-token"

#: Entropy for a freshly generated token, in bytes (``token_urlsafe`` yields a
#: ~22-char string for 16 bytes — plenty for a shared booth secret, short enough
#: to survive a QR round-trip comfortably).
_TOKEN_BYTES = 16


def _token_path(cert_dir: str | os.PathLike[str]) -> Path:
    return Path(cert_dir) / TOKEN_NAME


def _write_token(path: Path, token: str) -> None:
    """Write ``token`` restrictively (``0o600``) from the start."""
    path.parent.mkdir(parents=True, exist_ok=True)
    # Open with O_CREAT|O_TRUNC and mode 0o600 so the secret is never briefly
    # world-readable between create and chmod (mirrors certs.py's key write).
    fd = os.open(str(path), os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write(token)
    os.chmod(path, 0o600)


def _read_token(path: Path) -> str | None:
    """Return the stored token, or ``None`` if absent/empty/unreadable."""
    try:
        token = path.read_text(encoding="utf-8").strip()
    except (OSError, ValueError):
        return None
    return token or None


def generate_token() -> str:
    """Return a fresh URL-safe operator token (not persisted)."""
    return secrets.token_urlsafe(_TOKEN_BYTES)


def ensure_token(cert_dir: str | os.PathLike[str]) -> str:
    """Return the persisted operator token, generating it on first call.

    Idempotent: a token written by a previous run (or an earlier call) is reused
    verbatim, so the booth keeps a stable credential across restarts.
    """
    path = _token_path(cert_dir)
    existing = _read_token(path)
    if existing is not None:
        logger.debug("reusing existing operator token at %s", path)
        return existing
    token = generate_token()
    _write_token(path, token)
    logger.info("generated operator token at %s", path)
    return token


def token_matches(candidate: object, token: str) -> bool:
    """Constant-time compare of a client-supplied ``candidate`` to ``token``.

    Accepts anything (query params / JSON values arrive untyped): a non-string
    or empty candidate is simply a mismatch. Uses :func:`hmac.compare_digest` so
    the check does not leak the token length or contents through timing.
    """
    if not isinstance(candidate, str) or not candidate:
        return False
    return hmac.compare_digest(candidate, token)


def rotate_token(cert_dir: str | os.PathLike[str]) -> str:
    """Generate, persist and return a *new* operator token.

    Rotating invalidates every previously printed ``/debug?key=…`` sheet — the
    booth staff must reprint (or re-enter) the new token.
    """
    path = _token_path(cert_dir)
    token = generate_token()
    _write_token(path, token)
    logger.info("rotated operator token at %s", path)
    return token
