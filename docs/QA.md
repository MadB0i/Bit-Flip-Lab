# Quality assurance

How Bit Flip Lab is verified, what each check proves, and how to reproduce it.

The QA harness is part of the project, not a ritual. It has caught defects that
reading the code cannot — the list is at the bottom of this document.

## Test suites

| Suite | Command | Result |
|---|---|---|
| TypeScript strict, incl. `noUnusedLocals` and `noUncheckedIndexedAccess` | `npm run lint` | clean |
| Unit tests — the engine | `npm test` | **150 passing**, 8 files |
| Browser tests — the rendered interface | `npm run test:e2e` | **32 passing** |
| Production build | `npm run build` | passing |

`npm run verify` runs lint, unit tests, the build and the browser tests in
sequence.

### What the unit tests cover

The engine is pure, so it is tested without a DOM.

| File | Subject |
|---|---|
| `bits.test.ts` | MSB-first addressing, bounds, empty buffers, width padding |
| `mutate.test.ts` | Single and multi-bit flips, immutability of the input, byte deltas |
| `sha256.test.ts` | FIPS 180-4 vectors, buffer reuse, long inputs |
| `crc32.test.ts` | IEEE 802.3 vectors |
| `png.test.ts` | Encoder round-trip, chunk CRCs, IHDR parsing |
| `labRecord.test.ts` | Record layout, CRC-32 integrity, field offsets |
| `bitmap.test.ts` | Glyph font layout, 1bpp packing, atlas decoding |
| `experiment.test.ts` | The pipeline, record ids, severity derivation, reproduction |

### What the E2E tests cover

`tests/e2e/lab.spec.ts` drives the real interface: sample selection, bit
selection and immediate mutation, the causal rail, difference and butterfly
views, experiment records and reproduction, keyboard navigation of the byte
inspector, and the adapter/decoder boundary behaviour.

## Visual QA

```bash
npm run build
npm run preview -- --port 4173 --strictPort --host 127.0.0.1
npm run qa          # capture + machine-readable audit, 3 device profiles
```

`qa/capture.py` captures the interface at three device profiles and writes
`qa/out/audit.json`. It refuses to write anything if a console error occurred.

**Result: 0 console errors.** Measured, not asserted.

## Accessibility QA

```bash
npm run qa:a11y
```

`qa/a11y.py` runs axe-core against the empty state and an active experiment,
computes real contrast ratios, walks the keyboard, checks reduced-motion
behaviour, and verifies the dialog contract.

**Result: 0 axe violations, 0 computed contrast failures.** Specific measured
properties:

- Zero axe violations on the empty state and on an active experiment.
- Zero computed contrast failures, in either state.
- Zero undersized touch targets under a coarse pointer; each bit cell is
  24 × 24 CSS px.
- A single tab stop in the byte inspector via roving tabindex — 528 rendered bit
  buttons are not 528 tab stops.
- Zero horizontal page scroll at 1440, 1024, 834 and 390 px.
- Zero overlapping rows in the virtualised inspector at any tested width.
- The export dialog opens as a modal and closes on Escape.
- Reduced motion is honoured; severity remains readable without animation.

## Release invariants and gate

```bash
npm run qa:check    # live DOM assertions: decode, classify, overflow, focus
npm run qa:gate     # assert every qa and qa:a11y measurement; non-zero on failure
```

`qa/release_checks.py` re-checks invariants against the live DOM.
`qa/release_gate.py` reads the machine-readable artefacts written by `qa` and
`qa:a11y` and turns them into a verdict, so the accessibility and visual audits
cannot be collected and then ignored. It exits non-zero on any regression.

**Result: 13 checks passing, 0 failing.** It also reports render consistency:

| Property | Value |
|---|---|
| Distinct font sizes | 5, all generated from one 1.200 ratio |
| Font families | 2 |
| Border-radius values | 0 |
| Box-shadow values | 0 |
| Distinct text colours | 7, across the ink ramp, one accent, and the severity scale |

`qa:gate` was verified to actually fail: injecting a synthetic axe violation and
breaking reduced-motion visibility produced exit code 1 with both checks named.

## Documentation QA

```bash
npm run qa:readme
```

`qa/readme_check.py` fails if the README references an image that is not in the
repository, a command that is not in `package.json`, an orphaned asset, or a
prohibited claim (first-ever, unique, AI-marketing, emoji).

## Regenerating the visual assets

```bash
npm run qa:gif      # regenerate docs/hero.gif from the running application
npm run qa:shots    # regenerate the curated screenshots in docs/
```

Every screenshot in `docs/`, and the hero GIF, are produced by these scripts from
the real application. None is hand-edited, and the capture scripts refuse to
write anything if a console error occurred.

The two diagrams — `architecture.svg` and `experiment-flow.svg` — are hand-authored
SVG in the same palette as the interface. `python qa/svg_check.py` renders them to
`qa/out/` so they can be inspected visually.

## Social preview

```bash
npm run qa:social
```

`qa/social_preview.py` composes `docs/social-preview.png` (1280 × 640) from two
real sources and nothing else: the type and colour of the application's own
design tokens with the same two web fonts the application loads, and a
device-scale-2 screenshot of the live flip-event panel. Every value visible on
the card — the flipped bit, `1 → 0`, `F8 → D8`, `valid`, `decoded`,
`Minor · 1 px changed` — is real application output. Scratch files are written to
a temporary directory, so a failed run cannot leave anything in `docs/`.

**GitHub does not use this file automatically.** Committing
`docs/social-preview.png` changes nothing about how the repository appears in
social cards. The social preview must be uploaded manually:

> Settings → General → Social preview → upload `docs/social-preview.png`

There is no REST API for this setting, so it cannot be automated from the
command line. Until it is uploaded, GitHub generates a card from the repository
description and default image.

## Requirements

Node 20 or newer for the application. The `qa:*` scripts additionally require
Python with `playwright` and `Pillow`:

```bash
pip install playwright pillow
python -m playwright install chromium
```

## Defects this harness caught

These are the concrete reason the QA scripts exist rather than being ceremony:

- Absolutely-positioned inspector rows overlapping and stealing clicks.
- A 2:1 contrast failure on a struck-through bit.
- An unoccupied grid track on two views.
- An invisible 1×1 change marker — the 1×1 changed region was mathematically
  located but not drawn.
- A dead 320 px column in the empty state.
- A stacked-toolbar border artifact.
- An invisible 1×1 marker replaced by a tested `markChangedRegion` call.

## Related

- [ARCHITECTURE.md](ARCHITECTURE.md)
- [EXPERIMENTS.md](EXPERIMENTS.md)
- [SCIENTIFIC_NOTES.md](SCIENTIFIC_NOTES.md)