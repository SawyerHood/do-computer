#!/usr/bin/env python3
"""The council's scores, round by round, as Markdown: one table per judge, a row per app and
round, a column per category. Usage: scripts/council/table.py .council/rounds"""
import json
import os
import sys

CATEGORIES = ["hierarchy", "typography", "iconography", "color_contrast", "spacing_layout", "consistency", "polish"]
HEADERS = ["Hierarchy", "Typography", "Icons", "Color", "Spacing", "Consistency", "Polish"]
APPS = [("do_computer", "Do Computer"), ("grok_bot", "Grok Bot"), ("meta_muse", "Meta Muse")]
JUDGES = [("codex", "Codex judge (GPT)"), ("claude", "Claude judge (Opus)"), ("gemini", "Gemini judge (Gemini 4 Argon High)")]

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
            low = min(v for v in values if isinstance(v, (int, float)))
            cells = [f"{v:g}" if isinstance(v, (int, float)) else "?" for v in values]
            label = f"**{name}**" if key == "do_computer" else name
            lines.append(f"| {r[1:]} | {label} | " + " | ".join(cells) + f" | {low:g} |")
    if lines:
        print(f"#### {title}\n")
        print("| Round | App | " + " | ".join(HEADERS) + " | Lowest |")
        print("| ---: | --- | " + " | ".join("---:" for _ in HEADERS) + " | ---: |")
        print("\n".join(lines))
        print()
