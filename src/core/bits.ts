/**
 * Bit addressing.
 *
 * BIT FLIP LAB uses MSB-first (network / big-endian display) bit order,
 * matching the convention used when reading hexadecimal: the leftmost
 * character of "4D" is the high nibble, so the leftmost bit of "01001101"
 * is bit 7 of that byte. This is the order every address in the UI is
 * expressed in, and the order `bitOffset` is defined against.
 */

export const BITS_PER_BYTE = 8;
export const BYTE_OFFSET_MASK = 0xff;

/**
 * Decompose an absolute bit offset into byte index and in-byte index.
 *
 * The in-byte index counts from the MOST significant bit, so bit 0 of any
 * byte is its leftmost bit — the bit a reader sees first in the binary
 * column of the inspector.
 */
export function decomposeBit(bitOffset: number): { byteIndex: number; bitInByte: number } {
  const byteIndex = Math.floor(bitOffset / BITS_PER_BYTE);
  const bitInByte = BITS_PER_BYTE - 1 - (bitOffset % BITS_PER_BYTE);
  return { byteIndex, bitInByte };
}

/** Absolute bit offset for a byte index and in-byte index. Inverse of decomposeBit. */
export function composeBit(byteIndex: number, bitInByte: number): number {
  return byteIndex * BITS_PER_BYTE + (BITS_PER_BYTE - 1 - bitInByte);
}

/** Total addressable bits in a buffer of `byteLength` bytes. */
export function bitCapacity(byteLength: number): number {
  return byteLength * BITS_PER_BYTE;
}

/**
 * The in-byte bit index counted from the LEFT — the order bits appear in the
 * inspector's binary column. 0 is the leftmost (most significant) bit.
 *
 * `decomposeBit` returns the machine-facing shift index, which is counted from
 * the right. User-facing text must use this function instead, or the same bit
 * gets reported two different numbers.
 */
export function bitIndexFromLeft(bitInByte: number): number {
  return BITS_PER_BYTE - 1 - bitInByte;
}

/** Read a bit (0 | 1) at an absolute MSB-first offset. */
export function readBit(bytes: Uint8Array, bitOffset: number): 0 | 1 {
  const { byteIndex, bitInByte } = decomposeBit(bitOffset);
  const byte = bytes[byteIndex];
  if (byte === undefined) throw new RangeError(`readBit: offset ${bitOffset} out of range`);
  return ((byte >> bitInByte) & 1) as 0 | 1;
}

/**
 * Write a bit at an absolute MSB-first offset.
 * Mutates `target` in place and returns it, for call-site clarity.
 */
export function writeBit(target: Uint8Array, bitOffset: number, value: 0 | 1): Uint8Array {
  const { byteIndex, bitInByte } = decomposeBit(bitOffset);
  const byte = target[byteIndex];
  if (byte === undefined) throw new RangeError(`writeBit: offset ${bitOffset} out of range`);
  const mask = 1 << bitInByte;
  target[byteIndex] = value === 1 ? byte | mask : byte & ~mask & BYTE_OFFSET_MASK;
  return target;
}

/** Format a byte as a 8-character MSB-first binary string. */
export function byteToBinary(value: number): string {
  return (value & BYTE_OFFSET_MASK)
    .toString(2)
    .padStart(BITS_PER_BYTE, "0");
}

/** Parse an 8-character binary string (MSB-first) to a byte. */
export function binaryToByte(bits: string): number {
  if (!/^[01]{8}$/.test(bits)) throw new Error(`binaryToByte: invalid binary string "${bits}"`);
  return Number.parseInt(bits, 2);
}

/** Zero-padded 8-digit lowercase hex, the inspector's canonical form. */
export function byteToHex(value: number): string {
  return (value & BYTE_OFFSET_MASK).toString(16).padStart(2, "0").toUpperCase();
}

/** Width in hex digits required to address the last byte of `byteLength`. */
export function hexAddressDigits(byteLength: number): number {
  if (byteLength <= 0) return 4;
  return Math.max(4, Math.ceil(Math.log2(byteLength + 1) / 4));
}

/** Format a byte offset as a fixed-width 0x address. */
export function formatAddress(byteIndex: number, byteLength = Number.MAX_SAFE_INTEGER): string {
  return `0x${byteIndex.toString(16).toUpperCase().padStart(hexAddressDigits(byteLength), "0")}`;
}