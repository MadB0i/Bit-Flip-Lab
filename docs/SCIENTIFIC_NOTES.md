# Scientific notes

What the Bit Flip Lab experiments demonstrate, what they do not, and where the
limits of interpretation lie.

This document exists because the project's central commitment is that a
measurement you cannot trust is worse than no measurement. Everything below is a
statement about the limits of what the tool reports.

## What the experiments demonstrate

The three shipped experiments show, with engine-computed values:

1. **A single-bit mutation has a measurable, located consequence.** Bit 90 of the
   BF11 atlas changes byte `0x000B` from `F8` to `D8` and changes exactly one
   pixel of 448, located at `x10 y0`, 1×1. Not "the image changed" — which
   pixels, and by how much.
2. **Consequence is not proportional to the size of the change.** One bit is
   always one bit, and one byte, and one power of two. What it *does* depends
   entirely on what that byte controls. Bit 90 is `Minor`; bit 20 of the same
   PNG is `Critical`.
3. **Decoder validity is the real oracle.** Whether a mutation mattered can be
   settled by asking the format's own decoder, rather than by eye.
4. **Position within a file predicts severity.** In the BLAB record, all four
   magic-byte positions are `Critical` and the other 60 swept positions are
   `Major`. The tool can locate the reason — a length field declaring
   2147483724 bytes in a 76-byte file, a CRC-32 that no longer matches — with a
   field offset and both values.

## What the experiments do NOT demonstrate

Stated plainly, because these are the claims most easily overread:

- **This is not a hardware fault injector.** Real single-event upsets propagate
  through decoder units, cache metadata, control structures and timing at rates
  that vary by more than an order of magnitude with structure and workload. This
  tool demonstrates the *representational* principle that fault-tolerance work
  relies on. It does not model silicon, voltage, temperature, timing, or
  multi-bit upsets.
- **This is not a model-weight fault-injection framework.** No model is
  executed anywhere in this repository. There is no model adapter.
- **This is not an ML accuracy benchmark.** No accuracy figure is reported,
  because none can be. Adding one would require an explicit reproducible
  evaluation protocol — a fixed prompt set, a fixed decode strategy, published
  seeds, a stated baseline — before any accuracy delta could be stated at all.
  Until that exists, any such number would be fabricated.
- **Severity does not generalise across formats.** `Critical` for a PNG means the
  browser refused the file. `Critical` for a custom record means the record no
  longer parses. The labels are comparable within a format and must not be read
  as a cross-format scale.
- **Butterfly coverage is partial by design.** A default sweep measures 64 of 608
  positions (10.5%) in the BLAB record. That is the honest figure and the
  interface reports it. Untested positions are drawn as untested, never as
  "clean".

## Why severity is derived, not asserted

`core/classify.ts` maps a measurement to a level by rule, and returns the rule
text alongside it. The interface prints the rule next to the result. This is a
deliberate refusal to display a verdict the tool cannot justify:

| Severity | Rule |
|---|---|
| **Critical** | The mutated bytes no longer decode. Measured by re-decoding the mutated buffer. |
| **Major** | It still decodes, but a structural integrity check fails — chunk CRC, declared length, record CRC-32. |
| **Minor** | All structural checks pass and at least one decoded field value changed. |
| **Negligible** | All checks pass, no decoded field changed, every rendered pixel identical. The bytes differ; nothing observable does. |
| **Unclassified** | No adapter claims the format, so nothing can be validated. Byte-level facts are still reported. |

## Decoder dependence — the most important caveat

Every structural conclusion here is only as good as the decoder behind it.

- **PNG** is validated by `core/png.ts`: the 8-byte signature, chunk CRCs, and
  IHDR fields, all parsed in-repo. The *decoded pixels* additionally depend on the
  browser's own image decoder via `imageCodec.ts`, which is the single file in
  the engine that is not pure. A browser with a different or more lenient decoder
  could disagree about whether a mutated buffer renders. That disagreement would
  be the browser's, and the tool would report its own structural finding
  regardless.
- **BF11** and **BLAB** are decoded entirely by code in this repository, so those
  measurements are reproducible anywhere.
- **The raw block has no decoder at all.** It stays `Unclassified`. Inventing a
  severity there would be the easiest way to look more impressive and be wrong.

If an adapter's decoder is wrong, every severity it produces is wrong in the same
direction. This is a real limitation of format-aware measurement, not a solved
problem.

## Interpretation limits

**Amplification is not evidence.** The comparison panel can amplify a difference
view up to 32×. That is a viewing aid and it is labelled as one. The changed
region is located numerically and bracketed on the plate, because a one-pixel
change amplified 32× must not be mistaken for a large change.

**A sub-perceptual change stays sub-perceptual.** Mean absolute error of 0.366
across 448 pixels is a real measured difference and a nearly invisible one. The
tool reports both facts. It does not claim the mutation "destroyed" the image.

**Absence of a reported failure is not evidence of absence.** A `Minor` verdict
means the checks that ran passed and a decoded field changed. It does not mean the
mutation is harmless — only that this decoder's rules found nothing worse.

**Single mutation only.** Every experiment here flips exactly one bit. Two-bit
and multi-bit interactions are out of scope and unmeasured.

## Reproducibility considerations

- **Deterministic by construction.** The same bytes and the same bit offset
  produce a byte-identical mutated buffer, identical SHA-256 digests, and an
  identical severity verdict. SHA-256 is implemented in-repo rather than through
  `crypto.subtle` specifically so the main thread, the Web Worker, and Node under
  test cannot diverge.
- **Content-derived record ids.** A record's id is derived from source, bit and
  resulting digest — not from a clock — so the same experiment always yields the
  same id.
- **Self-verifying.** **Experiments → Verify reproduction** re-runs a recorded
  mutation and reports whether both digests and the severity match.
- **Captured evidence is generated, not drawn.** Every screenshot and the hero
  GIF are produced by scripts in `qa/` from the running application, and the
  capture aborts if a console error occurred. No frame or screenshot is
  hand-edited.

## Related

- [EXPERIMENTS.md](EXPERIMENTS.md) — the measured results
- [ARCHITECTURE.md](ARCHITECTURE.md) — the pipeline and its determinism constraints
- [QA.md](QA.md) — how the measurements are verified