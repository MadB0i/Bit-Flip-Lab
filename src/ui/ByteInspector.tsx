/**
 * The byte inspector.
 *
 * A virtualized hex-and-bit grid. Only the visible rows are in the DOM, so a
 * multi-megabyte buffer costs the same as a 76-byte one. Every bit is a real
 * `<button>`: there is no canvas, no click-handling div, and nothing that only
 * a mouse can reach.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { byteToHex, formatAddress, hexAddressDigits } from "../core/bits";

/**
 * Fixed row pitch. Must equal `--byte-row-h` in tokens.css: the rows are
 * absolutely positioned and virtualised against this value, so any content
 * taller than it would overlap the next row.
 */
const DEFAULT_ROW_HEIGHT = 30;
const OVERSCAN = 6;

export interface ByteInspectorProps {
  readonly bytes: Uint8Array;
  readonly mutatedBytes: Uint8Array | null;
  readonly flippedBit: number | null;
  readonly selectedBit: number | null;
  readonly bytesPerRow: number;
  readonly onSelect: (bitOffset: number) => void;
}

export function ByteInspector({
  bytes,
  mutatedBytes,
  flippedBit,
  selectedBit,
  bytesPerRow,
  onSelect,
}: ByteInspectorProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(DEFAULT_ROW_HEIGHT * 8);
  /**
   * The row pitch is measured from the DOM rather than duplicated here. The
   * rows are absolutely positioned, so a stale constant would silently overlap
   * them — and the pitch legitimately differs on touch, where each bit needs
   * a 24px target instead of 8.
   */
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);

  const totalRows = Math.max(1, Math.ceil(bytes.length / bytesPerRow));
  const addressDigits = hexAddressDigits(bytes.length);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setViewportHeight(entry.contentRect.height);
    });
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, []);

  // Re-measure the pitch whenever the row content or the column count changes.
  useLayoutEffect(() => {
    const first = scrollRef.current?.querySelector<HTMLElement>(".inspector__row");
    if (!first) return;
    const measured = first.offsetHeight;
    if (measured > 0 && measured !== rowHeight) setRowHeight(measured);
  }, [bytesPerRow, bytes.length, rowHeight]);

  const { firstRow, lastRow } = useMemo(() => {
    const first = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
    const last = Math.min(totalRows, Math.ceil((scrollTop + viewportHeight) / rowHeight) + OVERSCAN);
    return { firstRow: first, lastRow: Math.max(first + 1, last) };
  }, [scrollTop, viewportHeight, totalRows, rowHeight]);

  const scrollToBit = useCallback(
    (bitOffset: number) => {
      const element = scrollRef.current;
      if (!element) return;
      const byteIndex = Math.floor(bitOffset / 8);
      const row = Math.floor(byteIndex / bytesPerRow);
      const target = row * rowHeight;
      if (target < element.scrollTop || target > element.scrollTop + element.clientHeight - rowHeight) {
        element.scrollTop = Math.max(0, target - element.clientHeight / 2);
      }
    },
    [bytesPerRow, rowHeight],
  );

  // Keep the selected byte in view when selection moves from elsewhere.
  useEffect(() => {
    if (selectedBit !== null) scrollToBit(selectedBit);
  }, [selectedBit, scrollToBit]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, bitOffset: number) => {
    const byteIndex = Math.floor(bitOffset / 8);
    const lastBit = bytes.length * 8 - 1;
    let next: number | null = null;

    switch (event.key) {
      case "ArrowLeft":
        next = bitOffset === 0 ? null : bitOffset - 1;
        break;
      case "ArrowRight":
        next = bitOffset === lastBit ? null : bitOffset + 1;
        break;
      case "ArrowUp":
        next = bitOffset - bytesPerRow * 8 >= 0 ? bitOffset - bytesPerRow * 8 : null;
        break;
      case "ArrowDown":
        next = bitOffset + bytesPerRow * 8 <= lastBit ? bitOffset + bytesPerRow * 8 : null;
        break;
      case "Home": {
        // First bit of the row, not of the byte: in a grid, Home and End are
        // row-scoped.
        const rowStartByte = byteIndex - (byteIndex % bytesPerRow);
        next = rowStartByte * 8;
        break;
      }
      case "End": {
        const rowStartByte = byteIndex - (byteIndex % bytesPerRow);
        next = Math.min(lastBit, rowStartByte * 8 + bytesPerRow * 8 - 1);
        break;
      }
      case "PageUp":
        next = bitOffset - bytesPerRow * 8 * 10 >= 0 ? bitOffset - bytesPerRow * 8 * 10 : null;
        break;
      case "PageDown":
        next = bitOffset + bytesPerRow * 8 * 10 <= lastBit ? bitOffset + bytesPerRow * 8 * 10 : null;
        break;
      default:
        return;
    }

    if (next === null) return;
    event.preventDefault();
    onSelect(next);
    requestAnimationFrame(() => focusBit(next));
  };

  const focusBit = (bitOffset: number) => {
    const element = scrollRef.current?.querySelector<HTMLButtonElement>(`[data-bit="${bitOffset}"]`);
    element?.focus();
  };
  /**
   * Roving tabindex. The grid is ONE tab stop, with the arrow keys moving
   * between bits inside it. Tabbing through every bit would make the control
   * unreachable — 528 tab stops for one 76-byte record.
   */
  const activeBit = selectedBit ?? flippedBit ?? 0;

  const rows: React.ReactNode[] = [];
  for (let row = firstRow; row < lastRow; row++) {
    const startByte = row * bytesPerRow;
    if (startByte >= bytes.length) break;

    const bytesInRow: React.ReactNode[] = [];
    for (let i = 0; i < bytesPerRow; i++) {
      const byteIndex = startByte + i;
      if (byteIndex >= bytes.length) break;

      const value = bytes[byteIndex]!;
      const mutated = mutatedBytes?.[byteIndex];
      const changed = mutated !== undefined && mutated !== value;
      const baseBit = byteIndex * 8;
      const isSelectedByte =
        selectedBit !== null && Math.floor(selectedBit / 8) === byteIndex;

      const bits: React.ReactNode[] = [];
      for (let b = 0; b < 8; b++) {
        const bitOffset = baseBit + b;
        const set = ((value >> (7 - b)) & 1) === 1;
        bits.push(
          <button
            key={b}
            type="button"
            className="bit"
            data-bit={bitOffset}
            data-set={set}
            data-flipped={flippedBit === bitOffset}
            aria-pressed={selectedBit === bitOffset}
            tabIndex={bitOffset === activeBit ? 0 : -1}
            aria-label={`Bit ${bitOffset}, ${set ? "1" : "0"}, byte ${byteIndex} at address ${formatAddress(byteIndex, bytes.length)}`}
            onClick={() => onSelect(bitOffset)}
            onKeyDown={(event) => onKeyDown(event, bitOffset)}
          >
            {set ? "1" : "0"}
          </button>,
        );
      }

      bytesInRow.push(
        <div
          key={i}
          className={`byte${changed ? " byte--changed" : ""}${isSelectedByte ? " byte--selected" : ""}`}
        >
          <span className="byte__hex" aria-hidden="true">
            {byteToHex(value)}
          </span>
          <div className="byte__bits">{bits}</div>
        </div>,
      );
    }

    rows.push(
      <div
        key={row}
        className="inspector__row"
        style={{ position: "absolute", top: row * rowHeight, left: 0, right: 0 }}
        data-row={row}
      >
        <span className="inspector__addr" aria-hidden="true">
          {formatAddress(startByte, bytes.length).padStart(addressDigits + 2, " ")}
        </span>
        <div className="inspector__bytes">{bytesInRow}</div>
      </div>,
    );
  }

  return (
    <div className="inspector" ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
      {/*
        A plain labelled group, not role="grid". A grid role would oblige the
        rows to contain gridcell children and the address gutter to be a
        rowheader; half-correct grid semantics misinform assistive technology,
        which is worse than none. Each bit is a real button with a full name.
      */}
      <div
        role="group"
        aria-label={`Byte inspector: ${bytes.length} bytes, ${(bytes.length * 8).toLocaleString("en-US")} addressable bits, ${bytesPerRow} per row. This grid is a single tab stop; use the arrow keys to move between bits and Enter to flip one.`}
        style={{ height: totalRows * rowHeight, position: "relative" }}
      >
        {rows}
      </div>
    </div>
  );
}