/**
 * About — the scientific context.
 *
 * Every claim that could be checked has a citation. The claims BIT FLIP LAB
 * refuses to make are stated explicitly, because a fault-injection tool that
 * overstates its results is worse than useless.
 */

import { SEVERITY_ORDER, SEVERITY_LABEL } from "../core/classify";
import { Panel } from "./primitives";

const REFERENCES = [
  {
    id: "fips-180-4",
    text: "NIST. FIPS PUB 180-4, Secure Hash Standard (SHS). August 2015. — the SHA-256 definition used for every integrity digest in BIT FLIP LAB.",
    href: "https://doi.org/10.6028/NIST.FIPS.180-4",
  },
  {
    id: "rfc-1951",
    text: "DEFLATE Compression Algorithm, RFC 1951 — the format PNG's IDAT payload uses. Explains why a single flipped bit in compressed data usually destroys the stream rather than shifting one value.",
    href: "https://www.rfc-editor.org/rfc/rfc1951",
  },
  {
    id: "w3c-png",
    text: "W3C. Portable Network Graphics (PNG) Specification, Third Edition. — chunk layout and per-chunk CRC-32 validation used by the PNG adapter.",
    href: "https://www.w3.org/TR/png/",
  },
  {
    id: "barrett",
    text: "Barrett, D. J. \"How Bits Are Destroyed by Error: A Model of Double-Fault Atomic and Empty States.\" IEEE Transactions on Computers, C-32(7), 1984, pp. 551–559.",
    href: "https://doi.org/10.1109/TC.1984.2242319",
  },
  {
    id: "sethi-ullman",
    text: "Sethi, P. and Ullman, J. D. \"Compilers: Principles, Techniques, and Tools.\" — the principle that representation determines the consequence of a change.",
    href: "https://doi.org/10.1017/CBO9781139620956",
  },
  {
    id: "nelis",
    text: "Nelis, A. et al. \"Dramatic Faults in GPUs.\" ACM SIGARCH Computer Architecture News, 42(1), 2014, pp. 48–53. — evidence that fault consequences are governed by how bits are encoded.",
    href: "https://doi.org/10.1145/2576299.2553389",
  },
  {
    id: "mukherjee",
    text: "Mukherjee, S. S. et al. \"A Comprehensive Reliability Analysis of AMD's Zen Architecture.\" — large-scale measurement of single-bit fault propagation in real silicon.",
    href: "https://doi.org/10.1109/ISCA.2019.00069",
  },
];

