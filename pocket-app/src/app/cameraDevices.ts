/**
 * Camera device enumeration for Entangible Pocket.
 *
 * A thin, injectable wrapper over `navigator.mediaDevices` so the picker in the
 * Settings drawer can list the machine's video inputs and follow them live.
 *
 * Two browser quirks shape this module:
 *
 *  1. **Empty labels before permission.** `enumerateDevices()` returns each
 *     videoinput's `deviceId`, but its `label` is an empty string until the page
 *     has been granted camera permission at least once. We substitute a stable
 *     placeholder ("Camera 1", "Camera 2", …) so the list is never blank, and
 *     mark it `placeholder: true` so the UI can nudge "start the camera once to
 *     see names" and re-enumerate after the first successful `getUserMedia`.
 *
 *  2. **Devices come and go.** On a Mac an iPhone can join as a Continuity
 *     Camera (and leave) while the app runs; laptops gain/lose USB webcams. The
 *     `devicechange` event fires on `navigator.mediaDevices` — subscribe to it
 *     and re-list.
 *
 * The pure helpers (`toCameraDevices`, `hasOnlyPlaceholders`,
 * `buildVideoConstraints`, `shouldFallbackToAuto`) carry the logic so they
 * unit-test without a browser; the async/DOM bits take an injected
 * `MediaDevicesLike` for the same reason.
 */

/** One selectable camera for the picker. */
export interface CameraDevice {
  readonly deviceId: string;
  /** Real device name, or a "Camera N" placeholder until permission is granted. */
  readonly label: string;
  /** True when `label` is a placeholder (the browser hid the real name pre-permission). */
  readonly placeholder: boolean;
}

/**
 * The slice of `navigator.mediaDevices` this module depends on. Injectable so
 * tests can pass a plain mock (and so a non-browser/SSR context degrades to an
 * empty list instead of throwing).
 */
export interface MediaDevicesLike {
  enumerateDevices(): Promise<MediaDeviceInfo[]>;
  addEventListener?: (type: 'devicechange', listener: () => void) => void;
  removeEventListener?: (type: 'devicechange', listener: () => void) => void;
}

/** The real `navigator.mediaDevices`, or `undefined` when unavailable. */
export function defaultMediaDevices(): MediaDevicesLike | undefined {
  if (typeof navigator === 'undefined') return undefined;
  return (navigator.mediaDevices as MediaDevicesLike | undefined) ?? undefined;
}

/**
 * Turn a raw `enumerateDevices()` result into the picker's list: videoinputs
 * only, each with a real label or a positional "Camera N" placeholder. Pure.
 */
export function toCameraDevices(devices: readonly MediaDeviceInfo[]): CameraDevice[] {
  const videos = devices.filter((d) => d.kind === 'videoinput');
  return videos.map((d, i) => {
    const label = (d.label ?? '').trim();
    return label
      ? { deviceId: d.deviceId, label, placeholder: false }
      : { deviceId: d.deviceId, label: `Camera ${i + 1}`, placeholder: true };
  });
}

/**
 * True when there is at least one camera and every one is still a placeholder —
 * i.e. permission has not populated real names yet. Drives the drawer's
 * "start the camera once to see names" hint. Pure.
 */
export function hasOnlyPlaceholders(devices: readonly CameraDevice[]): boolean {
  return devices.length > 0 && devices.every((d) => d.placeholder);
}

/** List the machine's video-input cameras. Never throws — returns `[]` on any failure. */
export async function enumerateCameras(
  md: MediaDevicesLike | undefined = defaultMediaDevices(),
): Promise<CameraDevice[]> {
  if (!md?.enumerateDevices) return [];
  try {
    return toCameraDevices(await md.enumerateDevices());
  } catch {
    return [];
  }
}

/**
 * Subscribe to `devicechange` (a camera appearing/disappearing — e.g. an iPhone
 * Continuity Camera joining a Mac). Returns an unsubscribe function; a no-op
 * teardown when the event is unavailable.
 */
export function subscribeDeviceChange(
  onChange: () => void,
  md: MediaDevicesLike | undefined = defaultMediaDevices(),
): () => void {
  if (!md?.addEventListener) return () => {};
  md.addEventListener('devicechange', onChange);
  return () => md.removeEventListener?.('devicechange', onChange);
}

// --- getUserMedia constraint building --------------------------------------

export interface VideoConstraintOpts {
  /** Chosen device, or `null` for automatic rear-facing selection. */
  readonly cameraId: string | null;
  readonly width?: number;
  readonly height?: number;
}

/**
 * Build the `video` constraint for `getUserMedia`:
 *  - a chosen `cameraId` → `deviceId: { exact }` (that device, or reject);
 *  - `null` → `facingMode: { ideal: 'environment' }` (the rear/back camera when
 *    there is one, otherwise whatever the browser defaults to).
 * Both request 1080p ideals — native/digital zoom both want the extra pixels
 * for pixels-per-marker (see zoom.ts). Pure.
 */
export function buildVideoConstraints({
  cameraId,
  width = 1920,
  height = 1080,
}: VideoConstraintOpts): MediaTrackConstraints {
  const size = { width: { ideal: width }, height: { ideal: height } };
  return cameraId
    ? { deviceId: { exact: cameraId }, ...size }
    : { facingMode: { ideal: 'environment' }, ...size };
}

/**
 * Decide whether a failed `getUserMedia` for a *chosen* device should silently
 * retry on the automatic constraint. Only meaningful when a `cameraId` was set.
 * We retry for every failure except a permission denial (`NotAllowedError`) —
 * a denied camera is not a "device gone" situation and the auto retry would
 * only be denied again, so we let it surface. Pure.
 */
export function shouldFallbackToAuto(cameraId: string | null, error: unknown): boolean {
  if (!cameraId) return false;
  const name = (error as { name?: string } | null)?.name;
  return name !== 'NotAllowedError';
}
