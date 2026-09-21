"""Sources ayant collecté sans jamais publier — sur le corpus, pas sur la production."""
import json, sys, pathlib, collections

c = pathlib.Path(sys.argv[1])
def lire(nom):
    with (c / f'{nom}.jsonl').open(encoding='utf8') as f:
        return [json.loads(l) for l in f if l.strip()]

srcs = {s['key']: s for s in lire('sources')}
lots = collections.Counter(l['sourceKey'] for l in lire('lots-collecte'))
pubs = collections.Counter(p['sourceKey'] for p in lire('publications'))

avec_lots, avec_pubs = set(lots), set(pubs)
muettes = sorted(avec_lots - avec_pubs)

print("═══ SOURCES : PUBLIÉES vs MUETTES ═══")
print(f"  référentiel                      : {len(srcs)}")
print(f"  ont collecté (au moins un lot)   : {len(avec_lots)}")
print(f"  ont publié                       : {len(avec_pubs)}")
print(f"  MUETTES (lots, zéro publication) : {len(muettes)}")
print(f"     lots concernés                : {sum(lots[k] for k in muettes)}")
print(f"  au référentiel SANS aucun lot    : {len(set(srcs) - avec_lots)}")

st = collections.Counter(srcs[k]['status'] for k in muettes if k in srcs)
print(f"\n  muettes par statut : {dict(st)}")
hors = [k for k in muettes if k not in srcs]
print(f"  muettes hors référentiel : {len(hors)}")

print("\n  les 12 muettes aux plus nombreux lots :")
for k in sorted(muettes, key=lambda x: -lots[x])[:12]:
    s = srcs.get(k, {})
    print(f"    {k[:44]:46} {lots[k]:>4} lots  {s.get('status','(hors référentiel)')}")
