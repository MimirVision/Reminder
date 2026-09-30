#!/usr/bin/env python3
"""Append translations to src/i18n/en.json and nb.json. Usage: python3 scripts/i18n-add.py < entries.txt
Each line: key<TAB>English<TAB>Norsk   (blank lines and # comments ignored)."""
import json, sys, collections
def load(p): return json.load(open(p), object_pairs_hook=collections.OrderedDict)
en, nb = load('src/i18n/en.json'), load('src/i18n/nb.json')
n = 0
for line in sys.stdin:
    line = line.rstrip('\n')
    if not line.strip() or line.lstrip().startswith('#'): continue
    parts = line.split('\t')
    if len(parts) != 3: sys.exit(f'bad line (need 3 tab-separated fields): {line!r}')
    k, e, b = parts
    en[k], nb[k] = e, b; n += 1
json.dump(en, open('src/i18n/en.json', 'w'), indent=2, ensure_ascii=False); open('src/i18n/en.json', 'a').write('\n')
json.dump(nb, open('src/i18n/nb.json', 'w'), indent=2, ensure_ascii=False); open('src/i18n/nb.json', 'a').write('\n')
print(f'{n} entries; en={len(en)} nb={len(nb)}')
