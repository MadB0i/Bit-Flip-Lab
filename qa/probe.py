"""Targeted probe: which elements introduce an off-system value?"""

import json
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:4173"

PROBE = """() => {
  const out = { fontSize: {}, fontFamily: {}, padding: {}, pageOverflow: null, scrollContainers: [] };

  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const id = el.tagName.toLowerCase() + (el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\\s+/).join('.') : '');

    out.fontSize[cs.fontSize] = out.fontSize[cs.fontSize] || [];
    out.fontSize[cs.fontSize].push(id);

    out.fontFamily[cs.fontFamily] = out.fontFamily[cs.fontFamily] || [];
    out.fontFamily[cs.fontFamily].push(id);

    const p = cs.padding;
    if (p && p !== '0px') {
      out.padding[p] = out.padding[p] || [];
      out.padding[p].push(id);
    }

    if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') {
      out.scrollContainers.push(id + ' scrollWidth=' + el.scrollWidth + ' clientWidth=' + el.clientWidth);
    }
  }

  out.pageOverflow = {
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
  };
  return out;
}"""


def summarise(values, limit=6):
    return {k: v[:limit] for k, v in sorted(values.items())}


with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})
    page.goto(URL, wait_until="networkidle")
    page.get_by_role("button", name="BLAB record").first.click()
    page.wait_for_timeout(400)
    page.locator("button.bit").first.click()
    page.wait_for_timeout(700)

    data = page.evaluate(PROBE)
    print("== PAGE OVERFLOW ==")
    print(json.dumps(data["pageOverflow"], indent=2))
    print("== SCROLL CONTAINERS ==")
    for s in data["scrollContainers"]:
        print("  ", s)
    print("== FONT SIZES ==")
    print(json.dumps(summarise(data["fontSize"]), indent=2))
    print("== FONT FAMILIES ==")
    print(json.dumps(summarise(data["fontFamily"]), indent=2))
    print("== PADDING ==")
    print(json.dumps(summarise(data["padding"], 4), indent=2))
    browser.close()