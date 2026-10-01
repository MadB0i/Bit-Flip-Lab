/**
 * The Lab — the primary experiment workspace.
 *
 * The experiment is the product, so it occupies the whole screen: source on
 * the left rail, the flip event and byte inspector in the stage, the
 * measurement on the right. No navigation is required to run an experiment.
 */

import { useEffect, useMemo, useState } from "react";
import { byteToHex, bitIndexFromLeft, formatAddress } from "../core/bits";
import { resolveAdapter } from "../core/adapters";
import { buildAllSamples } from "../core/samples";
import { ByteBitPicker } from "./ByteBitPicker";
import { ByteInspector } from "./ByteInspector";
import { ComparisonPanel } from "./ComparisonPanel";
import { FlipEvent } from "./FlipEvent";
import { SourcePanel, formatBytes, kindLabel, readFileAsSource } from "./SourcePanel";
import { StructureMap } from "./StructureMap";
import { Facts, Panel, Readout, SeverityTag, StateBlock } from "./primitives";
import { useLabActions, useLabState } from "../state/LabProvider";
import type { DataSource } from "../core/pipeline";

const SAMPLES = buildAllSamples();

export function LabView() {
  const state = useLabState();
  const actions = useLabActions();
  const bytesPerRow = useBytesPerRow();
  const [addressDraft, setAddressDraft] = useState("");

  const source = state.source;
  const adapter = useMemo(() => (source ? resolveAdapter(source) : null), [source]);
  const inspection = useMemo(
    () => (source && adapter ? adapter.inspect(source) : null),
    [source, adapter],
  );

  const onSelectSample = (id: string) => void actions.loadSample(id);

  const onLoadFile = (file: File) => {
    void readFileAsSource(file).then(
      (loaded: DataSource) => actions.loadSource(loaded),
      (error: unknown) =>
        actions.reportSourceError({
          title: "That file could not be read",
          detail: error instanceof Error ? error.message : String(error),
          recovery: "Choose another file, or start from a built-in sample.",
          code: "READ_FAILED",
        }),
    );
  };

  if (state.sourceStatus === "error" && state.error) {
    return (
      <div className="workspace workspace--rail-stage">
        <div className="rail">
          <Panel title="Source">
            <SourcePanel
              samples={SAMPLES}
              activeId={null}
              disabled={false}
              onSelectSample={onSelectSample}
              onLoadFile={onLoadFile}
            />
          </Panel>
        </div>
        <div className="stage">
          <Panel title="Source" accent>
            <StateBlock
              variant="error"
              title={state.error.title}
              body={state.error.detail}
              actions={
                state.error.recovery ? (
                  <button type="button" className="btn" onClick={actions.reset}>
                    {state.error.recovery}
                  </button>
                ) : null
              }
            />
          </Panel>
        </div>
      </div>
    );
  }

  if (!source) {
    return (
      <div className="workspace workspace--rail-stage">
        <div className="rail">
          <Panel title="Source">
            <SourcePanel
              samples={SAMPLES}
              activeId={null}
              disabled={false}
              onSelectSample={onSelectSample}
              onLoadFile={onLoadFile}
            />
          </Panel>
        </div>
        <div className="stage">
          <div className="empty-grid">
            <div className="empty-grid__inner">
              <p className="empty-grid__line">One bit. One mutation. One experiment.</p>
              <h2 className="empty-grid__title">
                Bit Flip
                <br />
                Lab
              </h2>
              <p className="empty-grid__body">
                Every byte here is real data you can address. Select a single bit and BIT FLIP LAB
                flips it, re-decodes the result, and reports what actually changed — measured, never
                simulated.
              </p>
              <div className="btn-row" style={{ justifyContent: "center" }}>
                {SAMPLES.map((sample) => (
                  <button
                    key={sample.id}
                    type="button"
                    className="btn btn--primary"
                    onClick={() => void actions.loadSample(sample.id)}
                  >
                    {sample.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const bytes = source.bytes;
  const mutated = state.run?.mutation.data ?? null;

  return (
    <div className="workspace">
      <div className="rail">
        <Panel title="Source" note={formatBytes(bytes.length)}>
          <SourcePanel
            samples={SAMPLES}
            activeId={source.id}
            disabled={state.sourceStatus === "loading"}
            onSelectSample={onSelectSample}
            onLoadFile={onLoadFile}
          />
        </Panel>

        <Panel title="Inspection" note={kindLabel(source.kind)}>
          {state.sourceStatus === "loading" ? (
            <div className="skeleton" aria-hidden="true">
              {[0, 1, 2, 3].map((i) => (
                <div className="skeleton__row" key={i} />
              ))}
            </div>
          ) : (
            <>
              <Facts facts={inspection?.facts ?? []} />
              <p className="field__hint" style={{ marginTop: "var(--space-s)" }}>
                {source.synopsis}
              </p>
            </>
          )}
        </Panel>

        {inspection && inspection.regions.length > 0 ? (
          <Panel title="Structure">
            <StructureMap
              regions={inspection.regions}
              byteLength={bytes.length}
              selectedBit={state.selectedBit}
              onSelect={(bit) => void actions.selectBit(bit)}
            />
          </Panel>
        ) : (
          <Panel title="Structure">
            <StateBlock
              variant="unsupported"
              title="No structure to map"
              body="This format has no decoder, so the only structure that can be reported is the byte boundary itself. Every bit is still individually addressable."
            />
          </Panel>
        )}

        <Panel title="Policy">
          <Readout
            rows={[
              { label: "Mode", value: source.policy },
              { label: "Executed", value: "never", variant: "accent" },
              { label: "Decoder", value: adapter?.label ?? "none" },
            ]}
          />
          <p className="field__hint" style={{ marginTop: "var(--space-2xs)" }}>
            Uploaded bytes are read into this tab and never leave it. BIT FLIP LAB does not run
            uploaded programs in any form.
          </p>
        </Panel>
      </div>

      <div className="stage">
        <Panel
          title="Flip event"
          accent={state.run !== null}
          note={state.run ? `bit ${state.run.mutation.bitOffset}` : "no bit selected"}
        >
          {state.run ? (
            <FlipEvent run={state.run} />
          ) : state.runStatus === "measuring" ? (
            <StateBlock
              title="Measuring the mutation"
              body="Re-decoding the mutated buffer and comparing it against the original."
            />
          ) : (
            <StateBlock
              title="Select one bit"
              body="Choose any bit in the inspector. The flip is applied immediately and the consequence measured — there is no separate apply step."
            />
          )}
        </Panel>

        <Panel
          title="Byte inspector"
          note={`${bytes.length} B · ${(bytes.length * 8).toLocaleString("en-US")} bits · ${bytesPerRow} per row`}
          flush
        >
          <div className="panel__body" style={{ paddingBottom: "var(--space-2xs)" }}>
            <div className="btn-row" role="group" aria-label="Inspector navigation">
              <label className="field__label" htmlFor="jump-address">
                Jump to byte
              </label>
              <input
                id="jump-address"
                className="field__input"
                style={{ width: "7rem" }}
                inputMode="text"
                placeholder="0x0000"
                value={addressDraft}
                onChange={(event) => setAddressDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    jumpToAddress(addressDraft, bytes.length, actions);
                    setAddressDraft("");
                  }
                }}
              />
              <button
                type="button"
                className="btn"
                onClick={() => {
                  jumpToAddress(addressDraft, bytes.length, actions);
                  setAddressDraft("");
                }}
              >
                Go
              </button>
              {/*
                Reset shares this row rather than stacking below it: two
                bordered controls separated by an 8px gap read as a single
                empty outlined box. The row wraps on narrow viewports.
              */}
              {state.run ? (
                <>
                  <span aria-hidden="true" style={{ flex: 1 }} />
                  <button type="button" className="btn btn--quiet" onClick={actions.reset}>
                    Reset experiment
                  </button>
                </>
              ) : null}
            </div>
          </div>

          <ByteInspector
            bytes={bytes}
            mutatedBytes={mutated}
            flippedBit={state.run?.mutation.bitOffset ?? null}
            selectedBit={state.selectedBit}
            bytesPerRow={bytesPerRow}
            onSelect={(bit) => void actions.selectBit(bit)}
          />
        </Panel>

        {state.run ? (
          <Panel title="Comparison" note={state.compareMode} accent>
            <ComparisonPanel
              run={state.run}
              mode={state.compareMode}
              onMode={actions.setCompareMode}
            />
          </Panel>
        ) : null}
      </div>

      <div className="side">
        {state.error ? (
          <Panel title="Mutation error" accent>
            <StateBlock
              variant="error"
              title={state.error.title}
              body={state.error.detail}
              actions={
                state.error.recovery ? (
                  <button type="button" className="btn" onClick={actions.reset}>
                    {state.error.recovery}
                  </button>
                ) : null
              }
            />
          </Panel>
        ) : null}

        <Panel title="Bit" note={state.selectedBit === null ? "—" : String(state.selectedBit)}>
          <BitDetail />
        </Panel>

        <Panel title="Byte bits" accent={state.selectedBit !== null}>
          <ByteBitPicker actions={actions} />
        </Panel>

        {state.run ? (
          <>
            <Panel title="Measurement">
              <Readout
                rows={[
                  { label: "Byte address", value: formatAddress(state.run.mutation.byteIndex, bytes.length) },
                  { label: "Bit from left", value: `${bitIndexFromLeft(state.run.mutation.bitInByte)} of 7` },
                  { label: "Byte before", value: byteToHex(state.run.mutation.originalByte) },
                  { label: "Byte after", value: byteToHex(state.run.mutation.mutatedByte), variant: "accent" },
                  { label: "Bytes changed", value: String(state.run.measurement.bytesChanged) },
                  { label: "Bit count Δ", value: String(state.run.measurement.bitCountDelta) },
                ]}
              />
              <p className="field__hint" style={{ marginTop: "var(--space-s)" }}>
                <SeverityTag severity={state.run.comparison.severity} />
              </p>
              <p className="field__hint" style={{ marginTop: "var(--space-2xs)" }}>
                {state.run.comparison.rationale}
              </p>
            </Panel>

            <Panel title="Integrity">
              <div className="digest">
                <span className="digest__label">SHA-256 before</span>
                <span className="digest__value numeric">{state.run.measurement.integrityBefore}</span>
              </div>
              <div className="digest">
                <span className="digest__label">SHA-256 after</span>
                <span className="digest__value digest__value--after numeric">
                  {state.run.measurement.integrityAfter}
                </span>
              </div>
            </Panel>
          </>
        ) : null}

        {state.run && state.run.measurement.semantics.length > 0 ? (
          <Panel title="Decoded fields">
            <div className="field-delta">
              {state.run.measurement.semantics.map((semantic) => (
                <div className="field-delta__row" key={semantic.label}>
                  <span className="field-delta__label">{semantic.label}</span>
                  <span className="field-delta__pair">
                    <span className="field-delta__before">{semantic.before}</span>
                    <span className="field-delta__result">
                      <span className="field-delta__arrow" aria-hidden="true">
                        →
                      </span>
                      <span className="field-delta__after" data-changed={semantic.changed}>
                        {semantic.after}
                      </span>
                    </span>
                    <span className="sr-only">
                      {semantic.changed ? "changed" : "unchanged"}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          </Panel>
        ) : null}
      </div>
    </div>
  );
}

function BitDetail() {
  const { run, selectedBit, source } = useLabState();
  if (selectedBit === null || !source) {
    return (
      <StateBlock
        title="No bit selected"
        body="Select a bit in the inspector to see its exact address and value."
      />
    );
  }
  const byteIndex = Math.floor(selectedBit / 8);
  const indexFromLeft = selectedBit - byteIndex * 8;
  const value = source.bytes[byteIndex] ?? 0;
  const isFlipped = run?.mutation.bitOffset === selectedBit;

  return (
    <Readout
      rows={[
        { label: "Bit position", value: selectedBit.toLocaleString("en-US"), variant: "accent" },
        { label: "Byte address", value: formatAddress(byteIndex, source.bytes.length) },
        { label: "Byte", value: byteToHex(value) },
        { label: "Bit from left", value: `${indexFromLeft} of 7` },
        { label: "Current value", value: ((value >> (7 - indexFromLeft)) & 1) === 1 ? "1" : "0", variant: "accent" },
        {
          label: "Flipped",
          value: isFlipped ? "yes, this bit" : "no",
          variant: isFlipped ? "accent" : "muted",
        },
      ]}
    />
  );
}

function jumpToAddress(text: string, byteLength: number, actions: ReturnType<typeof useLabActions>) {
  const parsed = parseAddress(text);
  if (parsed === null) return;
  if (parsed >= byteLength) return;
  void actions.selectBit(parsed * 8);
}

export function parseAddress(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  const value = /^0x/i.test(trimmed)
    ? Number.parseInt(trimmed.slice(2), 16)
    : Number.parseInt(trimmed, 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/**
 * Bytes shown per inspector row.
 *
 * The rows are absolutely positioned at a measured pitch, so a row that wraps
 * would overlap its neighbour. On a coarse pointer every bit is a 24px target
 * and only one byte fits; on a fine pointer the grid stays dense.
 */
function useBytesPerRow(): number {
  const [bytesPerRow, setBytesPerRow] = useState(8);
  useEffect(() => {
    const compute = () => {
      const coarse = window.matchMedia("(pointer: coarse)").matches;
      if (coarse) {
        setBytesPerRow(1);
        return;
      }
      const width = window.innerWidth;
      if (width < 34 * 16) setBytesPerRow(2);
      else if (width < 52 * 16) setBytesPerRow(4);
      else setBytesPerRow(8);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);
  return bytesPerRow;
}