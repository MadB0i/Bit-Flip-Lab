"""
Accessibility audit.

Three passes, as the skill requires: an automated scan, a keyboard walk, and a
reduced-motion check. Each reports findings with a location so they can be
fixed rather than noted.
"""

import json
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173"
OUT = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else "qa/out")
AXE = "https://cdn.jsdelivr.net/npm/axe-core@4/axe.min.js"

AXE_RESULT = """async () => {
  const r = await axe.run(document, {
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
  });
  return r.violations.map(v => ({
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.slice(0, 3).map(n => ({ target: n.target, summary: (n.failureSummary || '').split('\\n')[1] || '' })),
    count: v.nodes.length,
  }));
}"""

FOCUS_PROBE = """() => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const s = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName,
    name: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 32),
    outline: s.outlineStyle,
    outlineWidth: s.outlineWidth,
    inViewport: r.top >= 0 && r.bottom <= window.innerHeight,
  };
}"""


def contrast_probe():
    """Every text colour against its own background, computed in-page."""
    return """() => {
  const lum = (c) => {
    const [r, g, b] = c.map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (s) => (s.match(/[\\d.]+/g) || []).slice(0, 3).map(Number);
  const bgOf = (el) => {
    for (let n = el; n; n = n.parentElement) {
      const bg = getComputedStyle(n).backgroundColor;
      if (bg && !/rgba\\(0, 0, 0, 0\\)|transparent/.test(bg)) return parse(bg);
    }
    return [11, 13, 16];
  };
  const bad = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('*')) {
    if (!el.childNodes.length) continue;
    const hasText = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || Number(s.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const fg = parse(s.color);
    const bg = bgOf(el);
    const l1 = lum(fg), l2 = lum(bg);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    const size = parseFloat(s.fontSize);
    const weight = Number(s.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const required = large ? 3 : 4.5;
    const key = s.color + '|' + bg.join(',') + '|' + Math.round(size);
    if (ratio < required && !seen.has(key)) {
      seen.add(key);
      bad.push({ color: s.color, bg: 'rgb(' + bg.join(',') + ')', size, ratio: +ratio.toFixed(2), required,
                 sample: el.textContent.trim().slice(0, 24) });
    }
  }
  return bad;
}"""


def main():
    findings = {}
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": 1440, "height": 900})
        page.goto(URL, wait_until="networkidle")

        # ── Pass 1: empty state ──
        page.add_script_tag(url=AXE)
        findings["axe:empty"] = page.evaluate(AXE_RESULT)
        findings["contrast:empty"] = page.evaluate(contrast_probe())

        # ── Pass 2: active experiment ──
        page.get_by_role("button", name="BF11 atlas").first.click()
        page.wait_for_timeout(300)
        page.locator("button.bit").nth(90).click()
        page.wait_for_timeout(600)
        findings["axe:experiment"] = page.evaluate(AXE_RESULT)
        findings["contrast:experiment"] = page.evaluate(contrast_probe())

        # ── Pass 3: keyboard walk ──
        page.keyboard.press("Tab")  # leave the focused bit
        sequence = []
        for _ in range(60):
            page.keyboard.press("Tab")
            info = page.evaluate(FOCUS_PROBE)
            if info:
                sequence.append(info)
        invisible = [s for s in sequence if s["outline"] == "none" or s["outlineWidth"] == "0px"]
        findings["keyboard"] = {
            "stops": len(sequence),
            "withoutVisibleFocus": len(invisible),
            "sample": invisible[:4],
            "firstEight": sequence[:8],
        }

        # ── Pass 4: reduced motion ──
        rm = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
        rm_page = rm.new_page()
        rm_page.goto(URL, wait_until="networkidle")
        rm_page.get_by_role("button", name="BLAB record").first.click()
        rm_page.wait_for_timeout(300)
        rm_page.locator("button.bit").first.click()
        rm_page.wait_for_timeout(400)
        findings["reducedMotion"] = rm_page.evaluate(
            """() => {
                const el = document.querySelector('.causal__fill');
                const s = el ? getComputedStyle(el) : null;
                return {
                    transitionDuration: s ? s.transitionDuration : null,
                    severityStillVisible:
                        !!document.body.innerText.match(/Critical|Major|Minor|Negligible|Unclassified/),
                };
            }"""
        )
        rm_page.screenshot(path=str(OUT / "reduced-motion.png"), full_page=False)

        # ── Pass 5: dialog focus behaviour ──
        page.get_by_role("button", name=re.compile("Experiments")).click()
        page.wait_for_timeout(300)
        record = page.locator("button.row-button").first
        if record.count():
            record.click()
            page.wait_for_timeout(400)
            findings["dialog"] = page.evaluate(
                """() => {
                    const d = document.querySelector('dialog.sheet');
                    if (!d) return { open: false };
                    const focus = document.activeElement;
                    return {
                        open: d.open,
                        modal: d.matches(':modal'),
                        focusInside: d.contains(focus),
                        focusLabel: (focus?.getAttribute('aria-label') || focus?.textContent || '').trim().slice(0, 30),
                    };
                }"""
            )
            page.keyboard.press("Escape")
            page.wait_for_timeout(300)
            findings["dialog"]["closedByEscape"] = page.evaluate(
                "() => !document.querySelector('dialog.sheet')?.open"
            )

        browser.close()

    (OUT / "a11y.json").write_text(json.dumps(findings, indent=2), encoding="utf-8")
    print(json.dumps(findings, indent=2)[:6000])


if __name__ == "__main__":
    main()
