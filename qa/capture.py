"""
Visual QA capture for Bit Flip Lab.

Renders every meaningful state at desktop and mobile widths and writes
screenshots plus a machine-readable audit of overflow, distinct computed
values, and console errors. Run against a live preview server.
"""

import json
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

# Pixel 5 profile, inlined so the script has no dependency on a device table.
# `isMobile` is what makes Chromium report `pointer: coarse`.
TOUCH_PROFILE = {
    "viewport": {"width": 390, "height": 844},
    "device_scale_factor": 2.75,
    "is_mobile": True,
    "has_touch": True,
    "user_agent": (
        "Mozilla/5.0 (Linux; Android 11; Pixel 5) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36"
    ),
}

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173"
OUT = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "qa")
OUT.mkdir(parents=True, exist_ok=True)

VIEWPORTS = [
    ("desktop", 1440, 900, False),
    ("mobile", 390, 844, False),
    ("mobile-touch", 390, 844, True),
]

PROPERTIES = ["font-size", "font-family", "border-radius", "box-shadow", "padding", "color"]


def overflow(page):
    """Elements past the viewport edge, ignoring those inside a scroll container."""
    return page.evaluate(
        """() => {
        const scroller = (el) => {
          for (let n = el.parentElement; n; n = n.parentElement) {
            const ox = getComputedStyle(n).overflowX;
            if (ox === 'auto' || ox === 'scroll') return true;
          }
          return false;
        };
        const root = document.documentElement;
        return [...document.querySelectorAll('*')]
          .filter(e => e.getBoundingClientRect().right > root.clientWidth + 1)
          .filter(e => !scroller(e))
          .slice(0, 8)
          .map(e => e.tagName + '.' + (typeof e.className === 'string' ? e.className : ''));
    }"""
    )


def page_widths(page):
    return page.evaluate(
        """() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
            pageScrollsHorizontally:
              document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
        })"""
    )


def row_integrity(page):
    """
    The inspector virtualises absolutely-positioned rows at a fixed pitch.
    A row whose content is taller than the pitch silently overlaps the next
    one and steals its clicks — the bug that only shows up in a render.
    """
    return page.evaluate(
        """() => {
            const rows = [...document.querySelectorAll('.inspector__row')];
            const bad = [];
            for (const r of rows) {
                const box = r.getBoundingClientRect();
                const contentBottom = Math.max(
                    ...[...r.querySelectorAll('.byte')].map(e => e.getBoundingClientRect().bottom)
                );
                if (contentBottom > box.bottom + 0.5) {
                    bad.push({ row: r.dataset.row, overflowPx: +(contentBottom - box.bottom).toFixed(1) });
                }
                const byteWidths = [...r.querySelectorAll('.byte')].map(e => e.getBoundingClientRect().width);
                const rowContentWidth = [...r.querySelectorAll('.inspector__bytes')]
                    .reduce((n, e) => n + e.getBoundingClientRect().width, 0);
                if (rowContentWidth > r.getBoundingClientRect().width + 1) {
                    bad.push({ row: r.dataset.row, bytes: byteWidths.length, wrapsHorizontally: true });
                }
            }
            return { rowsChecked: rows.length, violations: bad.slice(0, 5) };
        }"""
    )


def distinct(page, prop):
    return page.evaluate(
        """(p) => [...new Set([...document.querySelectorAll('*')]
            .map(e => getComputedStyle(e)[p]).filter(v => v && v !== 'none' && v !== '0px'))]""",
        prop,
    )


def shoot(page, name, full_page=True):
    """
    Capture a screenshot.

    A full-page capture makes Playwright override device metrics, which resets
    Chromium's mobile emulation. Any touch pass must therefore be captured
    viewport-only, or the image shows the fine-pointer layout under a touch
    device's user agent — a rendering that cannot occur in reality.
    """
    touch = page.context._impl_obj._options.get("is_mobile", False)
    page.screenshot(
        path=str(OUT / f"{name}.png"),
        animations="disabled",
        full_page=full_page and not touch,
    )


