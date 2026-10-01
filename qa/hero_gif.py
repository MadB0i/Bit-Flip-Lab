"""
Hero GIF capture for Bit Flip Lab.

This script drives the REAL application in a real browser and records what the
interface actually renders. No frame is drawn, composited, or faked: every
frame is a screenshot of the running product, and every value visible in the
GIF is a measurement the engine computed from the bytes.

The sequence is scripted and therefore reproducible:

    load the 1-bit glyph atlas
      -> select bit 90
      -> observe the mutation and the causal rail light up
      -> inspect the amplified difference, with the changed region outlined
      -> return to the flip event

Requirements: the preview server must already be running.

    npm run build
    npm run preview -- --port 4173 --strictPort --host 127.0.0.1
    python qa/hero_gif.py
"""

import pathlib
import shutil
import sys

from PIL import Image
from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173"
OUT = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "docs/hero.gif")
FRAMES = pathlib.Path("qa/frames")

# Rendered at 2x and downsampled, so the monospace type stays legible at
# README width without a large file.
SCALE = 2
VIEWPORT = {"width": 1280, "height": 700}
OUTPUT_WIDTH = 880
COLORS = 96
FPS = 10
# The masthead is sticky, so scrolled-to content must clear it. 120 leaves a
# margin below it and keeps the caption above the plate visible.
TARGET_TOP = 96

# The one bit the demonstration flips. Any bit in the pixel payload would work;
# this one is chosen because the change is exactly one pixel, which is the
# claim the GIF makes.
BIT = 90

# Frame durations in milliseconds. Long enough to read, short enough to loop.
HOLD_READY = 1500
HOLD_MEASURED = 2000
HOLD_DIFFERENCE = 2000
HOLD_RESET = 1100

# The measuring state is deliberately not sampled: the worker round-trip is a
# few milliseconds, so it is below the threshold at which a frame could ever be
# perceived. Capturing it would add weight to the file and imply a latency that
# the product does not have.


def clear_frames() -> None:
    if FRAMES.exists():
        shutil.rmtree(FRAMES)


def capture(page, index: int) -> int:
    """Save one deterministic frame and return the next frame index."""
    FRAMES.mkdir(parents=True, exist_ok=True)
    page.screenshot(path=str(FRAMES / f"frame-{index:04d}.png"), animations="allow", caret="hide")
    return index + 1


def hold(page, index: int, duration_ms: int, start: int) -> int:
    """
    Hold the current UI state for `duration_ms`, sampling at the output rate.

    Sampling during the hold rather than duplicating a single frame keeps the
    GIF honest about motion: the causality rail genuinely animates, and the
    frames recorded here are what it drew.
    """
    step = 1000 / FPS
    elapsed = 0
    while elapsed < duration_ms:
        index = capture(page, index)
        page.wait_for_timeout(step)
        elapsed += step
    return index


def encode() -> pathlib.Path:
    """
    Compose the recorded PNG frames into a looping, palettised GIF.

    States are held rather than tweened, so consecutive frames within a hold
    are byte-identical and Pillow collapses them into one frame with a longer
    duration. The result is a small file that steps cleanly between measured
    states instead of shimmering through imperceptible motion.
    """
    sources = sorted(FRAMES.glob("frame-*.png"))
    if not sources:
        raise SystemExit("No frames were recorded.")

    # The interface is a deliberately constrained palette: three ink levels,
    # one accent, one severity ramp. 128 colours is indistinguishable from 256
    # here and roughly halves the file.
    scaled = []
    for src in sources:
        with Image.open(src) as frame:
            resized = frame.convert("RGB")
            if resized.width != OUTPUT_WIDTH:
                height = round(resized.height * OUTPUT_WIDTH / resized.width)
                resized = resized.resize((OUTPUT_WIDTH, height), Image.LANCZOS)
            scaled.append(resized)

    palette_source = scaled[0].convert("P", palette=Image.ADAPTIVE, colors=COLORS)
    frames = [
        frame.quantize(palette=palette_source, dither=Image.FLOYDSTEINBERG) for frame in scaled
    ]

    frames[0].save(
        OUT,
        save_all=True,
        append_images=frames[1:],
        duration=1000 // FPS,
        loop=0,
        optimize=True,
        disposal=2,
    )
    clear_frames()
    return OUT


def scroll_to(page, selector: str, target_top: int = TARGET_TOP) -> None:
    """
    Scroll so `selector` sits `target_top` px from the top of the viewport.

    Measured and corrected rather than assumed: a single scrollTo lands
    short of the target once a sticky masthead and a nested scroll container
    are both in play, so the position is re-measured and adjusted until it
    converges.
    """
    for _ in range(4):
        delta = page.evaluate(
            """([sel, want]) => {
                const el = document.querySelector(sel);
                if (!el) return 0;
                return Math.round(el.getBoundingClientRect().top - want);
            }""",
            [selector, target_top],
        )
        if delta == 0:
            return
        page.evaluate("(d) => window.scrollBy(0, d)", delta)


def main() -> None:
    clear_frames()
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(
            viewport=VIEWPORT,
            device_scale_factor=SCALE,
            reduced_motion="no-preference",
            color_scheme="dark",
        )
        page = context.new_page()
        console_errors: list[str] = []
        page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: console_errors.append(str(e)))

        page.goto(URL, wait_until="networkidle")

        index = 0

        # ── 1. Load the 1-bit atlas. The empty state is not the product; the
        #    experiment is, so the GIF opens on the loaded workspace.
        page.get_by_role("button", name="BF11 atlas", exact=True).first.click()
        page.wait_for_selector(".inspector")
        page.wait_for_timeout(400)
        page.evaluate("() => window.scrollTo(0, 0)")
        index = hold(page, index, HOLD_READY, index)

        # ── 2. Select one bit. The mutation and the measurement happen
        #    immediately — there is no separate apply step.
        page.locator(f'button.bit[data-bit="{BIT}"]').first.click()
        page.wait_for_selector(".bitfield__bit--changed")
        page.wait_for_timeout(900)  # let the causality rail finish travelling
        page.evaluate("() => window.scrollTo(0, 0)")
        index = hold(page, index, HOLD_MEASURED, index)

        # ── 3. The difference at true scale, with the changed region bracketed
        #    and the exact pixel measurement directly beneath it.
        #
        #    Amplification is deliberately NOT shown here. The changed pixel
        #    differs by 1 of 255, so no honest gain makes it look large; that
        #    is precisely why the region is bracketed and located numerically.
        #    A frame showing a gain that appears to do nothing would misrepresent
        #    the measurement.
        scroll_to(page, ".compare__label")
        page.wait_for_timeout(250)
        index = hold(page, index, HOLD_DIFFERENCE, index)

        # ── 4. Reset, so the GIF closes its own loop.
        page.get_by_role("button", name="Reset experiment").click()
        page.wait_for_selector("text=Select one bit")
        page.evaluate("() => window.scrollTo(0, 0)")
        page.wait_for_timeout(200)
        index = hold(page, index, HOLD_RESET, index)

        browser.close()

    if console_errors:
        raise SystemExit(f"Refusing to publish a GIF captured with console errors: {console_errors}")

    path = encode()
    size_kb = path.stat().st_size / 1024
    print(f"Wrote {path}  ({size_kb:.0f} KiB)")


if __name__ == "__main__":
    main()
