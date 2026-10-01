/**
 * The flip event — the memorable moment.
 *
 * Two things happen here and nowhere else:
 *
 *   1. The single changed bit is isolated, inverted in amber, inside its byte.
 *   2. A measurement bar travels across five stages. A stage lights only when
 *      its measurement actually exists — a format with no decoder leaves FILE
 *      dark, because nothing was decoded and nothing is claimed.
 */

import { byteToHex, byteToBinary, bitIndexFromLeft, formatAddress } from "../core/bits";
import { SEVERITY_LABEL } from "../core/classify";
import type { ExperimentRun } from "../core/pipeline";

type StageState = "measured" | "unmeasured";

function Stage({
  name,
  value,
  state,
  dim = false,
}: {
  name: string;
  value: string;
  state: StageState;
  dim?: boolean;
}) {
  return (
    <div className="causal__stage" data-state={state}>
      <span className="causal__fill" aria-hidden="true" />
      <span className="causal__name">{name}</span>
      <span className={`causal__value${dim ? " causal__value--dim" : ""} numeric`}>{value}</span>
    </div>
  );
}

export function FlipEvent({ run }: { run: ExperimentRun }) {
  const { mutation, measurement, comparison } = run;
  const before = byteToBinary(mutation.originalByte);
  const after = byteToBinary(mutation.mutatedByte);
  /**
   * Both strings are MSB-first, so the array index of the changed bit is the
   * bit's position from the left. `mutation.bitInByte` is the machine-facing
   * shift index counted from the right; using it directly would highlight the
   * wrong cell.
   */
  const changedIndex = bitIndexFromLeft(mutation.bitInByte);
  const structureMeasured = run.mutatedExecution.structureVerdict !== "unknown";
  const decodeMeasured = run.mutatedExecution.verdict !== "not-applicable";

  const structureValue = structureMeasured
    ? run.mutatedExecution.structureVerdict === "valid"
      ? "valid"
      : `${run.mutatedExecution.structureFailures.length} failed`
    : "no decoder";

  const decodeValue = decodeMeasured
    ? run.mutatedExecution.verdict === "ok"
      ? "decoded"
      : "decode failed"
    : "not attempted";

  const render = measurement.render;
  const resultValue =
    render && render.pixelsChanged >= 0
      ? `${render.pixelsChanged.toLocaleString("en-US")} px changed`
      : `${measurement.bytesChanged} byte${measurement.bytesChanged === 1 ? "" : "s"} changed`;

  return (
    <div className="flip">
      <div className="flip__stage">
        <span className="flip__label" aria-hidden="true">
          Original
        </span>
        <div className="bitfield" aria-hidden="true">
          {before.split("").map((digit, index) => {
            const changed = index === changedIndex;
            return (
              <span
                key={index}
                className={`bitfield__bit${changed ? " bitfield__bit--changed bitfield__bit--struck" : ""}`}
              >
                {digit}
              </span>
            );
          })}
        </div>
      </div>

      <div className="flip__stage">
        <span className="flip__label" aria-hidden="true">
          Mutated
        </span>
        <div className="bitfield" aria-hidden="true">
          {after.split("").map((digit, index) => {
            const changed = index === changedIndex;
            return (
              <span key={index} className={`bitfield__bit${changed ? " bitfield__bit--changed" : ""}`}>
                {digit}
              </span>
            );
          })}
        </div>
      </div>

      <p className="sr-only">
        Byte {formatAddress(mutation.byteIndex, run.source.bytes.length)} changed from{" "}
        {byteToHex(mutation.originalByte)} to {byteToHex(mutation.mutatedByte)}. Bit{" "}
        {mutation.bitOffset} — the {ordinal(changedIndex)} bit from the left — changed from{" "}
        {mutation.originalBit} to {mutation.mutatedBit}.
      </p>

      <div className="causal">
        <Stage
          name="Bit"
          state="measured"
          value={`${mutation.originalBit} → ${mutation.mutatedBit}`}
        />
        <Stage
          name="Byte"
          state="measured"
          value={`${byteToHex(mutation.originalByte)} → ${byteToHex(mutation.mutatedByte)}`}
        />
        <Stage
          name="Block"
          state={structureMeasured ? "measured" : "unmeasured"}
          dim={!structureMeasured}
          value={structureValue}
        />
        <Stage
          name="File"
          state={decodeMeasured ? "measured" : "unmeasured"}
          dim={!decodeMeasured}
          value={decodeValue}
        />
        <Stage
          name="Result"
          state="measured"
          value={`${SEVERITY_LABEL[comparison.severity]} · ${resultValue}`}
        />
      </div>
    </div>
  );
}

function ordinal(n: number): string {
  const names = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth"];
  return names[n] ?? `${n + 1}`;
}