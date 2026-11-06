#!/usr/bin/env python3
"""Validate the council, summarize it, and report (but never prompt judges with) the stop gate."""
import json,sys,pathlib
root=pathlib.Path(sys.argv[1])
passed=True
for judge in ['codex','claude','gemini']:
 p=root/f'{judge}.json'
 if not p.exists():
  print(f'{judge}: FAILED (missing JSON)');passed=False;continue
 scores=json.loads(p.read_text())['scores']
 own=scores['do_computer']; values=list(own.values())
 gate=all(v>=9 and v>scores['grok_bot'][c] and v>scores['meta_muse'][c] for c,v in own.items())
 passed=passed and gate
 print(f'{judge}: average={sum(values)/len(values):.3f} minimum={min(values):.1f} stop={gate}')
print('STOP' if passed else 'CONTINUE')
