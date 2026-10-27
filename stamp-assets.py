#!/usr/bin/env python3
"""Cache-bust /assets/site.css on every page.

Netlify serves /assets/* with `max-age=31536000, immutable`, which is correct
ONLY for versioned filenames. Without a version token every returning visitor
keeps the stylesheet they cached for a year and never sees a design change.
This stamps the file's content hash into the link URL, so the URL changes
exactly when the file does. Run before every deploy.
"""
import hashlib, glob, os, re, sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))
h = hashlib.md5(open('assets/site.css', 'rb').read()).hexdigest()[:10]
pat = re.compile(r'href="/assets/site\.css(?:\?v=[0-9a-f]+)?"')
new = f'href="/assets/site.css?v={h}"'
n = 0
for f in glob.glob('**/*.html', recursive=True):
    s = open(f, encoding='utf-8').read()
    s2, c = pat.subn(new, s)
    if c and s2 != s:
        open(f, 'w', encoding='utf-8').write(s2)
        n += 1
missing = [f for f in glob.glob('**/*.html', recursive=True)
           if 'site.css' in open(f, encoding='utf-8').read()
           and f'site.css?v={h}' not in open(f, encoding='utf-8').read()]
print(f'site.css hash {h} stamped onto {n} page(s)')
if missing:
    print('WARNING - pages still on an unstamped stylesheet:', missing)
    sys.exit(1)
