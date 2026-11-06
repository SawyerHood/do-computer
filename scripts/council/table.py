#!/usr/bin/env python3
"""The council's scores, round by round, as Markdown: one table per judge, a row per app and
round, a column per category. Usage: scripts/council/table.py .council/rounds"""
import json
import os
import sys

CATEGORIES = ["hierarchy", "typography", "iconography", "color_contrast", "spacing_layout", "consistency", "polish"]
HEADERS = ["Hierarchy", "Typography", "Icons", "Color", "Spacing", "Consistency", "Polish"]
APPS = [("do_computer", "Do Computer"), ("grok_bot", "Grok Bot"), ("muse", "Muse")]
JUDGES = [("codex", "GPT (codex on omarchy)"), ("claude", "Opus (cursor-agent claude-opus-5-5-high)"), ("gemini", "Gemini (cursor-agent gemini-4-argon-high)")]

root = sys.argv[1]
rounds = sorted((d for d in os.listdir(root) if d.startswith("r") and d[1:].isdigit()), key=lambda d: int(d[1:]))
for judge, title in JUDGES:
    lines = []
    for r in rounds:
        path = os.path.join(root, r, f"{judge}.json")
        if not os.path.exists(path):
            continue
        scores = json.load(open(path))["scores"]
        for key, name in APPS:
            row = scores.get(key, {})
            values = [row.get(c) for c in CATEGORIES]
            numbers = [v for v in values if isinstance(v, (int, float))]
            low = min(numbers)
            avg = sum(numbers) / len(numbers)
            cells = [f"{v:g}" if isinstance(v, (int, float)) else "?" for v in values]
            label = f"**{name}**" if key == "do_computer" else name
            lines.append(f"| {r[1:]} | {label} | " + " | ".join(cells) + f" | {low:g} | {avg:.2f} |")
    if lines:
        print(f"#### {title}\n")
        print("| Round | App | " + " | ".join(HEADERS) + " | Lowest | Avg |")
        print("| ---: | --- | " + " | ".join("---:" for _ in HEADERS) + " | ---: | ---: |")
        print("\n".join(lines))
        print()

# Do Computer's average per judge, round by round, beside the best reference app's.
print("#### Do Computer average by round\n")
print("| Round | " + " | ".join(f"{t.split(' (')[0]}: DC / best ref" for _, t in JUDGES) + " | Started | Judged |")
print("| ---: | " + " | ".join("---" for _ in JUDGES) + " | --- | --- |")
for r in rounds:
    cells = []
    for judge, _ in JUDGES:
        path = os.path.join(root, r, f"{judge}.json")
        if not os.path.exists(path):
            cells.append("–")
            continue
        scores = json.load(open(path))["scores"]
        avg = lambda key: sum(scores[key][c] for c in CATEGORIES) / len(CATEGORIES)
        cells.append(f"{avg('do_computer'):.2f} / {max(avg(k) for k, _ in APPS[1:]):.2f}")
    times = [open(os.path.join(root, r, f)).read().strip() if os.path.exists(os.path.join(root, r, f)) else "" for f in ("started.txt", "judged-end.txt")]
    print(f"| {r[1:]} | " + " | ".join(cells) + f" | {times[0]} | {times[1]} |")
