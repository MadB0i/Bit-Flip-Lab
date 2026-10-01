/**
 * Byte bit picker.
 *
 * The inspector is a dense instrument: a 9px bit cell is precise under a
 * mouse and unusable under a finger. This control is the equivalent large-
 * target path required for every bit of the currently focused byte — eight
 * full-size buttons, one per bit, reachable by keyboard and by touch.
 *
 * It is also simply faster than the grid for repeated work on one byte.
 */

import { byteToHex, formatAddress } from "../core/bits";
import { useLabState } from "../state/LabProvider";
import type { LabActions } from "../state/LabProvider";

export function ByteBitPicker({ actions }: { actions: LabActions }) {
  const { source, selectedBit, run } = useLabState();

  if (!source) {
    return (
      <p className="field__hint">
        Select a byte in the inspector to work on its bits here.
      </p>
    );
  }

  // Follow the selection; fall back to the mutated byte so the control still
  // has something to act on after a reset.
  const anchor = selectedBit ?? run?.mutation.bitOffset ?? 0;
  const byteIndex = Math.min(Math.floor(anchor / 8), source.bytes.length - 1);
  const value = source.bytes[byteIndex]!;
  const base = byteIndex * 8;
  const flipped = run?.mutation.byteIndex === byteIndex ? run.mutation.bitOffset : null;

  return (
    <div className="bit-picker">
      <p className="bit-picker__caption numeric">
        Byte {formatAddress(byteIndex, source.bytes.length)} · {byteToHex(value)} · bit{" "}
        {byteIndex * 8}–{byteIndex * 8 + 7}
      </p>
      <div className="bit-picker__grid" role="group" aria-label={`Bits of byte ${byteToHex(value)} at address ${formatAddress(byteIndex, source.bytes.length)}`}>
        {Array.from({ length: 8 }, (_, index) => {
          const bitOffset = base + index;
          const set = ((value >> (7 - index)) & 1) === 1;
          const isSelected = selectedBit === bitOffset;
          const isFlipped = flipped === bitOffset;
          return (
            <button
              key={index}
              type="button"
              className="bit-picker__bit"
              aria-pressed={isSelected}
              aria-label={`Bit ${index} from the left of byte ${byteToHex(value)} at address ${formatAddress(byteIndex, source.bytes.length)}. Currently ${set ? 1 : 0}. Flips it.`}
              onClick={() => void actions.selectBit(bitOffset)}
            >
              <span className="bit-picker__index">{index}</span>
              <span className="bit-picker__value">{set ? 1 : 0}</span>
              {isFlipped ? <span className="bit-picker__marker">flipped</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
