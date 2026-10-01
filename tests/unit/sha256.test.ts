import { describe, expect, it } from "vitest";
import { hashHex, sha256, toHex } from "@/core/sha256";

const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("SHA-256 against FIPS 180-4 vectors", () => {
  it("hashes the empty message", () => {
    expect(
      hashHex(new Uint8Array(0)),
    ).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });

  it("hashes 'abc'", () => {
    expect(hashHex(ascii("abc"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes the 448-bit boundary message", () => {
    expect(
      hashHex(ascii("abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq")),
    ).toBe("248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1");
  });

  it("hashes the 896-bit NIST message", () => {
    expect(
      hashHex(ascii("abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu")),
    ).toBe("cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1");
  });

  it("hashes one million 'a' characters", () => {
    expect(hashHex(ascii("a".repeat(1_000_000)))).toBe(
      "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0",
    );
  });
});

describe("SHA-256 block boundaries", () => {
  // Lengths 55/56/57 and 119/120 straddle the point where the length field no
  // longer fits in the final block, which is where padding bugs live.
  it("produces 64 distinct hex characters across every boundary", () => {
    for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 121, 128]) {
      expect(hashHex(new Uint8Array(n))).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("changes the digest when a single bit changes", () => {
    const a = new Uint8Array(64);
    const b = new Uint8Array(64);
    b[0] = 1;
    expect(hashHex(a)).not.toBe(hashHex(b));
  });

  it("is stable across repeated calls", () => {
    const data = new Uint8Array(1000).map((_, i) => i & 0xff);
    expect(hashHex(data)).toBe(hashHex(data));
  });

  it("does not leave stale bytes in a reused digest buffer", () => {
    const out = new Uint8Array(32);
    const first = sha256(ascii("abc"), out).hex;
    const second = sha256(ascii("abc"), out).hex;
    expect(second).toBe(first);
    expect(sha256(ascii(""), new Uint8Array(32)).hex).not.toBe(first);
  });
});

describe("toHex", () => {
  it("renders zero-padded lowercase pairs", () => {
    expect(toHex(new Uint8Array([0, 1, 15, 16, 255]))).toBe("00010f10ff");
  });
});