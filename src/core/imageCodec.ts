/**
 * Browser image decoding.
 *
 * The only module in `core/` that touches a platform API. It is imported
 * exclusively by the image adapter and always guards for its absence, so the
 * rest of the engine stays testable in Node.
 *
 * SAFETY: bytes are handed to the platform image decoder and then read back
 * through a 2D canvas. The buffer is never fetched, linked, or executed.
 * A malformed file yields a decoder error, which is a measurement, not a
 * crash.
 */

import type { RgbaImage } from "./pixels";

export type DecodeResult =
  | { ok: true; image: RgbaImage; width: number; height: number }
  | { ok: false; reason: string };

export function isImageDecodingAvailable(): boolean {
  return (
    typeof createImageBitmap === "function" &&
    typeof OffscreenCanvas === "function"
  );
}

/** Decode PNG bytes to RGBA. Never throws. */
export async function decodeImageBuffer(bytes: Uint8Array): Promise<DecodeResult> {
  if (!isImageDecodingAvailable()) {
    return { ok: false, reason: "image decoding is unavailable in this environment" };
  }

  // Copy into a standalone ArrayBuffer: some browsers retain the buffer passed
  // to createImageBitmap, and mutation experiments hand us reused views.
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const blob = new Blob([copy], { type: "image/png" });

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (error) {
    return { ok: false, reason: describe(error) };
  }

  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return { ok: false, reason: "could not obtain a 2D drawing context" };

    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return {
      ok: true,
      image: {
        width: bitmap.width,
        height: bitmap.height,
        data: new Uint8ClampedArray(imageData.data),
      },
      width: bitmap.width,
      height: bitmap.height,
    };
  } catch (error) {
    return { ok: false, reason: describe(error) };
  } finally {
    bitmap.close();
  }
}

function describe(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
