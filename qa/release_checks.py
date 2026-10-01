"""
Targeted release checks.

Each item below is verified against the rendered application rather than
against its source, because that is the only way the corresponding class of
defect is visible.
"""

import json
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173"
results = {}


def check(name, value, expected=None):
    ok = value == expected if expected is not None else bool(value)
    results[name] = {"pass": ok, "value": value, "expected": expected}
    return ok


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))

    # ── 1. No overlapping virtualised rows, at every width ──
    violations = {}
    for width in (1440, 1024, 834, 390):
        page.set_viewport_size({"width": width, "height": 900})
        page.goto(URL, wait_until="networkidle")
        page.get_by_role("button", name="PNG plate", exact=True).first.click()
        page.wait_for_selector(".inspector")
        violations[width] = page.evaluate(
            """() => [...document.querySelectorAll('.inspector__row')].filter(r => {
                const b = r.getBoundingClientRect();
                const low = Math.max(...[...r.querySelectorAll('.byte')]
                    .map(e => e.getBoundingClientRect().bottom));
                return low > b.bottom + 0.5;
            }).length"""
        )
    check("rows_no_overlap", violations, {1440: 0, 1024: 0, 834: 0, 390: 0})

    # ── 2. MSB-first highlighting: the flipped cell index must match the
    #      bit's position from the left, not its machine shift index ──
    page.set_viewport_size({"width": 1440, "height": 900})
    page.goto(URL, wait_until="networkidle")
    page.get_by_role("button", name="BLAB record", exact=True).first.click()
    page.wait_for_selector(".inspector")
    page.locator('button.bit[data-bit="100"]').click()
    page.wait_for_selector(".bitfield__bit--changed")

    expected_index = 100 % 8  # MSB-first: position from the left
    actual = page.evaluate(
        """() => {
            const cells = [...document.querySelectorAll('.flip__stage')]
              .filter(s => !s.innerText.includes('ORIGINAL') || true);
            const mutated = document.querySelectorAll('.flip__stage')[1];
            return [...mutated.querySelectorAll('.bitfield__bit')]
                .findIndex(e => e.classList.contains('bitfield__bit--changed'));
        }"""
    )
    check("msb_first_highlight_index", actual, expected_index)

    # ── 3. Bit index labels agree between the two panels that report them ──
    detail_rows = page.locator(".readout__row", has_text="Bit from left")
    detail_value = detail_rows.nth(0).locator(".readout__value").inner_text().strip()
    measurement_value = detail_rows.nth(1).locator(".readout__value").inner_text().strip()
    check("bit_index_labels_agree", detail_value == measurement_value, True)
    check("bit_index_value", detail_value, f"{expected_index} of 7")

    # ── 4. Roving tabindex: exactly one tab stop, and it moves ──
    stop_count = page.locator("button.bit[tabindex='0']").count()
    check("roving_tabindex_single_stop", stop_count, 1)

    tabbable_total = page.evaluate(
        """() => [...document.querySelectorAll('button.bit')]
            .filter(b => b.tabIndex >= 0).length"""
    )
    check("roving_tabindex_total_tabbable_bits", tabbable_total, 1)

    page.locator('button.bit[data-bit="0"]').focus()
    page.keyboard.press("ArrowRight")
    # Focus moves inside a requestAnimationFrame, and the measurement resolves
    # asynchronously afterwards, so wait for the settled state rather than
    # reading it on the next tick.
    try:
        page.wait_for_function(
            "() => document.activeElement?.getAttribute('data-bit') === '1'", timeout=5000
        )
        moved = "1"
    except Exception:
        moved = page.evaluate("() => document.activeElement?.getAttribute('data-bit')")
    check("arrow_key_moves_within_grid", moved, "1")

    # ── 5. Mutation-destroyed data yields a real failure state, not a
    #      misleading "no renderer" message ──
    page.goto(URL, wait_until="networkidle")
    page.get_by_role("button", name="PNG plate", exact=True).first.click()
    page.wait_for_selector(".inspector")
    page.locator('button.bit[data-bit="20"]').click()
    page.wait_for_timeout(600)
    check(
        "decode_loss_message",
        page.get_by_text("The mutated data no longer decodes").count() > 0,
        True,
    )
    check(
        "misleading_renderer_message_absent",
        page.get_by_text("No renderer for this format.").count() == 0,
        True,
    )
    check(
        "original_still_rendered",
        page.get_by_role("img", name="Original").count() > 0,
        True,
    )
    check(
        "located_failure_reason_shown",
        "signature does not match" in page.locator(".state__body").first.inner_text(),
        True,
    )

    # ── 6. No empty grid tracks: every view must fill its grid ──
    empty_tracks = {}
    for label in ("Lab", "Butterfly", "Experiments", "About"):
        page.goto(URL, wait_until="networkidle")
        if label != "Lab":
            page.get_by_role("button", name=label, exact=True).click()
            page.wait_for_timeout(250)
        empty_tracks[label] = page.evaluate(
            """() => {
                const ws = document.querySelector('main > div');
                if (!ws) return 'no wrapper';
                const cs = getComputedStyle(ws);
                if (cs.display.indexOf('grid') === -1) {
                    return { display: cs.display, notApplicable: true };
                }
                const cols = cs.gridTemplateColumns.split(' ').length;
                // Only laid-out children occupy a track; a closed <dialog> and
                // display:none elements do not.
                const laid = [...ws.children].filter(c => {
                    const r = c.getBoundingClientRect();
                    return r.width > 0 && r.height > 0;
                });
                const occupied = new Set(laid.map(c => Math.round(c.getBoundingClientRect().left)));
                return { display: cs.display, tracks: cols, laidOutChildren: laid.length, tracksOccupied: occupied.size };
            }"""
        )
    check(
        "no_empty_grid_tracks",
        all(
            v.get("notApplicable") or v["tracksOccupied"] == v["tracks"]
            for v in empty_tracks.values()
            if isinstance(v, dict)
        ),
        True,
    )
    results["grid_tracks_detail"] = empty_tracks

    # ── 7. Responsive: no horizontal page scroll anywhere ──
    overflow = {}
    for width in (1440, 1024, 834, 390):
        page.set_viewport_size({"width": width, "height": 900})
        for view in ("Lab", "Butterfly", "Experiments", "About"):
            page.goto(URL, wait_until="networkidle")
            if view != "Lab":
                page.get_by_role("button", name=view, exact=True).click()
                page.wait_for_timeout(200)
            overflow[f"{width}/{view}"] = page.evaluate(
                "() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1"
            )
    check("responsive_no_horizontal_scroll", any(overflow.values()), False)
    results["overflow_detail"] = {k: v for k, v in overflow.items() if v}

    browser.close()

    check("no_console_errors", errors, [])

print(json.dumps(results, indent=2))
failed = [k for k, v in results.items() if isinstance(v, dict) and v.get("pass") is False]
print("\nFAILED:", failed if failed else "none")
