/**
 * Structure map.
 *
 * The adapter's named byte regions drawn to scale, so that a bit position can
 * be read against the structure that gives it meaning. Clicking a region
 * selects its first bit — the map is a navigation control, not decoration.
 */

import type { StructureRegion } from "../core/pipeline";

const ROLE_LABEL: Record<StructureRegion["role"], string> = {
  magic: "magic",
  structure: "structure",
  length: "length",
  payload: "payload",
  integrity: "integrity",
  pixels: "pixels",
  opaque: "opaque",
};

export function StructureMap({
  regions,
  byteLength,
  selectedBit,
  onSelect,
}: {
  regions: readonly StructureRegion[];
  byteLength: number;
  selectedBit: number | null;
  onSelect: (bitOffset: number) => void;
}) {
  if (regions.length === 0) return null;

  const selectedByte = selectedBit === null ? null : Math.floor(selectedBit / 8);
  /** Legend by role, deduplicated: several regions can share a role. */
  const structuralRoles = [
    ...new Set(
      regions
        .filter((r) => r.role === "magic" || r.role === "length" || r.role === "integrity")
        .map((r) => r.role),
    ),
  ];

  return (
    <div className="sensitivity">
      <div
        style={{ display: "flex", gap: 1, height: "1.5rem", background: "var(--line)" }}
        role="group"
        aria-label="Structure regions, drawn to scale. Select a region to jump to its first bit."
      >
        {regions.map((region) => {
          const width = (Math.min(region.lengthBytes, byteLength - region.startByte) / byteLength) * 100;
          const isSelected =
            selectedByte !== null &&
            selectedByte >= region.startByte &&
            selectedByte < region.startByte + region.lengthBytes;
          // Segments narrower than this cannot render a label legibly.
          const label = width > 6 ? ROLE_LABEL[region.role] : "";
          return (
            <button
              key={`${region.name}-${region.startByte}`}
              type="button"
              className="region-bar__seg"
              data-role={region.role}
              title={`${region.name} — bytes ${region.startByte}–${region.startByte + region.lengthBytes - 1}`}
              aria-label={`${region.name}, ${ROLE_LABEL[region.role]}, ${region.lengthBytes} bytes from offset ${region.startByte}. Select its first bit.`}
              aria-pressed={isSelected}
              onClick={() => onSelect(region.startByte * 8)}
              style={{
                width: `${width}%`,
                // 24px minimum target (WCAG 2.2 SC 2.5.8). Eight regions at
                // 24px still fit the rail, and an over-wide segment keeps its
                // share of the row.
                minWidth: "1.5rem",
                background: isSelected ? "var(--surface-3)" : "var(--surface)",
                color: isSelected ? "var(--accent)" : undefined,
                borderTopWidth: 2,
                fontSize: label === "" ? 0 : undefined,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      <p className="sensitivity__axis">
        <span>0x00</span>
        <span className="numeric">{byteLength} bytes</span>
      </p>

      {/* The rail is too narrow for labels inside every segment, so the region
          inventory is stated explicitly rather than left to hover. */}
      <p className="field__hint" style={{ marginTop: "var(--space-3xs)" }}>
        {regions
          .map((r) => `${r.name} ${r.lengthBytes.toLocaleString("en-US")} B`)
          .join(" · ")}
      </p>

      {structuralRoles.length > 0 ? (
        <p className="severity-legend" style={{ marginTop: "var(--space-3xs)" }}>
          <span style={{ color: "var(--ink-3)" }}>Marked:</span>
          {structuralRoles.map((role) => (
            <span key={role}>
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: "0.5rem",
                  height: 2,
                  background: "var(--accent)",
                  marginRight: "0.3rem",
                  verticalAlign: "middle",
                }}
              />
              {ROLE_LABEL[role]}
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
