/**
 * Source selection.
 *
 * Built-in samples and user files. Uploaded bytes are treated as untrusted
 * data: they are read into a buffer, matched against known signatures, and
 * handed to the analysis layer. Nothing is ever fetched, linked, or executed.
 */

import { useRef, useState } from "react";
import type { DataSource } from "../core/pipeline";

export const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;

export function SourcePanel({
  samples,
  activeId,
  disabled,
  onSelectSample,
  onLoadFile,
}: {
  samples: readonly DataSource[];
  activeId: string | null;
  disabled: boolean;
  onSelectSample: (id: string) => void;
  onLoadFile: (file: File) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [rejected, setRejected] = useState<string | null>(null);

  const handleFile = (file: File | undefined) => {
    setRejected(null);
    if (!file) return;
    if (file.size === 0) {
      setRejected("That file is empty. There are no bits to address.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setRejected(
        `That file is ${formatBytes(file.size)}. The inspector reads up to ${formatBytes(MAX_UPLOAD_BYTES)} at once.`,
      );
      return;
    }
    onLoadFile(file);
  };

  return (
    <div className="state" style={{ padding: 0, gap: "var(--space-2xs)" }}>
      <div className="source-list">
        {samples.map((sample) => (
          <button
            key={sample.id}
            type="button"
            className="source"
            aria-pressed={sample.id === activeId}
            disabled={disabled}
            onClick={() => onSelectSample(sample.id)}
          >
            <span className="source__name">{sample.name}</span>
            <span className="source__meta numeric">
              <span>{sample.bytes.length} B</span>
              <span className="source__kind">{kindLabel(sample.kind)}</span>
              <span>{sample.policy}</span>
            </span>
          </button>
        ))}
      </div>

      <div
        className="dropzone"
        data-drag={dragging}
        role="button"
        tabIndex={0}
        aria-label="Load a file from this device"
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          handleFile(event.dataTransfer.files[0]);
        }}
      >
        <span>Drop a file, or press Enter to choose</span>
        <span style={{ color: "var(--ink-3)" }}>Read in the browser. Never uploaded, never run.</span>
      </div>

      <input
        ref={inputRef}
        type="file"
        className="sr-only"
        aria-label="Choose a file to inspect"
        onChange={(event) => {
          handleFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {rejected ? (
        <p className="field__hint" role="alert" style={{ color: "var(--sev-critical)" }}>
          {rejected}
        </p>
      ) : null}
    </div>
  );
}

export function kindLabel(kind: DataSource["kind"]): string {
  switch (kind) {
    case "structured":
      return "RECORD";
    case "image":
      return "PNG";
    case "bitmap":
      return "1BPP";
    case "raw":
      return "RAW";
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Read a user file into a DataSource, detecting a known signature. */
export async function readFileAsSource(file: File): Promise<DataSource> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  return {
    id: `upload.${file.name}`,
    name: file.name,
    kind: detectKind(bytes),
    bytes,
    mediaType: file.type || "application/octet-stream",
    synopsis: `Loaded from this device. ${formatBytes(bytes.length)}.`,
    // Uploaded content is inspected or decoded. Never executed.
    policy: "INSPECT",
  };
}

function detectKind(bytes: Uint8Array): DataSource["kind"] {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "image";
  }
  if (bytes.length >= 4 && bytes[0] === 0x42 && bytes[1] === 0x46 && bytes[2] === 0x31) {
    return "bitmap";
  }
  if (bytes.length >= 4 && bytes[0] === 0x42 && bytes[1] === 0x4c && bytes[2] === 0x41) {
    return "structured";
  }
  return "raw";
}