def audit_measurements(p, report):
    """
    Target sizes, row integrity and pointer state, measured in a dedicated pass.

    These must NOT run in the same session as the full-page screenshots:
    Playwright implements a full-page capture by overriding device metrics,
    which silently resets Chromium's mobile emulation and would make
    `pointer: coarse` report false. The measurement would then be taken under
    conditions that never occur in the real application.
    """
    for label, width, height, touch in VIEWPORTS:
        browser = p.chromium.launch()
        context = (
            browser.new_context(**{**TOUCH_PROFILE, "viewport": {"width": width, "height": height}})
            if touch
            else browser.new_context(viewport={"width": width, "height": height})
        )
        page = context.new_page()
        page.goto(URL, wait_until="networkidle")

        report[f"{label}:pointer"] = page.evaluate(
            """() => ({
                coarse: matchMedia('(pointer: coarse)').matches,
                touchPoints: navigator.maxTouchPoints,
            })"""
        )

        # Reach a state where every control family is on screen.
        page.get_by_role("button", name="BF11 atlas").first.click()
        page.wait_for_timeout(300)
        page.locator("button.bit").nth(90).click()
        page.wait_for_timeout(500)

        report[f"{label}:inspector-rows"] = row_integrity(page)

        # WCAG 2.2 SC 2.5.8 sets 24x24 CSS px as the minimum target size.
        report[f"{label}:target-sizes"] = page.evaluate(
            """() => {
                const sel = '.bit, .bit-picker__bit, .btn, .nav__item, .source, .segmented__option, .dropzone';
                const tooSmall = [];
                const byClass = {};
                for (const el of document.querySelectorAll(sel)) {
                    const r = el.getBoundingClientRect();
                    if (r.width === 0 || r.height === 0) continue;
                    const cls = (el.className || '').split(' ')[0];
                    byClass[cls] = byClass[cls] || { count: 0, w: r.width, h: r.height };
                    byClass[cls].count++;
                    if (r.width < 24 || r.height < 24) {
                        tooSmall.push({ cls, w: +r.width.toFixed(1), h: +r.height.toFixed(1) });
                    }
                }
                return { undersized: tooSmall.length, byClass, sample: tooSmall.slice(0, 4) };
            }"""
        )

        page.close()
        context.close()
        browser.close()


