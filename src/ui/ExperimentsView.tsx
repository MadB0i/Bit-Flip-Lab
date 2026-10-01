/**
 * Experiment log.
 *
 * Every measurement the session produced, each one independently
 * reproducible: the record carries both integrity digests and the bit offset,
 * so re-running the same mutation on the same source must reproduce it.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { recordToJson, verifyReproduction } from "../core/experiment";
import { SEVERITY_ORDER } from "../core/classify";
import { Panel, SeverityTag, StateBlock } from "./primitives";
import { useLabActions, useLabState } from "../state/LabProvider";
import type { ExperimentRecord } from "../core/pipeline";

export function ExperimentsView() {
  const { records, source } = useLabState();
  const actions = useLabActions();
  const [openRecord, setOpenRecord] = useState<ExperimentRecord | null>(null);
  const dialogRef = useRef<HTMLDialogElement | null>(null);

  const tally = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const severity of SEVERITY_ORDER) counts[severity] = 0;
    for (const record of records) {
      const key = record.comparison.severity;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [records]);

  return (
    <div className="workspace workspace--rail-stage">
      <div className="rail">
        <Panel title="Session" note={`${records.length} records`}>
          <ul className="severity-list" style={{ display: "grid" }}>
            {SEVERITY_ORDER.map((severity) => (
              <li key={severity} className="readout__row">
                <span className="readout__label">
                  <SeverityTag severity={severity} />
                </span>
                <span className="readout__value numeric">{tally[severity] ?? 0}</span>
              </li>
            ))}
          </ul>
          <div className="btn-row" style={{ marginTop: "var(--space-s)" }}>
            <button
              type="button"
              className="btn btn--quiet btn--wide"
              disabled={records.length === 0}
              onClick={actions.clearRecords}
            >
              Clear the log
            </button>
          </div>
          <p className="field__hint" style={{ marginTop: "var(--space-2xs)" }}>
            Records live in this tab only. Nothing is uploaded, and reloading the page clears them.
          </p>
        </Panel>
      </div>

      <div className="stage">
        <Panel title="Experiment log" note={records.length > 0 ? "newest first" : "empty"} flush>
          {records.length === 0 ? (
            <StateBlock
              title="No experiments yet"
              body="Every bit you flip in the Lab is recorded here with its address, its byte delta, both integrity digests, and the rule that classified its severity."
              actions={
                <button type="button" className="btn btn--primary" onClick={() => actions.setView("lab")}>
                  Open the Lab
                </button>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <caption className="sr-only">All experiments recorded in this session</caption>
                <thead>
                  <tr>
                    <th scope="col">Record</th>
                    <th scope="col">Source</th>
                    <th scope="col" className="num">
                      Bit
                    </th>
                    <th scope="col" className="num">
                      Byte
                    </th>
                    <th scope="col" className="num">
                      Flip
                    </th>
                    <th scope="col">Severity</th>
                    <th scope="col" className="num">
                      Bytes
                    </th>
                    <th scope="col">SHA-256 after</th>
                    <th scope="col">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <button
                          type="button"
                          className="row-button"
                          onClick={() => setOpenRecord(record)}
                        >
                          {record.id}
                        </button>
                      </td>
                      <td>{record.sourceName}</td>
                      <td className="num">{record.bitOffsets[0]?.toLocaleString("en-US")}</td>
                      <td className="num">
                        0x{record.byteOffset.toString(16).toUpperCase().padStart(4, "0")}
                      </td>
                      <td className="num numeric">
                        {record.originalBit} → {record.mutatedBit}
                      </td>
                      <td>
                        <SeverityTag severity={record.comparison.severity} />
                      </td>
                      <td className="num">{record.measurement.bytesChanged}</td>
                      <td style={{ color: "var(--ink-3)" }}>{record.integrityAfter.slice(0, 16)}…</td>
                      <td>
                        <button
                          type="button"
                          className="row-button"
                          onClick={() => setOpenRecord(record)}
                        >
                          Open
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        {records.length > 0 ? (
          <Panel title="Reproduce a record" note="independently verifiable">
            <ol className="steps">
              <li>
                Load the same source. The built-in samples are generated from a constant, so their
                bytes are identical on every machine — the SHA-256 in the record is the check.
              </li>
              <li>
                Select the bit named in the record. Its byte address is in the detail view; enter it
                in <strong>Jump to byte</strong> on the Lab.
              </li>
              <li>
                Compare the resulting SHA-256 and severity. <strong>Verify reproduction</strong> in
                a record's detail view runs exactly this check and reports the outcome.
              </li>
            </ol>
            <p className="field__hint">
              A record is not a log line. It is a claim with enough information attached to be
              tested: same source, same bit, same two digests, same severity.
            </p>
          </Panel>
        ) : null}
      </div>

      <RecordDialog
        record={openRecord}
        dialogRef={dialogRef}
        canVerify={source?.id === openRecord?.sourceId}
        onClose={() => setOpenRecord(null)}
      />
    </div>
  );
}

function RecordDialog({
  record,
  dialogRef,
  canVerify,
  onClose,
}: {
  record: ExperimentRecord | null;
  dialogRef: React.RefObject<HTMLDialogElement>;
  canVerify: boolean;
  onClose: () => void;
}) {
  const [verification, setVerification] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // `<dialog>` supplies the focus trap, Esc handling and inert background.
  // What remains is to move focus in on open and clear the panel's own state.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (record && !dialog.open) {
      setVerification(null);
      dialog.showModal();
      closeRef.current?.focus();
    } else if (!record && dialog.open) {
      dialog.close();
    }
  }, [record, dialogRef]);

  return (
    <dialog
      className="sheet"
      ref={dialogRef}
      aria-labelledby="record-title"
      onClose={onClose}
      onCancel={onClose}
    >
      {record ? (
        <>
          <header className="sheet__head">
            <h2 className="sheet__title" id="record-title">
              {record.id}
            </h2>
            <button
              type="button"
              className="icon-btn"
              ref={closeRef}
              aria-label="Close the record"
              onClick={onClose}
            >
              ✕
            </button>
          </header>
          <div className="sheet__body">
            <p className="field__hint">
              {record.sourceName} · {record.byteLength} bytes · recorded{" "}
              {new Date(record.timestamp).toLocaleString("en-US")}
            </p>

            <DefinitionList
              rows={[
                ["Bit position", record.bitOffsets.map(String).join(", ")],
                ["Byte offset", `0x${record.byteOffset.toString(16).toUpperCase().padStart(4, "0")}`],
                ["Bit from left", `${7 - record.bitInByte} of 7`],
                [
                  "Byte",
                  `0x${record.originalByte.toString(16).toUpperCase().padStart(2, "0")} → 0x${record.mutatedByte
                    .toString(16)
                    .toUpperCase()
                    .padStart(2, "0")}`,
                ],
                ["Bit", `${record.originalBit} → ${record.mutatedBit}`],
                ["Bytes changed", String(record.measurement.bytesChanged)],
                ["Bit count Δ", String(record.measurement.bitCountDelta)],
                ["SHA-256 before", record.integrityBefore],
                ["SHA-256 after", record.integrityAfter],
              ]}
            />

            <div>
              <SeverityTag severity={record.comparison.severity} />
              <p className="field__hint" style={{ marginTop: "var(--space-3xs)" }}>
                {record.comparison.rationale}
              </p>
            </div>

            {record.measurement.render ? (
              <DefinitionList
                rows={[
                  ["Pixels changed", record.measurement.render.pixelsChanged.toLocaleString("en-US")],
                  ["Pixels total", record.measurement.render.pixelsTotal.toLocaleString("en-US")],
                  ["Mean absolute error", record.measurement.render.meanAbsoluteError.toFixed(3)],
                  ["Max absolute error", record.measurement.render.maxAbsoluteError.toFixed(3)],
                ]}
              />
            ) : null}

            <div className="btn-row">
              <button
                type="button"
                className="btn"
                onClick={() => void copyText(recordToJson(record))}
              >
                Copy record JSON
              </button>
              <button
                type="button"
                className="btn"
                onClick={() => void downloadJson(record)}
              >
                Download record
              </button>
              <VerifyButton record={record} canVerify={canVerify} onResult={setVerification} />
            </div>

            {verification ? (
              <p className="field__hint" role="status">
                {verification}
              </p>
            ) : null}
          </div>
        </>
      ) : null}
    </dialog>
  );
}

function VerifyButton({
  record,
  canVerify,
  onResult,
}: {
  record: ExperimentRecord;
  canVerify: boolean;
  onResult: (message: string) => void;
}) {
  const { source } = useLabState();
  if (!canVerify || !source) {
    return (
      <button type="button" className="btn btn--quiet" disabled title="Load this source first">
        Verify reproduction
      </button>
    );
  }
  return (
    <button
      type="button"
      className="btn btn--quiet"
      onClick={() => {
        void verifyReproduction(record, source).then((outcome) => onResult(outcome.detail));
      }}
    >
      Verify reproduction
    </button>
  );
}

function DefinitionList({ rows }: { rows: readonly (readonly [string, string])[] }) {
  return (
    <dl className="facts" style={{ gridTemplateColumns: "minmax(6rem, auto) minmax(0, 1fr)" }}>
      {rows.map(([term, value]) => (
        <div key={term} style={{ display: "contents" }}>
          <dt className="fact__label">{term}</dt>
          <dd className="fact__value" style={{ margin: 0, wordBreak: "break-all" }}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Clipboard access can be denied; the download control remains available.
  }
}

function downloadJson(record: ExperimentRecord): void {
  const blob = new Blob([recordToJson(record)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${record.id}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}