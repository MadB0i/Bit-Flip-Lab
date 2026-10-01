/**
 * CRC-32 (IEEE 802.3 / zlib polynomial 0xEDB88320, reflected).
 *
 * Used by the structured sample format to carry a real integrity check, so
 * that "does the structure still validate?" is a measurement rather than an
 * assertion. Also used by the PNG adapter to verify each chunk CRC after a
 * mutation, which is how the sensitivity map separates structural damage
 * from payload damage.
 */

const TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c >>> 0;
  }
  return table;
})();

export function crc32(data: Uint8Array, seed = 0): number {
  let crc = (seed ^ 0xffffffff) >>> 0;
  for (let i = 0; i < data.length; i++) {
    crc = (TABLE[(crc ^ data[i]!) & 0xff]! ^ (crc >>> 8)) >>> 0;
  }
  return (crc ^ 0xffffffff) >>> 0;
}