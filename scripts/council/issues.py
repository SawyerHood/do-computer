#!/usr/bin/env python3
"""Print one round's real feedback without the prompt or raw model chatter."""
import json,pathlib,sys
root=pathlib.Path(sys.argv[1])
for judge in ['codex','claude','gemini']:
 p=root/f'{judge}.json'
 if not p.exists():continue
 data=json.loads(p.read_text());own=data['scores']['do_computer']
 print(f'\n## {judge} ({sum(own.values())/len(own):.3f})')
 for i,issue in enumerate(data['issues'],1):
  print(f'{i}. {issue["element"]}\n   {issue["fix"]}')
