/**
 * BLAB — the structured byte sequence used as a sample experiment.
 *
 * A real, self-describing binary record with a genuine integrity check, so
 * that "is this structure still valid?" is a measurement and not an
 * assertion. Layout (all multi-byte fields big-endian):
 *
 *   0x00  4 B   magic          'B' 'L' 'A' 'B'
 *   0x04  2 B   version        u16
 *   0x06  4 B   recordLength   u32   total byte length, must equal file size
 *   0x0A  4 B   sampleRateHz   u32
 *   0x0E 24 B   label          ASCII, NUL-padded
 *   0x26  2 B   sampleCount    u16   must be ≤ SAMPLE_CAPACITY
 *   0x28 32 B   samples        u16 × 16
 *   0x48  4 B   crc32          u32   CRC-32 over bytes 0x00–0x47
 *   ─────────────
 *   0x4C 76 B total
 */

import { crc32 } from "./crc32";

/** The magic as ASCII, used both for writing and for the hex failure message. */
export const BLAB_MAGIC = "BLAB";

/** True when `bytes` starts with the BLAB magic. The single definition of it. */
export function hasBlabMagic(bytes: Uint8Array): boolean {
  if (bytes.length < BLAB_MAGIC.length) return false;
  for (let i = 0; i < BLAB_MAGIC.length; i++) {
    if (bytes[i] !== BLAB_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}
export const SAMPLE_CAPACITY = 16;
export const RECORD_LENGTH = 76;
export const CRC_COVERAGE = 72;

export const OFF_MAGIC = 0;
export const OFF_VERSION = 4;
export const OFF_RECORD_LENGTH = 6;
export const OFF_SAMPLE_RATE = 10;
export const OFF_LABEL = 14;
export const OFF_SAMPLE_COUNT = 38;
export const OFF_SAMPLES = 40;
export const OFF_CRC = 72;

export interface BlabRecord {
  readonly version: number;
  readonly recordLength: number;
  readonly sampleRateHz: number;
  readonly label: string;
  readonly sampleCount: number;
  readonly samples: readonly number[];
  readonly crc32: number;
}

export interface BlabParse {
  /** Structure present and internally consistent enough to read fields. */
  readonly parsed: boolean;
  readonly record: BlabRecord | null;
  /** Located validation failures, each naming the field and the reason. */
  readonly failures: readonly string[];
  readonly structurallyValid: boolean;
}

export function decodeBlab(bytes: Uint8Array): BlabParse {
  const failures: string[] = [];

  if (bytes.length !== RECORD_LENGTH) {
    failures.push(`Record is ${bytes.length} bytes; BLAB v1 requires exactly ${RECORD_LENGTH}`);
    return { parsed: false, record: null, failures, structurallyValid: false };
  }
  if (!hasBlabMagic(bytes)) {
    failures.push(
      `Magic at 0x00 is 0x${[bytes[0]!, bytes[1]!, bytes[2]!, bytes[3]!]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()}; expected ${[...BLAB_MAGIC]
        .map((c) => c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()} ('${BLAB_MAGIC}')`,
    );
    return { parsed: false, record: null, failures, structurallyValid: false };
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(OFF_VERSION);
  const recordLength = view.getUint32(OFF_RECORD_LENGTH);
  const sampleRateHz = view.getUint32(OFF_SAMPLE_RATE);
  const label = readAscii(bytes, OFF_LABEL, 24);
  const sampleCount = view.getUint16(OFF_SAMPLE_COUNT);
  const storedCrc = view.getUint32(OFF_CRC);

  if (recordLength !== bytes.length) {
    failures.push(
      `Length field at 0x06 declares ${recordLength} bytes; file contains ${bytes.length}`,
    );
  }
  if (sampleCount > SAMPLE_CAPACITY) {
    failures.push(`Sample count at 0x26 is ${sampleCount}; capacity is ${SAMPLE_CAPACITY}`);
  }

  const samples: number[] = [];
  for (let i = 0; i < SAMPLE_CAPACITY; i++) samples.push(view.getUint16(OFF_SAMPLES + i * 2));

  const computedCrc = crc32(bytes.subarray(0, CRC_COVERAGE));
  if (computedCrc !== storedCrc) {
    failures.push(
      `CRC-32 at 0x48 is 0x${storedCrc.toString(16).padStart(8, "0").toUpperCase()}; ` +
        `computed 0x${computedCrc.toString(16).padStart(8, "0").toUpperCase()}`,
    );
  }

  const record: BlabRecord = {
    version,
    recordLength,
    sampleRateHz,
    label,
    sampleCount,
    samples: samples.slice(0, Math.min(sampleCount, SAMPLE_CAPACITY)),
    crc32: storedCrc,
  };

  return { parsed: true, record, failures, structurallyValid: failures.length === 0 };
}

function readAscii(bytes: Uint8Array, at: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    const c = bytes[at + i]!;
    if (c === 0) break;
    out += String.fromCharCode(c);
  }
  return out;
}

/** Build a valid BLAB record from its fields. */
export function encodeBlab(fields: Omit<BlabRecord, "recordLength" | "crc32">): Uint8Array {
  const out = new Uint8Array(RECORD_LENGTH);
  out[0] = 0x42;
  out[1] = 0x4c;
  out[2] = 0x41;
  out[3] = 0x42;
  const view = new DataView(out.buffer);
  view.setUint16(OFF_VERSION, fields.version & 0xffff);
  view.setUint32(OFF_RECORD_LENGTH, RECORD_LENGTH);
  view.setUint32(OFF_SAMPLE_RATE, fields.sampleRateHz >>> 0);
  for (let i = 0; i < 24; i++) {
    out[OFF_LABEL + i] = i < fields.label.length ? fields.label.charCodeAt(i) & 0x7f : 0;
  }
  const count = Math.min(SAMPLE_CAPACITY, fields.samples.length);
  view.setUint16(OFF_SAMPLE_COUNT, count);
  for (let i = 0; i < SAMPLE_CAPACITY; i++) {
    view.setUint16(OFF_SAMPLES + i * 2, (fields.samples[i] ?? 0) & 0xffff);
  }
  view.setUint32(OFF_CRC, crc32(out.subarray(0, CRC_COVERAGE)));
  return out;
}