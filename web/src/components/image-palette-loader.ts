import type { PaletteColor } from "./image-palette";

export type PhotoPalette = { thumbnail: string; colors: PaletteColor[] };

/** URLs, decoded pixels and workers live only for this operation; no photo or metadata is persisted. */
export async function readPhotoPalette(file: File, signal: AbortSignal): Promise<PhotoPalette> {
  if (file.size > 25 * 1024 * 1024) throw new Error("Choose a photo smaller than 25 MB.");
  if (!file.size || (file.type && !file.type.startsWith("image/")) || /svg/i.test(file.type) || /\.svgz?$/i.test(file.name)) {
    throw new Error("Choose a photo, such as JPEG, PNG or WebP.");
  }
  signal.throwIfAborted();
  const url = URL.createObjectURL(file), image = new Image();
  let worker: Worker | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timeout); signal.removeEventListener("abort", abort);
        image.onload = null; image.onerror = null;
        if (error) reject(error); else resolve();
      };
      const abort = () => finish(new DOMException("Canceled", "AbortError"));
      const timeout = setTimeout(() => finish(new Error("This photo is taking too long to open. Try a smaller JPEG.")), 20000);
      signal.addEventListener("abort", abort, { once: true });
      image.onload = () => finish();
      image.onerror = () => finish(new Error("This browser could not open the photo. Try a JPEG, PNG or WebP copy."));
      image.src = url;
    });
    signal.throwIfAborted();
    const scale = Math.min(1, 256 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d", { colorSpace: "srgb", willReadFrequently: true });
    if (!ctx) throw new Error("Photo colors are unavailable in this browser. Try updating your browser.");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const thumbnail = canvas.toDataURL("image/png");
    worker = new Worker(new URL("./image-palette.worker.ts", import.meta.url), { type: "module" });
    const activeWorker = worker;
    const colors = await new Promise<PaletteColor[]>((resolve, reject) => {
      const finish = (colors?: PaletteColor[], error?: Error) => {
        clearTimeout(timeout); signal.removeEventListener("abort", abort);
        if (error) reject(error); else resolve(colors!);
      };
      const abort = () => finish(undefined, new DOMException("Canceled", "AbortError"));
      const timeout = setTimeout(() => finish(undefined, new Error("Color extraction took too long. Try another photo.")), 15000);
      signal.addEventListener("abort", abort, { once: true });
      activeWorker.onmessage = ({ data }: MessageEvent<{ colors?: PaletteColor[]; error?: string }>) => {
        if (data.error) finish(undefined, new Error(data.error)); else finish(data.colors);
      };
      activeWorker.onerror = event => { event.preventDefault(); finish(undefined, new Error("Could not read the colors. Reload and try again.")); };
      activeWorker.postMessage({ data, width: canvas.width, height: canvas.height }, [data.buffer]);
    });
    signal.throwIfAborted();
    return { thumbnail, colors };
  } finally {
    worker?.terminate(); image.src = ""; URL.revokeObjectURL(url);
  }
}
