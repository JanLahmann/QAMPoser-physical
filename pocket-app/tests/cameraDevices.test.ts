import { describe, it, expect, vi } from 'vitest';
import {
  toCameraDevices,
  hasOnlyPlaceholders,
  buildVideoConstraints,
  shouldFallbackToAuto,
  enumerateCameras,
  subscribeDeviceChange,
  type MediaDevicesLike,
} from '../src/app/cameraDevices';

/** Build a minimal MediaDeviceInfo-shaped object for the enumerator. */
function dev(kind: MediaDeviceKind, deviceId: string, label: string): MediaDeviceInfo {
  return { kind, deviceId, label, groupId: 'g', toJSON: () => ({}) } as MediaDeviceInfo;
}

/** A mock `navigator.mediaDevices` with a controllable device list + devicechange. */
function mockMediaDevices(initial: MediaDeviceInfo[]) {
  let devices = initial;
  const listeners = new Set<() => void>();
  const md: MediaDevicesLike = {
    enumerateDevices: () => Promise.resolve(devices),
    addEventListener: (_type, l) => void listeners.add(l),
    removeEventListener: (_type, l) => void listeners.delete(l),
  };
  return {
    md,
    setDevices: (next: MediaDeviceInfo[]) => (devices = next),
    fireDeviceChange: () => listeners.forEach((l) => l()),
    listenerCount: () => listeners.size,
  };
}

describe('toCameraDevices', () => {
  it('keeps videoinputs only and passes through real labels', () => {
    const out = toCameraDevices([
      dev('videoinput', 'cam-a', 'FaceTime HD'),
      dev('audioinput', 'mic-a', 'Built-in Mic'),
      dev('videooutput' as MediaDeviceKind, 'x', 'x'),
      dev('videoinput', 'cam-b', "Jan's iPhone Camera"),
    ]);
    expect(out).toEqual([
      { deviceId: 'cam-a', label: 'FaceTime HD', placeholder: false },
      { deviceId: 'cam-b', label: "Jan's iPhone Camera", placeholder: false },
    ]);
  });

  it('substitutes positional "Camera N" placeholders for empty/blank labels', () => {
    const out = toCameraDevices([
      dev('videoinput', 'cam-a', ''),
      dev('videoinput', 'cam-b', '   '),
    ]);
    expect(out).toEqual([
      { deviceId: 'cam-a', label: 'Camera 1', placeholder: true },
      { deviceId: 'cam-b', label: 'Camera 2', placeholder: true },
    ]);
  });

  it('returns [] when there are no cameras', () => {
    expect(toCameraDevices([dev('audioinput', 'mic', 'Mic')])).toEqual([]);
  });
});

describe('hasOnlyPlaceholders', () => {
  it('is true only when every camera is still a placeholder', () => {
    expect(hasOnlyPlaceholders([])).toBe(false);
    expect(
      hasOnlyPlaceholders([{ deviceId: 'a', label: 'Camera 1', placeholder: true }]),
    ).toBe(true);
    expect(
      hasOnlyPlaceholders([
        { deviceId: 'a', label: 'Camera 1', placeholder: true },
        { deviceId: 'b', label: 'FaceTime HD', placeholder: false },
      ]),
    ).toBe(false);
  });
});

describe('buildVideoConstraints', () => {
  it('asks for the rear camera when no device is chosen', () => {
    expect(buildVideoConstraints({ cameraId: null })).toEqual({
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    });
  });

  it('targets an exact device when one is chosen', () => {
    expect(buildVideoConstraints({ cameraId: 'cam-b' })).toEqual({
      deviceId: { exact: 'cam-b' },
      width: { ideal: 1920 },
      height: { ideal: 1080 },
    });
  });

  it('honours custom width/height ideals', () => {
    const c = buildVideoConstraints({ cameraId: null, width: 1280, height: 720 });
    expect(c.width).toEqual({ ideal: 1280 });
    expect(c.height).toEqual({ ideal: 720 });
  });
});

describe('shouldFallbackToAuto', () => {
  it('never falls back when no device was chosen', () => {
    expect(shouldFallbackToAuto(null, { name: 'OverconstrainedError' })).toBe(false);
  });

  it('falls back for a chosen device that is gone/unreadable', () => {
    expect(shouldFallbackToAuto('cam-b', { name: 'OverconstrainedError' })).toBe(true);
    expect(shouldFallbackToAuto('cam-b', { name: 'NotFoundError' })).toBe(true);
    expect(shouldFallbackToAuto('cam-b', { name: 'NotReadableError' })).toBe(true);
    expect(shouldFallbackToAuto('cam-b', undefined)).toBe(true);
  });

  it('does NOT silently retry a permission denial', () => {
    expect(shouldFallbackToAuto('cam-b', { name: 'NotAllowedError' })).toBe(false);
  });
});

describe('enumerateCameras', () => {
  it('lists cameras via an injected mediaDevices', async () => {
    const { md } = mockMediaDevices([
      dev('videoinput', 'cam-a', 'FaceTime HD'),
      dev('audioinput', 'mic', 'Mic'),
    ]);
    expect(await enumerateCameras(md)).toEqual([
      { deviceId: 'cam-a', label: 'FaceTime HD', placeholder: false },
    ]);
  });

  it('returns [] when mediaDevices is missing', async () => {
    expect(await enumerateCameras(undefined)).toEqual([]);
  });

  it('swallows enumeration failure and returns []', async () => {
    const md: MediaDevicesLike = { enumerateDevices: () => Promise.reject(new Error('nope')) };
    expect(await enumerateCameras(md)).toEqual([]);
  });
});

describe('subscribeDeviceChange', () => {
  it('re-lists on devicechange (Continuity Camera appears) and unsubscribes cleanly', async () => {
    const rig = mockMediaDevices([dev('videoinput', 'cam-a', 'FaceTime HD')]);
    const onChange = vi.fn();
    const unsub = subscribeDeviceChange(onChange, rig.md);
    expect(rig.listenerCount()).toBe(1);

    // An iPhone joins as a Continuity Camera → devicechange fires → re-list.
    rig.setDevices([
      dev('videoinput', 'cam-a', 'FaceTime HD'),
      dev('videoinput', 'cam-b', "Jan's iPhone Camera"),
    ]);
    rig.fireDeviceChange();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(await enumerateCameras(rig.md)).toHaveLength(2);

    unsub();
    expect(rig.listenerCount()).toBe(0);
    rig.fireDeviceChange();
    expect(onChange).toHaveBeenCalledTimes(1); // no more callbacks after unsubscribe
  });

  it('is a safe no-op when devicechange is unavailable', () => {
    const md: MediaDevicesLike = { enumerateDevices: () => Promise.resolve([]) };
    const unsub = subscribeDeviceChange(() => {}, md);
    expect(() => unsub()).not.toThrow();
  });
});
