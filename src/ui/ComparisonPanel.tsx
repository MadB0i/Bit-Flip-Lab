/**
 * Before / after comparison.
 *
 * Renders what was actually decoded. When a renderer exists the plates are
 * real pixels; when it does not, the panel says so and shows the byte-level
 * delta instead of inventing an image.
 *
 * Difference amplification is explicit and labelled. A single flipped pixel
 * bit is a single-pixel change, and the panel never pretends otherwise.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { amplifiedDifference, diffRgba, markChangedRegion, type RgbaImage } from "../core/pixels";
import { byteToHex } from "../core/bits";
import type { CompareMode } from "../state/labState";
import type { ExperimentRun } from "../core/pipeline";

const ZOOMS = [1, 2, 4, 8] as const;
const GAINS = [1, 8, 32] as const;
/** Target plate width in CSS pixels, used to choose the default magnification. */
const FIT_TARGET_PX = 640;

type ZoomChoice = number | "fit";

/** Small images must be magnified by default or the mutation is invisible. */
function fitScale(imageWidth: number): number {
  const raw = Math.round(FIT_TARGET_PX / Math.max(1, imageWidth));
  const allowed = [...ZOOMS].filter((z) => z <= raw);
  return allowed.length > 0 ? allowed[allowed.length - 1]! : ZOOMS[0];
}

/**
 * The difference plate.
 *
 * The changed region reported by `diffRgba` is bracketed directly on the
 * plate, because a single-pixel change is otherwise impossible to find by
 * eye — and locating it is the entire claim of the measurement.
 */
function DifferencePlate({
  original,
  mutated,
  gain,
  zoom,
}: {
  original: RgbaImage;
  mutated: RgbaImage;
  gain: number;
  zoom: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const measurement = useMemo(() => diffRgba(original, mutated), [original, mutated]);

  const image = useMemo(() => {
    const amplified = amplifiedDifference(original, mutated, gain);
    if (measurement.changedBounds) {
      markChangedRegion(amplified, measurement.changedBounds, CHANGE_REGION_RGB);
    }
    return amplified;
  }, [original, mutated, gain, measurement.changedBounds]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // createImageData + copy avoids the ImageData constructor's overloads and
    // keeps the typed array on its own buffer.
    const imageData = ctx.createImageData(image.width, image.height);
    imageData.data.set(image.data);
    ctx.putImageData(imageData, 0, 0);
  }, [image]);

  const bounds = measurement.changedBounds;

  return (
    <div className="compare__stage">
      <div className="compare__label">
        <span>Difference, amplified ×{gain}</span>
        <span className="numeric">
          {original.width}×{original.height}
          {zoom > 1 ? ` · ${zoom}×` : ""}
        </span>
      </div>
      <div className="image-plate">
        <div
          className="image-plate__frame"
          style={{ width: `${image.width * zoom}px`, maxWidth: "100%" }}
        >
          <canvas
            ref={canvasRef}
            className="image-plate__canvas"
            style={{ width: `${image.width * zoom}px` }}
            role="img"
            aria-label={`Difference, amplified ${gain} times. ${measurement.pixelsChanged} of ${measurement.pixelsTotal} pixels differ. ${
              bounds
                ? `The changed region is at x${bounds.x}, y${bounds.y}, ${bounds.width} by ${bounds.height} pixels, and is bracketed on the plate.`
                : "No pixels differ."
            }`}
          />
        </div>
      </div>
    </div>
  );
}

/** The instrument accent, as RGBA, for the on-canvas change-region outline. */
const CHANGE_REGION_RGB: readonly [number, number, number, number] = [255, 176, 32, 255];

function ImagePlate({
  image,
  zoom,
  caption,
  note,
}: {
  image: RgbaImage;
  zoom: number;
  caption: string;
  note?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = image.width;
    canvas.height = image.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // createImageData + copy avoids the ImageData constructor's overloads and
    // keeps the typed array on its own buffer.
    const imageData = ctx.createImageData(image.width, image.height);
    imageData.data.set(image.data);
    ctx.putImageData(imageData, 0, 0);
  }, [image]);

  return (
    <div className="compare__stage">
      <div className="compare__label">
        <span>{caption}</span>
        <span className="numeric">
          {image.width}×{image.height}
          {zoom > 1 ? ` · ${zoom}×` : ""}
        </span>
      </div>
      <div className="image-plate">
        <div
          className="image-plate__frame"
          style={{ width: `${image.width * zoom}px`, maxWidth: "100%" }}
        >
          <canvas
            ref={canvasRef}
            className="image-plate__canvas"
            style={{ width: `${image.width * zoom}px` }}
            role="img"
            aria-label={`${caption}. ${image.width} by ${image.height} pixels. ${note ?? ""}`}
          />
        </div>
      </div>
    </div>
  );
}

/** True when the original decoded but the mutation destroyed it. */
function mutatedExecutionFailed(run: ExperimentRun): boolean {
  return run.originalExecution.verdict === "ok" && run.mutatedExecution.verdict === "failed";
}

