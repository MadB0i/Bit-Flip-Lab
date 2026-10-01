"""Final release gate: summarise every QA measurement as pass/fail.

Reads the machine-readable artefacts written by qa/capture.py (npm run qa) and
qa/a11y.py (npm run qa:a11y), and asserts every measurement they recorded.

qa/release_checks.py re-checks invariants live in the DOM and so never inspects
these artefacts; this script is what stops the accessibility and visual audits
from being collected and then ignored. Run it after both of them.

Exits non-zero if any check fails.
"""

import json
import pathlib
import sys

ARTIFACTS = {
    "qa/out/audit.json": "npm run qa",
    "qa/out/a11y.json": "npm run qa:a11y",
}

missing = [f"{path} (generate it with: {cmd})" for path, cmd in ARTIFACTS.items() if not pathlib.Path(path).exists()]
if missing:
    print("release_gate: missing QA artefacts:")
    for entry in missing:
        print("  -", entry)
    sys.exit(1)

audit = json.loads(pathlib.Path("qa/out/audit.json").read_text(encoding="utf-8"))
a11y = json.loads(pathlib.Path("qa/out/a11y.json").read_text(encoding="utf-8"))

overflow_views = sum(1 for v in audit.values() if isinstance(v, dict) and v.get("overflow"))
row_overlaps = sum(len(v["violations"]) for k, v in audit.items() if k.endswith("inspector-rows"))
page_scrolls = sum(1 for v in audit.values() if isinstance(v, dict) and v.get("pageScrollsHorizontally"))

CHECKS = [
    ("console errors during QA", len(audit["console_errors"]), 0),
    ("axe violations — empty state", len(a11y["axe:empty"]), 0),
    ("axe violations — active experiment", len(a11y["axe:experiment"]), 0),
    ("computed contrast failures — empty", len(a11y["contrast:empty"]), 0),
    ("computed contrast failures — experiment", len(a11y["contrast:experiment"]), 0),
    ("tab stops without a visible focus ring", a11y["keyboard"]["withoutVisibleFocus"], 0),
    ("undersized touch targets (coarse pointer)", audit["mobile-touch:target-sizes"]["undersized"], 0),
    ("views with horizontal overflow", overflow_views, 0),
    ("viewports scrolling horizontally", page_scrolls, 0),
    ("virtualised inspector row overlaps", row_overlaps, 0),
]

def to_ms(css_time: str) -> float:
    """Parse a CSS time such as '1e-05s' or '0ms' into milliseconds."""
    value = float("".join(ch for ch in str(css_time) if ch.isdigit() or ch in ".e-"))
    return value * 1000 if str(css_time).strip().endswith("s") else value


reduced = to_ms(a11y["reducedMotion"]["transitionDuration"])

failed = []
print("FINAL RELEASE GATE")
print("-" * 62)
for label, actual, allowed in CHECKS:
    ok = actual <= allowed
    failed += [] if ok else [label]
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<46} {actual}")

TRUTHY = [
    ("dialog opens modal and closes on Escape", a11y["dialog"]["closedByEscape"]),
    ("severity readable with motion disabled", a11y["reducedMotion"]["severityStillVisible"]),
]
for label, value in TRUTHY:
    ok = bool(value)
    failed += [] if ok else [label]
    print(f"  {'PASS' if ok else 'FAIL'}  {label:<46} {value}")

ok = reduced < 1.0
failed += [] if ok else ["reduced motion honoured"]
print(f"  {'PASS' if ok else 'FAIL'}  {'reduced motion honoured (<1ms)':<46} {reduced:.5f}ms")

print("-" * 62)
print("  distinct computed values            :", audit.get("distinct"))
print()
print("FAILED:", failed if failed else "none")
sys.exit(1 if failed else 0)
