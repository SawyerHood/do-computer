#!/usr/bin/env python3
"""Audit fixed filenames, reference bytes, score schemas and timing files across all rounds."""
import hashlib,json,pathlib,sys
root=pathlib.Path(sys.argv[1]); rounds=sorted((p for p in root.iterdir() if p.is_dir() and p.name.startswith('r') and p.name[1:].isdigit()),key=lambda p:int(p.name[1:]))
base={p.name for p in (rounds[0]/'images').glob('*.png')}
refs={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in (rounds[0]/'images').glob('*.png') if not p.name.startswith('do-computer-')}
for r in rounds:
 assert base=={p.name for p in (r/'images').glob('*.png')},f'Views changed: {r}'
 for name,sha in refs.items():assert hashlib.sha256((r/'images'/name).read_bytes()).hexdigest()==sha,f'Reference changed: {r}/{name}'
 for j in ['codex','claude','gemini']:
  d=json.loads((r/f'{j}.json').read_text())
  assert set(d['scores'])=={'do_computer','grok_bot','meta_muse'}
  for scores in d['scores'].values():
   assert len(scores)==7 and all(isinstance(v,(int,float)) and 1<=v<=10 for v in scores.values())
  assert len(d['issues'])==8
 assert (r/'start.txt').exists() and (r/'end.txt').exists()
 print(f'{r.name}: 16 app images, {len(refs)} unchanged refs, 3 valid judges, start/end recorded')
