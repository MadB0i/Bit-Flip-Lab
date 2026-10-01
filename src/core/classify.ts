/**
 * Severity classification.
 *
 * The single place where a measurement becomes a verdict. The rule that fired
 * is carried in `rationale` and shown to the user verbatim — a severity
 * without a stated rule is an opinion, and BIT FLIP LAB does not have opinions.
 */

import type { Comparison, Execution, Measurement, Severity } from "./pipeline";

export const SEVERITY_ORDER: readonly Severity[] = [
  "critical",
  "major",
  "minor",
  "negligible",
  "unclassified",
];

export const SEVERITY_LABEL: Readonly<Record<Severity, string>> = {
  critical: "Critical",
  major: "Major",
  minor: "Minor",
  negligible: "Negligible",
  unclassified: "Unclassified",
};

/**
 * A shape that means the same thing in every severity encoding, so that colour
 * is never the only signal. Each level has a distinct glyph as well as a
 * distinct colour.
 */
export const SEVERITY_GLYPH: Readonly<Record<Severity, string>> = {
  critical: "✖", // ✖
  major: "▲", // ▲
  minor: "◆", // ◆
  negligible: "·", // ·
  unclassified: "?", // ?
};

export const SEVERITY_TOKEN: Readonly<Record<Severity, string>> = {
  critical: "var(--sev-critical)",
  major: "var(--sev-major)",
  minor: "var(--sev-minor)",
  negligible: "var(--sev-stable)",
  unclassified: "var(--ink-3)",
};

export function classify(
  before: Execution,
  after: Execution,
  measurement: Measurement,
): Comparison {
  const bytesChanged = measurement.bytesChanged;

  // Rule 1 — the artifact stopped being readable at all.
  if (after.verdict === "failed") {
    return {
      severity: "critical",
      rationale:
        before.verdict === "ok"
          ? "The decoded output failed on the mutated bytes but succeeded on the original. Measured by re-decoding the mutated buffer."
          : "The mutated bytes could not be decoded.",
      consequenceScore: 1,
    };
  }

  // Rule 2 — a structural integrity check failed, but decoding survived.
  if (after.structureVerdict === "invalid") {
    const count = after.structureFailures.length;
    return {
      severity: "major",
      rationale: `${count} structural check${count === 1 ? "" : "s"} failed while the buffer still decodes. Measured: ${after.structureFailures.join("; ")}`,
      consequenceScore: 0.75,
    };
  }

  // Rule 3 — no decoder could claim this format, so nothing can be asserted.
  if (after.verdict === "not-applicable" && after.structureVerdict === "unknown") {
    return {
      severity: "unclassified",
      rationale: `${bytesChanged} byte${bytesChanged === 1 ? "" : "s"} differ, but this format has no decoder, so the consequence cannot be classified. Only the byte-level facts below are measured.`,
      consequenceScore: 0.5,
    };
  }

  // Rule 4 — structure held, a decoded field changed.
  const changedSemantics = measurement.semantics.filter((s) => s.changed);
  if (changedSemantics.length > 0) {
    const first = changedSemantics[0]!;
    return {
      severity: "minor",
      rationale: `Structure validated. ${changedSemantics.length} decoded field${changedSemantics.length === 1 ? "" : "s"} changed, starting with ${first.label}: ${first.before} → ${first.after}.`,
      consequenceScore: 0.4,
    };
  }

  // Rule 5 — structure held, nothing decoded changed.
  if (measurement.render && measurement.render.pixelsChanged === 0) {
    return {
      severity: "negligible",
      rationale: `All ${measurement.render.pixelsTotal} rendered pixels are identical and every structural check passes. The bytes differ; nothing observable does.`,
      consequenceScore: 0.1,
    };
  }

  return {
    severity: "negligible",
    rationale:
      "All structural checks pass and no decoded field value changed. The raw bytes differ, but no decoded property does.",
    consequenceScore: 0.15,
  };
}