/**
 * The mutation engine.
 *
 * Every function here is pure and deterministic: the same source bytes and
 * the same bit offsets always produce byte-identical output, on any engine,
 * in any thread. Nothing in this module knows about React, the DOM, or files.
 */

import { bitCapacity, decomposeBit, readBit, writeBit } from "./bits";

export class MutationError extends Error {
  readonly code: MutationErrorCode;
  constructor(code: MutationErrorCode, message: string) {
    super(message);
    this.name = "MutationError";
    this.code = code;
  }
}

export type MutationErrorCode = "EMPTY_INPUT" | "OUT_OF_RANGE" | "INVALID_BIT" | "DUPLICATE_BIT";

export interface FlipResult {
  /** A new buffer. The source buffer is never mutated. */
  readonly data: Uint8Array;
  readonly bitOffset: number;
  readonly byteIndex: number;
  readonly bitInByte: number;
  readonly originalByte: number;
  readonly mutatedByte: number;
  readonly originalBit: 0 | 1;
  readonly mutatedBit: 0 | 1;
}

/** Structural validation of a single bit offset against a buffer. */
function validateBitOffset(data: Uint8Array, bitOffset: number): void {
  if (data.length === 0) {
    throw new MutationError("EMPTY_INPUT", "Cannot flip a bit in an empty buffer.");
  }
  if (!Number.isInteger(bitOffset) || bitOffset < 0 || bitOffset >= bitCapacity(data.length)) {
    throw new MutationError(
      "OUT_OF_RANGE",
      `Bit ${bitOffset} is outside the addressable range 0–${bitCapacity(data.length) - 1}.`,
    );
  }
}

/**
 * Flip exactly one bit, returning a new buffer.
 * The input buffer is treated as immutable.
 */
export function flipBit(data: Uint8Array, bitOffset: number): FlipResult {
  validateBitOffset(data, bitOffset);

  const { byteIndex, bitInByte } = decomposeBit(bitOffset);
  const originalBit = readBit(data, bitOffset);
  const originalByte = data[byteIndex]!;

  const out = new Uint8Array(data.length);
  out.set(data);
  writeBit(out, bitOffset, originalBit === 1 ? 0 : 1);

  const mutatedByte = out[byteIndex]!;

  return {
    data: out,
    bitOffset,
    byteIndex,
    bitInByte,
    originalByte,
    mutatedByte,
    originalBit,
    mutatedBit: originalBit === 1 ? 0 : 1,
  };
}

/**
 * Flip a set of bits in one pass, returning a new buffer.
 * Offsets may be supplied in any order; the result is order-independent.
 */
export function flipBits(data: Uint8Array, bitOffsets: readonly number[]): FlipResultSet {
  if (data.length === 0) {
    throw new MutationError("EMPTY_INPUT", "Cannot flip a bit in an empty buffer.");
  }

  const seen = new Set<number>();
  for (const offset of bitOffsets) {
    validateBitOffset(data, offset);
    if (seen.has(offset)) {
      throw new MutationError("DUPLICATE_BIT", `Bit ${offset} was listed more than once.`);
    }
    seen.add(offset);
  }

  const out = new Uint8Array(data.length);
  out.set(data);

  const changes: FlipResult[] = [];
  for (const offset of bitOffsets) {
    const single = flipBitInPlace(out, offset);
    changes.push(single);
  }

  return { data: out, changes };
}

function flipBitInPlace(buffer: Uint8Array, bitOffset: number): FlipResult {
  const { byteIndex, bitInByte } = decomposeBit(bitOffset);
  const originalBit = readBit(buffer, bitOffset);
  const originalByte = buffer[byteIndex]!;
  writeBit(buffer, bitOffset, originalBit === 1 ? 0 : 1);
  return {
    data: buffer,
    bitOffset,
    byteIndex,
    bitInByte,
    originalByte,
    mutatedByte: buffer[byteIndex]!,
    originalBit,
    mutatedBit: originalBit === 1 ? 0 : 1,
  };
}

export interface FlipResultSet {
  readonly data: Uint8Array;
  readonly changes: readonly FlipResult[];
}

/** Count of differing bytes between two buffers. */
export function countDifferingBytes(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return -1;
  let n = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++;
  return n;
}