export function ComparisonPanel({
  run,
  mode,
  onMode,
}: {
  run: ExperimentRun;
  mode: CompareMode;
  onMode: (mode: CompareMode) => void;
}) {
  const [zoomChoice, setZoomChoice] = useState<ZoomChoice>("fit");
  const [gain, setGain] = useState<(typeof GAINS)[number]>(1);

  const original = run.originalExecution.render?.image ?? null;
  const mutated = run.mutatedExecution.render?.image ?? null;
  const render = run.measurement.render;
  /** True when a renderer exists for this format at all. */
  const hasRenderer = run.originalExecution.verdict === "ok" && original !== null;
  /** True when both sides are available, so a difference can be computed. */
  const canCompare = original !== null && mutated !== null;

  const difference = useMemo(() => {
    if (!canCompare || !original || !mutated || original.width !== mutated.width) return null;
    return amplifiedDifference(original, mutated, gain);
  }, [canCompare, original, mutated, gain]);

  /**
   * Two independent failure modes must not be conflated:
   *  · no renderer for this format  → there is nothing to draw at all
   *  · renderer exists, mutation broke it → the original must still be shown,
   *    because "this one bit destroyed the image" is the whole point
   */
  const effectiveMode: CompareMode =
    mode === "difference" && !canCompare
      ? hasRenderer
        ? "original"
        : "mutated"
      : mode;

  const modeEnabled = (option: CompareMode) =>
    option === "original" ? original !== null : option === "mutated" ? mutated !== null : canCompare;

  const plate = effectiveMode === "mutated" ? mutated : original;
  const zoom = zoomChoice === "fit" ? (plate ? fitScale(plate.width) : 1) : zoomChoice;

  /**
   * "The mutation destroyed the artifact" is the most important thing this
   * panel can say, and it is true whether or not a renderer exists. For a
   * structured record there is no image, but the record stopped parsing — and
   * that must not be reported as merely "no renderer".
   */
  const decodeLost = mutatedExecutionFailed(run);

  return (
    <div className="compare">
      <div className="btn-row" role="group" aria-label="Comparison mode">
        <div className="segmented" style={{ width: "100%" }}>
          {(["original", "mutated", "difference"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="segmented__option"
              aria-pressed={effectiveMode === option}
              disabled={!modeEnabled(option)}
              onClick={() => onMode(option)}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      {original || mutated ? (
        <>
          <div className="btn-row" role="group" aria-label="Magnification">
            <button
              type="button"
              className="btn btn--quiet"
              aria-pressed={zoomChoice === "fit"}
              onClick={() => setZoomChoice("fit")}
            >
              Fit
            </button>
            {ZOOMS.map((z) => (
              <button
                key={z}
                type="button"
                className="btn btn--quiet"
                aria-pressed={zoomChoice === z}
                onClick={() => setZoomChoice(z)}
              >
                {z}×
              </button>
            ))}
            <span style={{ flex: 1 }} />
            {GAINS.map((g) => (
              <button
                key={g}
                type="button"
                className="btn btn--quiet"
                aria-pressed={gain === g}
                onClick={() => setGain(g)}
                disabled={effectiveMode !== "difference"}
              >
                diff ×{g}
              </button>
            ))}
          </div>

          {effectiveMode === "original" && original ? (
            <ImagePlate image={original} zoom={zoom} caption="Original" note="Decoded from the unmodified bytes." />
          ) : null}
          {effectiveMode === "mutated" && mutated ? (
            <ImagePlate
              image={mutated}
              zoom={zoom}
              caption="Mutated"
              note={`Decoded after flipping bit ${run.mutation.bitOffset}.`}
            />
          ) : null}
          {effectiveMode === "difference" && difference && original && mutated ? (
            <DifferencePlate
              original={original}
              mutated={mutated}
              gain={gain}
              zoom={zoom}
            />
          ) : null}
        </>
      ) : (
        <div className="image-missing">
          <strong style={{ color: "var(--ink)" }}>No renderer for this format.</strong>
          <span>
            Bytes can be inspected and flipped, but there is nothing to draw. The byte-level delta
            below is the whole measurement.
          </span>
        </div>
      )}

      {decodeLost ? (
        <div className="state state--unsupported" style={{ padding: "var(--space-s) 0 0" }}>
          <p className="state__title">The mutated data no longer decodes</p>
          <div className="state__body">
            {run.mutatedExecution.message}
            {original
              ? " The original is shown above for reference; there is no mutated image to compare it against, so no difference view is offered."
              : " There is no renderer for this format, so no image is shown."}
          </div>
        </div>
      ) : render && render.pixelsChanged >= 0 && original && mutated ? (
        <p className="field__hint numeric">
          Pixels changed {render.pixelsChanged.toLocaleString("en-US")} of{" "}
          {render.pixelsTotal.toLocaleString("en-US")} · mean absolute error{" "}
          {render.meanAbsoluteError.toFixed(3)} · changed region{" "}
          {render.changedBounds
            ? `x${render.changedBounds.x} y${render.changedBounds.y} ${render.changedBounds.width}×${render.changedBounds.height}`
            : "none"}
        </p>
      ) : null}

      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">Byte-level delta between original and mutated data</caption>
          <thead>
            <tr>
              <th scope="col" className="num">
                Offset
              </th>
              <th scope="col">Original</th>
              <th scope="col">Mutated</th>
              <th scope="col">XOR</th>
              <th scope="col">Bit</th>
            </tr>
          </thead>
          <tbody>
            {run.measurement.changedByteOffsets.slice(0, 64).map((offset) => (
              <tr key={offset}>
                <td className="num">0x{offset.toString(16).toUpperCase().padStart(4, "0")}</td>
                <td>{byteToHex(run.source.bytes[offset]!)}</td>
                <td style={{ color: "var(--accent)" }}>{byteToHex(run.mutation.data[offset]!)}</td>
                <td>{byteToHex(run.source.bytes[offset]! ^ run.mutation.data[offset]!)}</td>
                <td>
                  {offset === run.mutation.byteIndex ? `bit ${run.mutation.bitInByte}` : "—"}
                </td>
              </tr>
            ))}
            {run.measurement.changedByteOffsets.length === 0 ? (
              <tr className="table__empty">
                <td colSpan={5}>No bytes differ.</td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}