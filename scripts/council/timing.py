#!/usr/bin/env python3
import pathlib,datetime,sys
root=pathlib.Path(sys.argv[1])
print('| Round | Start (UTC) | End (UTC) | Wall time |')
print('| ---: | --- | --- | ---: |')
for r in sorted((p for p in root.iterdir() if p.is_dir() and p.name.startswith('r') and p.name[1:].isdigit()),key=lambda p:int(p.name[1:])):
 if not (r/'end.txt').exists():continue
 start=(r/'start.txt').read_text().strip();end=(r/'end.txt').read_text().strip()
 secs=int((datetime.datetime.fromisoformat(end)-datetime.datetime.fromisoformat(start)).total_seconds())
 print(f'| {r.name[1:]} | {start} | {end} | {secs//60}m {secs%60}s |')
