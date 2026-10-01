"""
Curated README screenshots.

Every image in docs/ is produced here, from the real running application, with
a deliberate crop chosen for the claim it supports. This is not a screenshot
dump: each shot frames one measurement.

The script refuses to write anything if a console error occurred, so a broken
frame can never be published.

    npm run build
    npm run preview -- --port 4173 --strictPort --host 127.0.0.1
    python qa/readme_shots.py
"""

import pathlib
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173"
OUT = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "docs")

# Rendered at 2x and downsampled by the README renderer, so the monospace type
# stays legible without large files.
SCALE = 2
VIEWPORT = {"width": 1360, "height": 900}

errors: list[str] = []


def shot(page, name: str, selector: str, pad: int = 18) -> None:
    """Crop to an element plus padding, at device scale."""
    box = page.locator(selector).first.bounding_box()
    if not box:
        raise SystemExit(f"{name}: selector {selector!r} did not match anything")
    clip = {
        "x": max(0, box["x"] - pad),
        "y": max(0, box["y"] - pad),
        "width": min(VIEWPORT["width"], box["width"] + pad * 2),
        "height": box["height"] + pad * 2,
    }
    # A crop taller than the viewport cannot be captured in one pass; scroll it
    # into view and keep the clip within the rendered area.
    if clip["y"] + clip["height"] > VIEWPORT["height"]:
        page.evaluate(
            "([sel, pad]) => { const el = document.querySelector(sel);"
            " window.scrollBy(0, el.getBoundingClientRect().top - pad - 8); }",
            [selector, pad],
        )
        page.wait_for_timeout(200)
        box = page.locator(selector).first.bounding_box()
        clip = {
            "x": max(0, box["x"] - pad),
            "y": max(0, box["y"] - pad),
            "width": min(VIEWPORT["width"], box["width"] + pad * 2),
            "height": box["height"] + pad * 2,
        }
    page.screenshot(path=str(OUT / f"{name}.png"), clip=clip, animations="disabled")
    print(f"  {name}.png  {int(clip['width'])}x{int(clip['height'])}")


def shot_viewport(page, name: str, height: int = 760) -> None:
    """
    Capture the rendered viewport, which is how the instrument actually looks.

    Used where a whole column would produce an image far too tall to read in a
    README: a screenshot of the running window is both smaller and more
    representative than a stitched column.
    """
    page.set_viewport_size({"width": VIEWPORT["width"], "height": height})
    page.wait_for_timeout(250)
    page.screenshot(
        path=str(OUT / f"{name}.png"),
        clip={"x": 0, "y": 0, "width": VIEWPORT["width"], "height": height},
        animations="disabled",
    )
    page.set_viewport_size(VIEWPORT)
    page.wait_for_timeout(200)
    print(f"  {name}.png  {VIEWPORT['width']}x{height}")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        context = browser.new_context(
            viewport=VIEWPORT, device_scale_factor=SCALE, color_scheme="dark"
        )
        page = context.new_page()
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ── 01. The workspace: one bit selected, the whole causal chain lit.
        page.goto(URL, wait_until="networkidle")
        page.get_by_role("button", name="BF11 atlas", exact=True).first.click()
        page.wait_for_selector(".inspector")
        page.locator('button.bit[data-bit="90"]').click()
        page.wait_for_selector(".bitfield__bit--changed")
        page.wait_for_timeout(1000)  # let the causality rail finish travelling
        print("capturing:")
        page.evaluate("() => window.scrollTo(0, 0)")
        shot_viewport(page, "workspace", height=780)

        # The flip event and the causal rail are already shown twice — in the
        # hero GIF and in the workspace shot — so no separate asset is cut for
        # them. Every file written here must be referenced by the README.

        # ── 02. The difference: bracketed changed region plus the exact numbers.
        page.get_by_role("heading", name="Comparison", exact=True).scroll_into_view_if_needed()
        page.wait_for_timeout(300)
        shot(page, "difference", ".workspace .stage > .panel:nth-of-type(3)", pad=0)

        # ── 03. The PNG signature: original still rendered, decoder rejects.
        page.goto(URL, wait_until="networkidle")
        page.get_by_role("button", name="PNG plate", exact=True).first.click()
        page.wait_for_selector(".inspector")
        page.locator('button.bit[data-bit="20"]').click()
        page.wait_for_timeout(900)
        shot(page, "png-signature-failure", ".workspace .stage > .panel:nth-of-type(3)", pad=0)

        # ── 04. Butterfly: the measured sensitivity map and its first rows.
        page.get_by_role("button", name="Butterfly").click()
        page.wait_for_timeout(300)
        page.get_by_role("button", name="64", exact=True).first.click()
        page.get_by_role("button", name="Run sweep of 64").click()
        page.wait_for_selector(".stage table tbody tr")
        page.wait_for_timeout(600)
        shot(page, "butterfly", ".workspace .stage", pad=0)

        browser.close()

    if errors:
        raise SystemExit(f"Refusing to publish screenshots captured with console errors: {errors}")
    print("no console errors")


if __name__ == "__main__":
    main()
