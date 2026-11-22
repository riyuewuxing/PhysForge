export interface CanvasRecorderController {
  readonly mimeType: string;
  readonly start: () => void;
  readonly stop: () => Promise<Blob>;
}

/**
 * 基于浏览器原生 canvas.captureStream(60) + MediaRecorder 导出离线 WebM 教学动画录像
 */
export function createCanvasWebmRecorder(
  canvas: HTMLCanvasElement,
  fps = 60
): CanvasRecorderController {
  if (typeof MediaRecorder === 'undefined' || typeof canvas.captureStream !== 'function') {
    throw new Error('当前浏览器不支持 canvas.captureStream / MediaRecorder WebM 录屏接口。');
  }

  const candidates = [
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm'
  ];
  const mimeType =
    candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? 'video/webm';

  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(stream, { mimeType });
  const chunks: BlobPart[] = [];

  recorder.ondataavailable = (ev) => {
    if (ev.data && ev.data.size > 0) {
      chunks.push(ev.data);
    }
  };

  return {
    mimeType,
    start: () => {
      chunks.length = 0;
      recorder.start(100);
    },
    stop: () =>
      new Promise<Blob>((resolve, reject) => {
        recorder.onerror = () => reject(new Error('MediaRecorder 录制失败。'));
        recorder.onstop = () => {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          resolve(new Blob(chunks, { type: mimeType }));
        };
        if (recorder.state !== 'inactive') {
          recorder.stop();
        } else {
          resolve(new Blob(chunks, { type: mimeType }));
        }
      })
  };
}

/**
 * 将多帧物理快照渲染为“多帧频闪叠加合成长图” PNG Blob
 */
export async function renderStrobeCompositePng<TFrame>(
  width: number,
  height: number,
  frames: readonly TFrame[],
  drawFrame: (ctx: CanvasRenderingContext2D, frame: TFrame, alpha: number, idx: number) => void,
  backgroundColor = '#ffffff'
): Promise<Blob> {
  if (typeof document === 'undefined') {
    throw new Error('renderStrobeCompositePng requires a browser DOM environment.');
  }
  const offscreen = document.createElement('canvas');
  offscreen.width = width;
  offscreen.height = height;
  const ctx = offscreen.getContext('2d');
  if (!ctx) {
    throw new Error('Unable to create offscreen 2D context for strobe composite.');
  }

  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  const count = frames.length;
  for (let i = 0; i < count; i++) {
    const alpha = count === 1 ? 1.0 : 0.25 + (0.75 * i) / (count - 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    drawFrame(ctx, frames[i]!, alpha, i);
    ctx.restore();
  }

  return await new Promise<Blob>((resolve, reject) => {
    offscreen.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Failed to encode strobe composite PNG.'));
    }, 'image/png');
  });
}