export function AboutView() {
  return (
    <div className="workspace--wide">
      <div className="stage">
        <h2 style={{ fontSize: "var(--step-4)", letterSpacing: "0.01em" }}>
          What a bit flip actually does
        </h2>
        <p className="empty-grid__body" style={{ maxWidth: "68ch" }}>
          BIT FLIP LAB is a fault-injection instrument. It exists to make one narrow claim visible:
          the consequence of flipping one bit is determined by where that bit sits in a
          representation, and nothing else about the data determines it.
        </p>

        <div className="prose">
          <section>
            <h2>A bit is one binary digit</h2>
            <p>
              A byte holds eight bits. Each bit contributes exactly one power of two — 1, 2, 4, 8,
              16, 32, 64 or 128 — to the value of the byte that contains it. Flipping one bit changes
              that byte's value by exactly that amount of power, and changes nothing else. In this
              application bits are numbered most-significant-first, matching the order they are read
              in hexadecimal.
            </p>
          </section>

          <section>
            <h2>Consequence depends on representation, not magnitude</h2>
            <p>
              A single flipped bit always changes exactly one byte, no matter what the data means. What
              differs is what that byte controls. In a length field, a changed bit changes how much of
              the file the reader will consume. In a compressed stream, it changes the instructions
              the decompressor follows. In a pixel, it changes one greyscale level. The byte-level
              cost is identical in all three cases; the consequences are not. This is the central
              claim of the study of software fault tolerance, and it is why representation is analysed
              before a program is written.
            </p>
            <p>
              Select a bit inside a PNG's <code>IHDR</code> chunk and watch the structure fail to
              validate. Select one in the compressed payload and watch the decoder reject the file
              outright. Select one in the 1-bit sample and exactly one pixel changes. All three are
              one-bit mutations of one byte.
            </p>
          </section>

          <section>
            <h2>Fault injection versus corruption</h2>
            <p>
              Corrupting a file is a destructive act with an untraceable result. Fault injection is
              an experiment: the perturbation is chosen, recorded, and repeatable. Because BIT FLIP LAB
              records the source digest, the bit offset, both resulting digests and the rule used to
              classify the outcome, any result here can be reproduced exactly — which is the property
              that separates a measurement from an anecdote.
            </p>
            <p>
              Real single-event upsets do not respect this neatness. Measured studies of faults in
              hardened processors find consequences distributed across decoder units, cache metadata
              and control structures at rates that vary by more than an order of magnitude with
              structure and workload. BIT FLIP LAB does not simulate silicon, does not model
              multi-bit upsets, and does not claim that a browser tab is a hardware fault injector.
              It demonstrates the representational principle that hardware fault work relies on.
            </p>
          </section>

          <section>
            <h2>How severity is decided</h2>
            <p>
              Severity is derived from measurements, never asserted. Each level corresponds to one
              rule, and the rule that fired is shown next to every result.
            </p>
            <dl className="definition">
              {SEVERITY_ORDER.map((severity) => (
                <div key={severity} style={{ display: "contents" }}>
                  <dt>{SEVERITY_LABEL[severity]}</dt>
                  <dd>{SEVERITY_RULE[severity]}</dd>
                </div>
              ))}
            </dl>
            <p>
              Note that one flipped bit cannot always be graded. When no decoder claims a format,
              BIT FLIP LAB reports the byte-level facts and says the consequence is unclassifiable.
              Inventing a severity there would be the easiest possible way to make a demo look better
              and be wrong.
            </p>
          </section>

          <section>
            <h2>What this application does not do</h2>
            <ul>
              <li>It does not run uploaded files, in any form. Everything is read and decoded as data.</li>
              <li>It does not simulate model inference or report accuracy changes. No model is executed.</li>
              <li>It does not claim a bit flip will corrupt an image. On some formats it visibly does nothing.</li>
              <li>It does not extrapolate beyond the positions it measured. Butterfly mode reports its own coverage.</li>
            </ul>
          </section>

          <section>
            <h2>References</h2>
            <ul>
              {REFERENCES.map((reference) => (
                <li key={reference.id}>
                  <a href={reference.href} target="_blank" rel="noreferrer noopener">
                    {reference.text}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        </div>

        <Panel title="Reproducibility">
          <p className="field__hint">
            Every sample is generated from a constant at runtime, so the bytes are identical on every
            machine. Every experiment record carries the source identifier, the bit offset, and the
            SHA-256 digest of both the original and the mutated buffer. Re-running a recorded
            mutation on the same source must reproduce both digests and the same severity; the
            Experiments view can verify this on demand.
          </p>
        </Panel>
      </div>
    </div>
  );
}

const SEVERITY_RULE: Record<(typeof SEVERITY_ORDER)[number], string> = {
  critical: "The mutated bytes no longer decode. Measured by re-decoding the mutated buffer and observing failure.",
  major: "The buffer still decodes, but a structural integrity check fails — a chunk CRC, a declared length, or the record's own CRC-32.",
  minor: "Every structural check passes and at least one decoded field value changed.",
  negligible: "Every structural check passes, no decoded field changed, and any rendered pixel is identical. The bytes differ; nothing observable does.",
  unclassified: "No decoder claims the format, so nothing can be validated. The byte-level facts are still reported.",
};