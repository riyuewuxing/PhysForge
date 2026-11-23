import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvasWebmRecorder } from './mediaRecorder.js';

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = vi.fn((mimeType: string) =>
    mimeType === 'video/webm' || mimeType === 'video/webm;codecs=vp9' || mimeType === 'video/webm;codecs=vp8'
  );

  state: RecordingState = 'inactive';
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  start = vi.fn((timeslice?: number) => {
    expect(timeslice).toBe(100);
    this.state = 'recording';
  });
  requestData = vi.fn(() => {
    this.ondataavailable?.({ data: new Blob(['webm-frame']) } as BlobEvent);
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
    this.onstop?.(new Event('stop'));
  });

  constructor(_stream: MediaStream, _options?: MediaRecorderOptions) {
    FakeMediaRecorder.instances.push(this);
  }
}

describe('canvas WebM recorder', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeMediaRecorder.instances = [];
    FakeMediaRecorder.isTypeSupported.mockClear();
  });

  it('prefers browser-selected video/webm, starts with a timeslice, and flushes data before stop', async () => {
    const trackStop = vi.fn();
    const requestFrame = vi.fn();
    const videoTrack = { stop: trackStop, requestFrame };
    const stream = {
      getTracks: () => [videoTrack],
      getVideoTracks: () => [videoTrack]
    } as unknown as MediaStream;
    const canvas = { captureStream: vi.fn(() => stream) } as unknown as HTMLCanvasElement;
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    const controller = createCanvasWebmRecorder(canvas);
    expect(controller.mimeType).toBe('video/webm');
    controller.start();
    const recorder = FakeMediaRecorder.instances[0]!;
    const blob = await controller.stop();

    expect(recorder.start).toHaveBeenCalledWith(100);
    expect(requestFrame).toHaveBeenCalledTimes(2);
    expect(recorder.requestData).toHaveBeenCalledOnce();
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(blob.type).toBe('video/webm');
    expect(blob.size).toBeGreaterThan(0);
    expect(trackStop).toHaveBeenCalledOnce();
  });
});