def main():
    errors = []
    report = {}

    with sync_playwright() as p:
        for label, width, height, touch in VIEWPORTS:
            # A fresh browser per pass: Chromium's pointer emulation is set at
            # the browser level and leaks between contexts otherwise, which
            # silently disables the touch-target stylesheet for later passes.
            browser = p.chromium.launch()
            context = (
                browser.new_context(**{**TOUCH_PROFILE, "viewport": {"width": width, "height": height}})
                if touch
                else browser.new_context(viewport={"width": width, "height": height})
            )
            page = context.new_page()
            page.on("console", lambda m: errors.append(f"[{label}] {m.text}") if m.type == "error" else None)
            page.on("pageerror", lambda e: errors.append(f"[{label}] {e}"))
            page.goto(URL, wait_until="networkidle")
            report[f"{label}:pointer"] = page.evaluate(
                """() => ({
                    coarse: matchMedia('(pointer: coarse)').matches,
                    touchPoints: navigator.maxTouchPoints,
                    ua: navigator.userAgent.slice(0, 60),
                })"""
            )

            shoot(page, f"{label}-01-empty")
            report[f"{label}:empty"] = {"overflow": overflow(page)}

            # Sample: structured record
            page.get_by_role("button", name="BLAB record").first.click()
            page.wait_for_selector("text=Byte inspector")
            page.wait_for_timeout(250)
            shoot(page, f"{label}-02-sample-loaded")
            report[f"{label}:loaded"] = {"overflow": overflow(page)}

            # Flip a bit: the magic byte, so the causal chain is dramatic
            first_bit = page.locator("button.bit").first
            first_bit.click()
            page.wait_for_timeout(600)
            shoot(page, f"{label}-03-flip-event")
            report[f"{label}:flip"] = {"overflow": overflow(page)}

            # A payload bit, for a subtler result
            page.locator("button.bit").nth(140).click()
            page.wait_for_timeout(600)
            shoot(page, f"{label}-04-payload-flip")

            # Comparison modes (the difference mode is disabled when the format
            # has no renderer, which is itself a behaviour worth verifying)
            for mode in ("original", "mutated", "difference"):
                btn = page.get_by_role("button", name=mode, exact=True)
                if btn.count() and btn.first.is_enabled():
                    btn.first.click()
                    page.wait_for_timeout(300)
                    shoot(page, f"{label}-05-compare-{mode}")
                else:
                    report[f"{label}:compare:{mode}"] = "disabled — no renderer for this format"

            if label == "desktop":
                report["distinct"] = {
                    prop: len(distinct(page, prop)) for prop in PROPERTIES
                }
                report["distinct:font-size"] = sorted(distinct(page, "font-size"))
                report["distinct:font-family"] = sorted(distinct(page, "font-family"))
                report["distinct:border-radius"] = sorted(distinct(page, "border-radius"))
                report["distinct:box-shadow"] = sorted(distinct(page, "box-shadow"))
                report["distinct:color"] = sorted(distinct(page, "color"))

            # Glyph atlas
            page.get_by_role("button", name="BF11 atlas").first.click()
            page.wait_for_timeout(400)
            page.locator("button.bit").nth(90).click()
            page.wait_for_timeout(700)
            shoot(page, f"{label}-06-glyph")
            report[f"{label}:glyph"] = {"overflow": overflow(page)}

            # PNG image
            page.get_by_role("button", name="PNG plate").first.click()
            page.wait_for_timeout(500)
            page.locator("button.bit").nth(20).click()
            page.wait_for_timeout(900)
            shoot(page, f"{label}-07-png")
            report[f"{label}:png"] = {"overflow": overflow(page)}

            # Raw, undecodable format
            page.get_by_role("button", name="Raw block").first.click()
            page.wait_for_timeout(400)
            page.locator("button.bit").nth(30).click()
            page.wait_for_timeout(600)
            shoot(page, f"{label}-08-raw-unclassified")
            report[f"{label}:raw"] = {"overflow": overflow(page)}

            # Butterfly — sweep the structured record, which has several
            # distinct consequences, rather than the format with no decoder.
            # Reload first so the sample buttons are in the empty state, which
            # is reachable at every viewport without scrolling.
            page.goto(URL, wait_until="networkidle")
            page.get_by_role("button", name="BLAB record", exact=True).first.click()
            page.wait_for_timeout(400)
            page.get_by_role("button", name="Butterfly").click()
            page.wait_for_timeout(300)
            shoot(page, f"{label}-09-butterfly-idle")
            page.get_by_role("button", name="64", exact=True).first.click()
            page.wait_for_timeout(150)
            page.get_by_role("button", name="Run sweep of 64").click()
            page.wait_for_timeout(4000)
            shoot(page, f"{label}-10-butterfly-result")
            report[f"{label}:butterfly"] = {"overflow": overflow(page)}

            # Experiments — with records present, so the log is exercised
            # in its populated state rather than only its empty state.
            page.get_by_role("button", name="Lab", exact=True).click()
            page.wait_for_timeout(300)
            page.locator("button.bit").first.click()
            page.wait_for_timeout(600)
            page.locator("button.bit").nth(40).click()
            page.wait_for_timeout(600)
            page.get_by_role("button", name=re.compile("Experiments")).click()
            page.wait_for_timeout(300)
            shoot(page, f"{label}-11-experiments")
            report[f"{label}:experiments"] = {"overflow": overflow(page)}

            # About
            page.get_by_role("button", name="About").click()
            page.wait_for_timeout(300)
            shoot(page, f"{label}-12-about")
            report[f"{label}:about"] = {"overflow": overflow(page)}
            report[f"{label}:page-widths"] = page_widths(page)

            # Inspector row integrity, checked on a format with many bytes.
            page.get_by_role("button", name="Lab", exact=True).click()
            page.wait_for_timeout(200)
            page.get_by_role("button", name="PNG plate").first.click()
            page.wait_for_timeout(400)
            report[f"{label}:inspector-rows"] = row_integrity(page)

            # A viewport-only capture, so sticky chrome is rendered where it
            # actually sits rather than where a full-page stitch puts it.
            page.get_by_role("button", name="BF11 atlas").first.click()
            page.wait_for_timeout(400)
            page.locator("button.bit").nth(90).click()
            page.wait_for_timeout(700)
            page.evaluate("() => window.scrollTo(0, 0)")
            page.wait_for_timeout(200)
            shoot(page, f"{label}-13-viewport-top", full_page=False)

            page.close()
            context.close()
            browser.close()

        audit_measurements(p, report)

    report["console_errors"] = errors
    (OUT / "audit.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2)[:4000])


if __name__ == "__main__":
    main()