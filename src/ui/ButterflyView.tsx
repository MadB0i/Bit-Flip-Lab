/**
 * Butterfly mode.
 *
 * A bounded systematic sweep: the same single-bit mutation applied to many
 * positions, each one measured. The sensitivity map plots those measurements
 * directly — every cell is a row of the results table below it, and the
 * legend states the rule that produced each colour.
 */

import { useEffect, useRef } from "react";
import { BUTTERFLY_BUDGETS, type ButterflyResult } from "../core/butterfly";
import { SEVERITY_GLYPH, SEVERITY_LABEL, SEVERITY_ORDER, SEVERITY_TOKEN } from "../core/classify";
import { Panel, Readout, SeverityTag, StateBlock } from "./primitives";
import { useLabActions, useLabState } from "../state/LabProvider";
import type { Severity } from "../core/pipeline";

export function ButterflyView() {
  const state = useLabState();
  const actions = useLabActions();
  const sweep = state.butterfly;

  if (!state.source) {
    return (
      <div className="workspace--wide">
        <div className="stage">
          <Panel title="Butterfly">
            <StateBlock
              title="Load a source first"
              body="A sweep measures bit sensitivity in a specific source, so there has to be one. Open the Lab and choose a sample."
              actions={
                <button type="button" className="btn btn--primary" onClick={() => actions.setView("lab")}>
                  Open the Lab
                </button>
              }
            />
          </Panel>
        </div>
      </div>
    );
  }

  const result = sweep.result;
  const source = state.source;

  return (
    <div className="workspace workspace--rail-stage">
      <div className="rail">
        <Panel title="Sweep" note={`${(source.bytes.length * 8).toLocaleString("en-US")} bits`}>
          <div className="field">
            <span className="field__label" id="budget-label">
              Bits to test
            </span>
            <div className="segmented" role="group" aria-labelledby="budget-label" style={{ flexWrap: "wrap" }}>
              {BUTTERFLY_BUDGETS.map((budget) => (
                <button
                  key={budget}
                  type="button"
                  className="segmented__option"
                  aria-pressed={sweep.budget === budget}
                  disabled={sweep.status === "running"}
                  onClick={() => actions.setButterflyBudget(budget)}
                >
                  {budget}
                </button>
              ))}
            </div>
          </div>

          <div className="btn-row" style={{ marginTop: "var(--space-s)" }}>
            <button
              type="button"
              className="btn btn--primary btn--wide"
              aria-busy={sweep.status === "running"}
              disabled={sweep.status === "running"}
              onClick={() => void actions.runButterfly(sweep.budget)}
            >
              {sweep.status === "running" ? "Sweeping…" : `Run sweep of ${sweep.budget}`}
            </button>
          </div>

          {sweep.status === "running" ? (
            <div className="progress" style={{ marginTop: "var(--space-s)" }}>
              <div className="progress__bar">
                <div
                  className="progress__fill"
                  style={{ width: `${sweep.total === 0 ? 0 : (sweep.completed / sweep.total) * 100}%` }}
                />
              </div>
              <span className="field__hint numeric">
                {sweep.completed} of {sweep.total} positions measured
              </span>
            </div>
          ) : null}

          {sweep.status === "ready" && result ? (
            <Readout
              rows={[
                { label: "Measured", value: `${result.cells.length} positions` },
                { label: "Elapsed", value: `${result.elapsedMs} ms` },
                { label: "Coverage", value: `${(result.coverage.fraction * 100).toFixed(1)}%` },
                { label: "Executor", value: state.offMainThread ? "worker" : "main thread" },
              ]}
            />
          ) : null}

          {result ? (
            <p className="field__hint" style={{ marginTop: "var(--space-2xs)" }}>
              Positions are evenly spaced across the buffer and always include the first and last bit,
              where magic and terminator fields usually live.
            </p>
          ) : null}
        </Panel>

        <Panel title="Severity legend">
          <ul className="severity-list" style={{ display: "grid" }}>
            {SEVERITY_ORDER.map((severity) => (
              <li key={severity} className="severity" style={{ ["--severity-color" as string]: SEVERITY_TOKEN[severity] }}>
                <span className="severity__glyph" aria-hidden="true">
                  {SEVERITY_GLYPH[severity]}
                </span>
                {SEVERITY_LABEL[severity]}
                <span className="severity__value numeric" style={{ marginLeft: "auto" }}>
                  {result ? result.counts[severity] : "—"}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div className="stage">
        <Panel
          title="Sensitivity map"
          accent
          note={result ? `${result.cells.length} measured` : "not run"}
        >
          {sweep.status === "error" && sweep.error ? (
            <StateBlock
              variant="error"
              title={sweep.error.title}
              body={sweep.error.detail}
              actions={
                <button type="button" className="btn" onClick={() => void actions.runButterfly(sweep.budget)}>
                  Try the sweep again
                </button>
              }
            />
          ) : result ? (
            <SensitivityMap result={result} />
          ) : (
            <StateBlock
              title="No sweep has been run"
              body="Choose a budget and run the sweep. Each cell below will be a measured single-bit mutation, not a prediction."
            />
          )}
        </Panel>

        {result ? (
          <Panel title="Measurements" note={`${result.cells.length} rows`} flush>
            <div className="table-wrap" style={{ maxHeight: "28rem", overflowY: "auto" }}>
              <table className="table">
                <caption className="sr-only">
                  Measured consequence of flipping each tested bit position
                </caption>
                <thead>
                  <tr>
                    <th scope="col" className="num">
                      Bit
                    </th>
                    <th scope="col" className="num">
                      Byte
                    </th>
                    <th scope="col">Severity</th>
                    <th scope="col" className="num">
                      Bytes
                    </th>
                    <th scope="col" className="num">
                      Pixels
                    </th>
                    <th scope="col">Why</th>
                  </tr>
                </thead>
                <tbody>
                  {result.cells.map((cell) => (
                    <tr key={cell.bitOffset}>
                      <td className="num">{cell.bitOffset.toLocaleString("en-US")}</td>
                      <td className="num">0x{Math.floor(cell.bitOffset / 8).toString(16).toUpperCase().padStart(4, "0")}</td>
                      <td>
                        <SeverityTag severity={cell.severity} />
                      </td>
                      <td className="num">{cell.bytesChanged}</td>
                      <td className="num">
                        {cell.pixelsChanged === null ? "—" : cell.pixelsChanged.toLocaleString("en-US")}
                      </td>
                      <td style={{ whiteSpace: "normal", maxWidth: "32rem", color: "var(--ink-3)" }}>
                        {cell.rationale}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function SensitivityMap({ result }: { result: ButterflyResult }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { cells } = result;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || cells.length === 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const font = '9px "IBM Plex Mono", monospace';
    ctx.font = font;
    ctx.textBaseline = "top";

    const GLYPH_H = 11;
    const LABEL_W = 22;
    const plotTop = GLYPH_H + 2;
    const baseline = height - 12;
    const plotHeight = baseline - plotTop;
    const plotWidth = width - LABEL_W;
    const slot = plotWidth / cells.length;
    const barWidth = Math.max(1, slot - 1);

    // Fixed 0–1 scale with reference rules, so a flat result reads as "all
    // cells sit at the same measured value" rather than as a broken chart.
    ctx.strokeStyle = readToken("var(--line)");
    ctx.fillStyle = readToken("var(--ink-3)");
    for (const level of [0, 0.5, 1]) {
      const y = baseline - level * plotHeight;
      ctx.beginPath();
      ctx.moveTo(LABEL_W, Math.round(y) + 0.5);
      ctx.lineTo(width, Math.round(y) + 0.5);
      ctx.stroke();
      ctx.fillText(level.toFixed(1), 0, y - 5);
    }

    cells.forEach((cell, index) => {
      const x = LABEL_W + index * slot;
      const barHeight = Math.max(1, cell.consequenceScore * plotHeight);
      ctx.fillStyle = readToken(SEVERITY_TOKEN[cell.severity as Severity]);
      ctx.fillRect(x, baseline - barHeight, barWidth, barHeight);

      // Severity glyph above the bar: colour is never the only signal. Drawn
      // only when the slot is wide enough to be legible.
      if (slot >= 8) {
        ctx.fillText(SEVERITY_GLYPH[cell.severity as Severity], x, plotTop - GLYPH_H + 1);
      }
    });
  }, [cells]);

  const description = cells
    .map((c) => `bit ${c.bitOffset}: ${SEVERITY_LABEL[c.severity]}, ${c.bytesChanged} bytes changed`)
    .join("; ");

  const distinct = new Set(cells.map((c) => c.severity)).size;

  return (
    <div className="sensitivity">
      <canvas
        ref={canvasRef}
        className="sensitivity__canvas"
        role="img"
        aria-label={`Sensitivity map. ${cells.length} bit positions measured across ${distinct} distinct severity level${distinct === 1 ? "" : "s"}: ${cells
          .map((c) => `${SEVERITY_LABEL[c.severity]} at bit ${c.bitOffset}`)
          .join(", ")}.`}
      />
      <details>
        <summary className="field__label" style={{ cursor: "pointer" }}>
          Textual equivalent
        </summary>
        <p className="field__hint" style={{ marginTop: "var(--space-2xs)" }}>
          {description}
        </p>
      </details>
      <p className="sensitivity__axis">
        <span className="numeric">bit {cells[0]?.bitOffset ?? 0}</span>
        <span className="numeric">
          {cells.length} positions · bar height is the measured consequence score, 0 to 1
        </span>
        <span className="numeric">bit {cells.at(-1)?.bitOffset ?? 0}</span>
      </p>
    </div>
  );
}

/** Resolve a CSS custom property to a concrete colour for canvas drawing. */
function readToken(token: string): string {
  const match = /^var\((--[a-z0-9-]+)\)$/i.exec(token);
  if (!match) return token;
  const value = getComputedStyle(document.documentElement).getPropertyValue(match[1]!).trim();
  return value === "" ? "#ffb020" : value;
}