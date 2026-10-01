"""
Release check for the README itself.

Fails if the README references an image that is not in the repository, or a
command that is not in package.json. A broken asset path renders as a blank
box on GitHub, and a documented command that does not exist is worse than
silence.
"""

import json
import pathlib
import re
import sys

README = pathlib.Path("README.md")
PKG = pathlib.Path("package.json")

readme = README.read_text(encoding="utf-8")
pkg = json.loads(PKG.read_text(encoding="utf-8"))
scripts = set(pkg["scripts"])

failures = []

# ── image paths ──
images = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", readme)
print(f"image references: {len(images)}")
for ref in sorted(set(images)):
    if ref.startswith(("http://", "https://")):
        continue
    path = README.parent / ref
    ok = path.is_file()
    size = path.stat().st_size if ok else 0
    print(f"  {'OK ' if ok else 'MISSING'}  {ref}  ({size:,} B)")
    if not ok:
        failures.append(f"missing image: {ref}")

# ── commands ──
commands = sorted(set(re.findall(r"npm run ([a-z0-9:]+)", readme)))
print(f"\ncommand references: {len(commands)}")
for cmd in commands:
    ok = cmd in scripts
    print(f"  {'OK ' if ok else 'MISSING'}  npm run {cmd}")
    if not ok:
        failures.append(f"documented command does not exist: npm run {cmd}")

# ── unreferenced committed assets ──
doc_assets = sorted(p.name for p in pathlib.Path("docs").iterdir() if p.is_file())
referenced = {pathlib.Path(i).name for i in images}
orphans = [a for a in doc_assets if a not in referenced]
print(f"\ndocs/ assets: {len(doc_assets)}")
for a in doc_assets:
    print(f"  {'referenced' if a in referenced else 'ORPHAN  '}  {a}")
for o in orphans:
    failures.append(f"unreferenced asset: docs/{o}")

# ── prohibited content ──
banned = {
    "first-ever claim": re.compile(r"\b(first[- ]ever|world'?s first|the first ever)\b", re.I),
    "unique/unprecedented claim": re.compile(r"\b(unique|unprecedented|only tool|only way)\b", re.I),
    "AI marketing": re.compile(r"\b(ai[- ]powered|powered by ai|ai-powered)\b", re.I),
    "emoji": re.compile(r"[\U0001F300-\U0001FAFF☀-➿]"),
}
print()
for label, pattern in banned.items():
    hits = pattern.findall(readme)
    print(f"  {'FOUND' if hits else 'clean'}  {label}: {hits[:4] if hits else ''}")
    if hits:
        failures.append(f"{label}: {hits[:4]}")

print("\n" + ("FAILED:\n  " + "\n  ".join(failures) if failures else "README: all references resolve"))
sys.exit(1 if failures else 0)
