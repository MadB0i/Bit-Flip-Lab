"""Generate docs/social-preview.png — the GitHub social card.

The card is composed from two real sources and nothing else:

  * the type and colour of the application's own design tokens, with the same
    two web fonts the application loads;
  * a device-scale-2 screenshot of the live flip-event panel, so the visual on
    the card is genuine application output rather than a redrawing.

GitHub does NOT pick this file up automatically. The social preview must be set
in the repository settings (Settings -> General -> Social preview), which cannot
be done from the API. docs/QA.md records that step.

Usage: python qa/social_preview.py http://127.0.0.1:4173 docs/social-preview.png
"""

import pathlib
import shutil
import sys
import tempfile

from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173"
OUT = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "docs/social-preview.png")
OUT.parent.mkdir(parents=True, exist_ok=True)

# Scratch lives in a temp directory, never in docs/, so a failed run cannot leave
# an intermediate file that looks like a committed asset.
SCRATCH = pathlib.Path(tempfile.mkdtemp(prefix="bfl-social-"))
SHOT = SCRATCH / "source.png"

CARD = """
<!doctype html>
<html>
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
  /* Values mirrored from src/styles/tokens.css. Kept in sync by hand; this is
     a standalone capture page, not the application. */
  html, body { margin: 0; padding: 0; background: #0b0d10; }
  .card {
    width: 1280px; height: 640px; overflow: hidden; background: #0b0d10;
    color: #e8ecf1; font-family: "IBM Plex Mono", ui-monospace, monospace;
    display: flex; flex-direction: column;
  }
  .top { height: 240px; display: flex; align-items: center; padding: 0 72px; }
  .brand {
    font-family: "Big Shoulders Display", "Arial Narrow", sans-serif;
    font-size: 86px; line-height: 0.95; letter-spacing: 5px; font-weight: 700;
  }
  .brand em { font-style: normal; color: #ffb020; }
  .kicker { font-size: 13px; letter-spacing: 4px; color: #7d8794; margin-top: 12px; }
  .tag {
    margin-left: auto; text-align: right; font-size: 25px; line-height: 1.55;
    letter-spacing: 3px; font-weight: 500;
  }
  .foot { font-size: 12px; letter-spacing: 2px; color: #7d8794; margin-top: 16px; }
  .bottom { flex: 1; position: relative; border-top: 1px solid #222932; background: #0f1216; }
  .shot { display: block; width: 100%; height: auto; }
  .badge {
    position: absolute; right: 72px; top: 26px;
    background: #ffb020; color: #0b0d10; font-weight: 600;
    font-size: 13px; letter-spacing: 3px; padding: 10px 18px;
  }
</style>
</head>
<body>
  <div class="card">
    <div class="top">
      <div>
        <div class="brand">BIT FLIP <em>LAB</em></div>
        <div class="kicker">FAULT INJECTION BENCH</div>
      </div>
      <div>
        <div class="tag">ONE BIT.<br>ONE MUTATION.<br>WATCH WHAT CHANGES.</div>
        <div class="foot">DETERMINISTIC BIT-LEVEL FAULT INJECTION &amp; MEASUREMENT</div>
      </div>
    </div>
    <div class="bottom">
      <img class="shot" src="__SHOT__">
      <div class="badge">1 BIT &#8594; 1 BYTE &#8594; 1 PIXEL</div>
    </div>
  </div>
</body>
</html>
"""

with sync_playwright() as p:
    browser = p.chromium.launch()

    # 1. Real application output: the flip-event panel, captured at 2x.
    page = browser.new_page(viewport={"width": 1440, "height": 900}, device_scale_factor=2)
    page.goto(BASE, wait_until="networkidle")
    page.get_by_role("button", name="BF11 atlas", exact=True).first.click()
    page.wait_for_selector(".inspector")
    page.locator('button.bit[data-bit="90"]').click()
    page.wait_for_timeout(900)
    panel = page.locator(".flip").first
    box = panel.bounding_box()
    if not box:
        raise SystemExit("social_preview: flip-event panel not found")
    page.screenshot(path=str(SHOT), clip=box)
    print(f"source panel: {int(box['width'])}x{int(box['height'])} at 2x")
    page.close()

    # 2. Compose and capture the card. The card is written to a real file and
    # navigated to, so the panel loads as a same-directory file:// sibling.
    CARD_PAGE = SHOT.with_suffix(".html")
    CARD_PAGE.write_text(CARD.replace("__SHOT__", SHOT.name), encoding="utf-8")
    card = browser.new_page(viewport={"width": 1280, "height": 640}, device_scale_factor=1)
    card.goto(CARD_PAGE.resolve().as_uri(), wait_until="networkidle")
    card.wait_for_timeout(600)
    loaded = card.evaluate(
        "() => { const i = document.querySelector('.shot');"
        " return [i.complete, i.naturalWidth, i.naturalHeight]; }"
    )
    if not loaded[0] or loaded[1] == 0:
        raise SystemExit(f"social_preview: source panel failed to load (complete={loaded[0]}, w={loaded[1]})")
    print(f"source panel decoded at {loaded[1]}x{loaded[2]}")
    card.screenshot(path=str(OUT))
    print(f"wrote {OUT} ({OUT.stat().st_size:,} B)")

    browser.close()

SHOT.unlink(missing_ok=True)
CARD_PAGE.unlink(missing_ok=True)
shutil.rmtree(SCRATCH, ignore_errors=True)