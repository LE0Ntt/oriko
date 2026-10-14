import { App, arrayBufferToBase64, normalizePath, requestUrl } from "obsidian";
import type { MediaCache } from "./core/cache";
import { FRAME_FRACTIONS, fitWithin, gridCell } from "./core/describe";
import type { ClippingRecord } from "./core/scan";
import { nodeRequire } from "./core/system";
import { buildTiles } from "./core/tile";
import { absolutePath, extractVideoFrame } from "./convert";

/**
 * The picture Describe sends for a clipping: its tile's own cover as a JPEG at
 * most 1,024 px on the long edge, or for a video a 2x2 grid of four frames.
 *
 * Bytes are read through the vault and drawn from blob: URLs, which are
 * same-origin, so the canvas is never tainted. An OffscreenCanvas keeps the
 * work out of the DOM.
 */

const JPEG_QUALITY = 0.85;
const EVENT_TIMEOUT_MS = 10000;
const REMOTE = /^https?:\/\//i;

const VIDEO_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  mov: "video/quicktime",
  webm: "video/webm",
};

export async function mediaFor(app: App, record: ClippingRecord, cache: MediaCache): Promise<string | null> {
  const [tile] = buildTiles([record], cache);
  if (!tile) return null;

  if (tile.kind === "video" && !tile.remote) {
    const grid = await videoGrid(app, tile.filePath).catch(() => null);
    if (grid) return grid;
  }
  if (tile.kind === "image") {
    const still = await imageAt(app, tile.filePath, tile.remote).catch(() => null);
    if (still) return still;
  }
  if (tile.posterPath) {
    const poster = await imageAt(app, tile.posterPath, REMOTE.test(tile.posterPath)).catch(() => null);
    if (poster) return poster;
  }
  if (tile.kind === "video" && !tile.remote) return firstFrame(app, tile.filePath);
  return null;
}

async function bytesOf(app: App, path: string, remote: boolean): Promise<ArrayBuffer> {
  if (remote) return (await requestUrl({ url: path, method: "GET" })).arrayBuffer;
  return app.vault.adapter.readBinary(normalizePath(path));
}

async function encode(canvas: OffscreenCanvas): Promise<string> {
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: JPEG_QUALITY });
  return arrayBufferToBase64(await blob.arrayBuffer());
}

async function jpegFrom(bytes: BlobPart): Promise<string> {
  const bitmap = await createImageBitmap(new Blob([bytes]));
  try {
    const size = fitWithin(bitmap.width, bitmap.height);
    const canvas = new OffscreenCanvas(size.width, size.height);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("no 2d context");
    context.drawImage(bitmap, 0, 0, size.width, size.height);
    return await encode(canvas);
  } finally {
    bitmap.close();
  }
}

async function imageAt(app: App, path: string, remote: boolean): Promise<string> {
  return jpegFrom(await bytesOf(app, path, remote));
}

function once(video: HTMLVideoElement, event: "loadeddata" | "seeked"): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      window.clearTimeout(timer);
      video.removeEventListener(event, ok);
      video.removeEventListener("error", bad);
    };
    const ok = (): void => {
      cleanup();
      resolve();
    };
    const bad = (): void => {
      cleanup();
      reject(new Error("the video would not load"));
    };
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`${event} took too long`));
    }, EVENT_TIMEOUT_MS);
    video.addEventListener(event, ok);
    video.addEventListener("error", bad);
  });
}

async function videoGrid(app: App, path: string): Promise<string | null> {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const blob = new Blob([await bytesOf(app, path, false)], { type: VIDEO_TYPES[extension] ?? "" });
  const url = URL.createObjectURL(blob);
  const video = createEl("video");
  video.muted = true;
  video.preload = "auto";
  try {
    const loaded = once(video, "loadeddata");
    video.src = url;
    await loaded;
    if (!video.videoWidth || !Number.isFinite(video.duration) || video.duration <= 0) return null;

    const cell = gridCell(video.videoWidth, video.videoHeight);
    const canvas = new OffscreenCanvas(cell.width * 2, cell.height * 2);
    // CPU-backed, so each frame is read back as it is drawn, between the
    // seeks, and the encode at the end has no GPU readback to wait on.
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    for (const [index, fraction] of FRAME_FRACTIONS.entries()) {
      const seeked = once(video, "seeked");
      video.currentTime = video.duration * fraction;
      await seeked;
      context.drawImage(
        video,
        (index % 2) * cell.width,
        Math.floor(index / 2) * cell.height,
        cell.width,
        cell.height
      );
    }
    return await encode(canvas);
  } finally {
    video.removeAttribute("src");
    video.load();
    URL.revokeObjectURL(url);
  }
}

interface FsModule {
  readFileSync(path: string): Uint8Array<ArrayBuffer>;
  rmSync(path: string, options: { force: boolean }): void;
}

interface OsModule {
  tmpdir(): string;
}

/** The last resort for a video Chromium cannot play and that has no poster: ffmpeg's first frame. */
async function firstFrame(app: App, path: string): Promise<string | null> {
  const source = absolutePath(app.vault, normalizePath(path));
  const fs = nodeRequire("fs") as FsModule | null;
  const os = nodeRequire("os") as OsModule | null;
  if (!source || !fs || !os) return null;
  const target = `${os.tmpdir()}/oriko-describe-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  try {
    if (!(await extractVideoFrame(source, target))) return null;
    return await jpegFrom(fs.readFileSync(target));
  } catch {
    return null;
  } finally {
    try {
      fs.rmSync(target, { force: true });
    } catch {
      // Already gone.
    }
  }
}
