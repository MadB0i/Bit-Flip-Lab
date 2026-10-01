"""Render the README SVGs to PNG so they can be inspected visually.

Output goes to qa/out/, which is gitignored: these renders are a review aid,
not repository assets. The SVGs themselves are the committed artefacts.
"""

import pathlib
import sys

from playwright.sync_api import sync_playwright

OUT = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else "qa/out")
OUT.mkdir(parents=True, exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 940, "height": 900}, device_scale_factor=2)
    for name in ("architecture", "experiment-flow"):
        src = pathlib.Path("docs") / f"{name}.svg"
        page.goto(src.resolve().as_uri())
        page.wait_for_timeout(200)
        box = page.locator("svg").bounding_box()
        page.screenshot(
            path=str(OUT / f"svg-{name}.png"),
            clip={"x": 0, "y": 0, "width": box["width"], "height": box["height"]},
        )
        print(f"{name}: {int(box['width'])}x{int(box['height'])}")
    browser.close()
