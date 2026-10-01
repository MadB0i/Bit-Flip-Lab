/**
 * Shared presentational primitives.
 *
 * Every panel in the application is built from these, which is what keeps the
 * spacing and border system to exactly one set of values.
 */

import { useId, type ReactNode } from "react";
import { SEVERITY_GLYPH, SEVERITY_LABEL, SEVERITY_TOKEN } from "../core/classify";
import type { Severity } from "../core/pipeline";

export function Panel({
  title,
  note,
  accent = false,
  flush = false,
  children,
  id,
}: {
  title: string;
  note?: ReactNode;
  accent?: boolean;
  flush?: boolean;
  children: ReactNode;
  id?: string;
}) {
  const headingId = useId();
  return (
    <section className="panel" aria-labelledby={headingId} id={id}>
      <header className={`panel__head${accent ? " panel__head--accent" : ""}`}>
        <h2 className="panel__title" id={headingId}>
          {title}
        </h2>
        {note ? <span className="panel__note numeric">{note}</span> : null}
      </header>
      <div className={`panel__body${flush ? " panel__body--flush" : ""}`}>{children}</div>
    </section>
  );
}

export function Readout({
  rows,
}: {
  rows: readonly {
    label: string;
    value: ReactNode;
    variant?: "accent" | "muted" | "wrap";
  }[];
}) {
  return (
    <div className="readout">
      {rows.map((row) => (
        <div className="readout__row" key={row.label}>
          <span className="readout__label">{row.label}</span>
          <span
            className={`readout__value${row.variant ? ` readout__value--${row.variant}` : ""}`}
          >
            {row.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Facts({ facts }: { facts: readonly { label: string; value: string }[] }) {
  if (facts.length === 0) return null;
  return (
    <dl className="facts">
      {facts.map((fact) => (
        <div className="fact" key={fact.label}>
          <dt className="fact__label">{fact.label}</dt>
          <dd className="fact__value" style={{ margin: 0 }}>
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Severity is never colour alone: each level carries a distinct glyph and a
 * written label.
 */
export function SeverityTag({ severity }: { severity: Severity }) {
  return (
    <span className="severity" style={{ ["--severity-color" as string]: SEVERITY_TOKEN[severity] }}>
      <span className="severity__glyph" aria-hidden="true">
        {SEVERITY_GLYPH[severity]}
      </span>
      {SEVERITY_LABEL[severity]}
    </span>
  );
}

export function StateBlock({
  variant = "empty",
  title,
  body,
  actions,
}: {
  variant?: "empty" | "error" | "unsupported";
  title: string;
  body: ReactNode;
  actions?: ReactNode;
}) {
  const className = variant === "empty" ? "state" : `state state--${variant}`;
  return (
    <div className={className}>
      <p className="state__title">{title}</p>
      <div className="state__body">{body}</div>
      {actions ? <div className="state__actions">{actions}</div> : null}
    </div>
  );
}