import { analyzeImage } from "./image-palette";

self.onmessage = (event: MessageEvent<{ data: Uint8ClampedArray; width: number; height: number }>) => {
  try {
    const { data, width, height } = event.data;
    self.postMessage({ colors: analyzeImage(data, width, height) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : "Could not find colors. Try another photo." });
  }
};
