"""``/ws/frames`` endpoint — phone camera pushes JPEG frames to the host.

Binary WebSocket messages are JPEG-encoded frames fed into the active
``PushFrameSource`` (most-recent-wins: the source keeps a single latest-frame
slot, so backpressure is the client's job). Optional JSON text messages
(``{"type":"hello",...}``) are accepted and ignored.

**Staff-gated:** the phone-capture page is opened from a staff QR that carries
the operator token, so the socket requires a matching ``?key=<token>`` query
parameter. This closes the anonymous frame-injection hole — an unauthenticated
connection is accepted and then closed with policy code ``4403`` (no frames are
ever read from it).

If no push source is active (the pipeline isn't running one, or the vision
package isn't available), frames are accepted and dropped with a warning — this
keeps the endpoint importable and connectable before the M4 capture flow lands.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .config import ensure_push_source
from .token import token_matches

logger = logging.getLogger("qamposer_host.ws_frames")

router = APIRouter()

#: Application-defined WebSocket close code for a missing/wrong operator token.
FRAMES_UNAUTHORIZED_CODE = 4403


@router.websocket("/ws/frames")
async def ws_frames(websocket: WebSocket) -> None:
    app = websocket.app
    await websocket.accept()
    # Gate on the operator token (query param). We accept first so the client
    # observes a clean WebSocket close with our policy code rather than a raw
    # handshake rejection, then read nothing from an unauthorized socket.
    if not token_matches(websocket.query_params.get("key"), app.state.operator_token):
        logger.info("/ws/frames rejected: missing/invalid operator key")
        await websocket.close(code=FRAMES_UNAUTHORIZED_CODE)
        return
    # Ensure the single shared PushFrameSource exists so frames always land in
    # it — even before `select_camera {kind:'push'}` swaps the pipeline onto it
    # (most-recent-wins slot; the latest frame is ready the instant we swap).
    if ensure_push_source(app) is None:
        logger.warning(
            "/ws/frames connected but no PushFrameSource is available "
            "(vision package missing); frames will be accepted and dropped"
        )
    warned_push_error = False
    try:
        while True:
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                break
            data = message.get("bytes")
            if data is not None:
                push = getattr(app.state, "push_source", None)
                if push is not None:
                    try:
                        push.push(data)  # most-recent-wins single slot
                    except Exception:
                        if not warned_push_error:
                            logger.warning("push_source.push failed", exc_info=True)
                            warned_push_error = True
            # text frames (optional hello) are ignored
    except WebSocketDisconnect:
        pass
    except Exception:  # pragma: no cover - defensive
        logger.exception("unexpected /ws/frames error")
