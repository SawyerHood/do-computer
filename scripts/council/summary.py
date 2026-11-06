#!/usr/bin/env python3
"""Compact per-round Do Computer averages; full category tables are in table.py."""
import json,pathlib,sys
root=pathlib.Path(sys.argv[1])
print('| Round | GPT | Opus | Gemini |')
print('| ---: | ---: | ---: | ---: |')
for r in sorted((p for p in root.iterdir() if p.is_dir() and p.name.startswith('r') and p.name[1:].isdigit()),key=lambda p:int(p.name[1:])):
 values=[]
 for judge in ['codex','claude','gemini']:
  p=r/f'{judge}.json'
  if not p.exists():values.append('pending');continue
  s=json.loads(p.read_text())['scores']['do_computer'].values()
  values.append(f'{sum(s)/len(s):.3f}')
 print(f'| {r.name[1:]} | '+ ' | '.join(values)+' |')
