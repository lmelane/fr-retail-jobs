#!/usr/bin/env python3
"""Lecture polie et bornée d'une page publique (D-483) : robots.txt d'abord, puis la page, sous CatwalksBot.

    python3 lire-page.py <url> [--motif=<regex du texte visible>]... [--liens=<regex de chemin>] [--zoho]

Imprime : verdict robots pour CatwalksBot, statut, adresse finale, taille, empreinte, nombre de JobPosting, lignes du
texte VISIBLE qui portent un motif, liens de même origine dont le chemin porte le motif de liens, et (--zoho) les offres
de la liste JSON qu'une page Zoho Recruit embarque. Deux requêtes, une seconde d'écart. Aucun corps n'est conservé.
"""
import hashlib, html, json, re, sys, time, urllib.parse, urllib.request, urllib.robotparser

UA = 'CatwalksBot/1.0 (+https://catwalks.io/bot)'
args = [a for a in sys.argv[1:] if not a.startswith('--')]
motifs = [a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--motif=')]
liens = next((a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--liens=')), None)
if len(args) != 1:
    sys.exit(__doc__)
url = args[0]
origin = '{0.scheme}://{0.netloc}'.format(urllib.parse.urlsplit(url))


def get(target):
    req = urllib.request.Request(target, headers={'User-Agent': UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.status, r.geturl(), r.read()


status, _, body = get(origin + '/robots.txt')
rp = urllib.robotparser.RobotFileParser()
rp.parse(body.decode('utf-8', 'replace').splitlines())
allowed = rp.can_fetch(UA, url)
print(f'robots.txt {origin}/robots.txt : HTTP {status}, CatwalksBot {"AUTORISÉ" if allowed else "REFUSÉ"} sur {urllib.parse.urlsplit(url).path}')
if not allowed:
    sys.exit(0)
time.sleep(1.2)
status, final, raw = get(url)
page = raw.decode('utf-8', 'replace')
print(f'page {url} : HTTP {status}, finale {final}, {len(raw)} octets, sha256 {hashlib.sha256(raw).hexdigest()}')
print(f'JobPosting (mot) : {page.count("JobPosting")} ; blocs application/ld+json : {len(re.findall(r"application/ld\+json", page))}')
visible = re.sub(r'(?is)<(script|style|noscript|template|svg)[^>]*>.*?</\1>', ' ', page)
visible = re.sub(r'(?s)<!--.*?-->', ' ', visible)
lines = [l.strip() for l in html.unescape(re.sub(r'<[^>]+>', '\n', visible)).split('\n') if l.strip()]
for motif in motifs:
    hits = [l for l in lines if re.search(motif, l, re.I)]
    print(f'texte visible /{motif}/ : {len(hits)}')
    for l in hits[:12]:
        print('   ', l[:200])
if liens:
    found = set()
    for h in re.findall(r'<a\b[^>]*\shref="([^"]*)"', page):
        u = urllib.parse.urljoin(final, html.unescape(h))
        p = urllib.parse.urlsplit(u)
        if f'{p.scheme}://{p.netloc}' == origin and re.search(liens, p.path, re.I):
            found.add(u)
    print(f'liens de même origine /{liens}/ : {len(found)}')
    for u in sorted(found)[:20]:
        print('   ', u)
if '--zoho' in sys.argv:
    m = re.search(r'<input type="hidden" value="([^"]*)"\s*id="jobs"', page)
    jobs = json.loads(html.unescape(m.group(1))) if m else None
    meta = re.search(r'<input type="hidden" value="([^"]*)"\s*id="meta"', page)
    company = json.loads(html.unescape(meta.group(1))).get('org_info', {}).get('company_name') if meta else None
    print(f'Zoho Recruit : société déclarée {company!r}, {len(jobs) if jobs is not None else "AUCUNE"} offre(s) dans la liste embarquée')
    for j in jobs or []:
        print(f"    {j.get('id')} | {j.get('Posting_Title')} | {j.get('City')}, {j.get('Country')} | Publish={j.get('Publish')}")
