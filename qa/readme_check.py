"""
Release check for the documentation.

Fails if the README references an image that is not in the repository, a link
that does not resolve, a command that is not in package.json, an orphaned asset,
or a prohibited claim. A broken asset path renders as a blank box on GitHub, and
a documented command that does not exist is worse than silence.
"""

import json
import pathlib
import re
import sys

ROOT = pathlib.Path(".")
README = ROOT / "README.md"
PKG = ROOT / "package.json"
DOCS = ROOT / "docs"

# Files that live in docs/ but are documentation rather than repository assets.
DOC_SUFFIXES = {".md"}

readme = README.read_text(encoding="utf-8")
pkg = json.loads(PKG.read_text(encoding="utf-8"))
scripts = set(pkg["scripts"])

failures = []

# ── image paths: markdown ![](...) and raw HTML <img src="..."> ──
images = re.findall(r"!\[[^\]]*\]\(([^)]+)\)", readme)
images += re.findall(r'<img[^>]+src="([^"]+)"', readme)
images = [i for i in images if not i.startswith(("http://", "https://"))]
print(f"image references: {len(images)}")
for ref in sorted(set(images)):
    path = ROOT / ref
    ok = path.is_file()
    size = path.stat().st_size if ok else 0
    print(f"  {'OK ' if ok else 'MISSING'}  {ref}  ({size:,} B)")
    if not ok:
        failures.append(f"missing image: {ref}")

# ── markdown links: [text](target), skipping anchors and external URLs ──
links = re.findall(r"(?<!!)\[[^\]]*\]\(([^)]+)\)", readme)
links = [
    l.split("#")[0]
    for l in links
    if not l.startswith(("http://", "https://", "mailto:", "#"))
]
print(f"\nlink targets: {len(links)}")
for ref in sorted(set(links)):
    path = (ROOT / ref).resolve()
    ok = path.is_file()
    print(f"  {'OK ' if ok else 'BROKEN'}  {ref}")
    if not ok:
        failures.append(f"broken link: {ref}")

# ── links inside the docs/ markdown files ──
def doc_files():
    return [README] + sorted(DOCS.glob("*.md"))


print("\ndocs/ internal links:")
checked = 0
for md in doc_files():
    body = md.read_text(encoding="utf-8")
    targets = re.findall(r"(?<!!)\[[^\]]*\]\(([^)]+)\)", body)
    targets += re.findall(r'<img[^>]+src="([^"]+)"', body)
    targets = [t.split("#")[0] for t in targets if t and not t.startswith(("http://", "https://", "mailto:", "#"))]
    for t in sorted(set(targets)):
        # Links inside docs/ are relative to docs/; README links are repo-relative.
        base = DOCS if md.parent == DOCS else ROOT
        ok = (base / t).is_file()
        checked += 1
        rel = t if md == README else f"{md.name} -> {t}"
        print(f"  {'OK ' if ok else 'BROKEN'}  {rel}")
        if not ok:
            failures.append(f"broken link in {md.as_posix()}: {t}")
print(f"  ({checked} target(s) checked across {len(doc_files())} markdown file(s))")

# ── commands ──
commands = sorted(set(re.findall(r"npm run ([a-z0-9:]+)", readme)))
print(f"\ncommand references: {len(commands)}")
for cmd in commands:
    ok = cmd in scripts
    print(f"  {'OK ' if ok else 'MISSING'}  npm run {cmd}")
    if not ok:
        failures.append(f"documented command does not exist: npm run {cmd}")

# ── unreferenced committed assets ──
# Documentation files in docs/ are counted as referenced if the README links to
# them; media assets must be embedded in the README. social-preview.png is the
# one deliberate exception: GitHub consumes it as social-card metadata, not as
# README content, so embedding it in the README would be wrong.
SOCIAL_CARD = "social-preview.png"
referenced_media = {pathlib.Path(i).name for i in images} | {SOCIAL_CARD}
linked_docs = {pathlib.Path(l).name for l in links}
orphans = []
print("\ndocs/ contents:")
for p in sorted(DOCS.iterdir()):
    if not p.is_file():
        continue
    if p.suffix.lower() in DOC_SUFFIXES:
        ok = p.name in linked_docs
        label = "linked" if ok else "ORPHAN  "
    elif p.name == SOCIAL_CARD:
        ok = True
        label = "social   "
    else:
        ok = p.name in referenced_media
        label = "referenced" if ok else "ORPHAN  "
    print(f"  {label}  {p.name}")
    if not ok:
        orphans.append(f"docs/{p.name}")
for o in orphans:
    failures.append(f"unreferenced file in docs/: {o}")

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
