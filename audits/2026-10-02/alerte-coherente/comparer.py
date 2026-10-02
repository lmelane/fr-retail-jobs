"""Lecture D-492 du 02/10/2026 (alerte cohérente) — compare l'examen à blanc AVANT (origin/development 23c5e42) et APRÈS
(le correctif) sur la même grille (`grille-80.json`, les 63 puis les 17 faibles), mesurés à quelques secondes d'écart en
lecture seule. python3 comparer.py resultats/avant.json resultats/apres.json"""
import json, sys
avant, apres = (json.load(open(f)) for f in sys.argv[1:3])
assert len(avant) == len(apres) == 80
def bloc(nom, paires):
    err = [a for p in paires for a in p if 'erreur' in a]
    print(f'== {nom} : {len(paires)} alertes, {len(err)} en erreur')
    if err: return
    for cle in ('total', 'certaines', 'incompletes'):
        print(f'   {cle:12} avant {sum(a[cle] for a, _ in paires):6}   après {sum(b[cle] for _, b in paires):6}')
    print(f'   alertes avec incomplètes : avant {sum(1 for a, _ in paires if a["incompletes"])}, après {sum(1 for _, b in paires if b["incompletes"])}')
    print(f'   alertes SANS certaine mais avec incomplètes : avant {sum(1 for a, _ in paires if a["incompletes"] and not a["certaines"])}, '
          f'après {sum(1 for _, b in paires if b["incompletes"] and not b["certaines"])}')
    diff = [(a, b) for a, b in paires if (a['total'], a['certaines'], a['certainesLues']) != (b['total'], b['certaines'], b['certainesLues'])]
    print(f'   certaines différentes : {len(diff)}')
    print(f'   violations : avant {sum(len(v) for a, _ in paires for v in a["violations"].values())}, après {sum(len(v) for _, b in paires for v in b["violations"].values())}')
    return paires
paires = list(zip(avant, apres))
for a, b in paires: assert a['criteres'] == b['criteres']
bloc('les 63 (métier et lieu posés)', paires[:63])
faibles = bloc('les 17 faibles (contrat ou temps seuls, sans métier ni lieu)', paires[63:])
print('== par alerte faible : certaines avant/après | incomplètes avant/après')
for a, b in paires[63:]:
    c = a['criteres']
    print(f"   {c['marche']:3} {json.dumps(c['filtres'], ensure_ascii=False):50} {a.get('certaines')}/{b.get('certaines')} | {a.get('incompletes')}/{b.get('incompletes')}")
