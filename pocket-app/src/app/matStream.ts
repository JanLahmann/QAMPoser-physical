/**
 * Streaming-crop selection for the camera role (task #34).
 *
 * The camera-role frame pump draws one crop of the live video each animation
 * frame and hands it to the streaming sink. This picks WHICH crop:
 *
 *  - **mat lock** (set) — the axis-aligned mat ROI, in source px, replacing the
 *    digital zoom entirely while locked (design: "mat crop replaces digital zoom
 *    while locked, the zoom pill hides"). Clamped defensively to the frame.
 *  - **no lock** — the existing digital-zoom centre crop (`cropRect`), i.e. the
 *    unchanged "what you zoom is what streams" behaviour.
 *
 * Freeze is NOT decided here: the loop already gates on `shouldProcess(paused)`
 * BEFORE reaching the sink, so freezing pauses the pump whether or not the mat is
 * locked (freeze semantics unchanged). Kept pure so the selection is unit-tested
 * without a camera.
 */
import { cropRect, type CropRect } from './zoom';
import { clampRect, type Rect } from '@shared/capture/matRoi';

/**
 * The crop the streaming sink should draw this frame. A mat lock wins over the
 * digital zoom; otherwise the digital-zoom centre crop is used.
 */
export function frameStreamCrop(
  matCrop: Rect | null,
  digitalZoom: number,
  width: number,
  height: number,
): CropRect {
  if (matCrop) return clampRect(matCrop, width, height);
  return cropRect(digitalZoom, width, height);
}
