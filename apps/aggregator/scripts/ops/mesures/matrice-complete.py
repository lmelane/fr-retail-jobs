"""Matrice Pays x Filtres : couverture mesurée, facette exposée, écart exploitable."""
import json, sys, pathlib, collections

SEUIL = 0.2
# dimension -> (colonne canonique, filtrable par l'API ?, facette possible ?)
DIMS = [
    ('contrat',     'employmentTerm', True,  True),
    ('temps',       'workTime',       True,  True),
    ('programme',   'programType',    True,  True),
    ('metier',      'occupationCode', True,  True),
    ('langue',      'language',       True,  True),
    ('teletravail', 'workplaceType',  'lieu', False),
    ('saisonnier',  'isSeasonal',     False, True),
    ('experience',  'experienceYears',False, False),
    ('seniorite',   'seniority',      False, False),
    ('salaire',     'salaryMin',      False, False),
    ('departement', 'department',     False, False),
    ('region',      'adminArea1',     False, False),
    ('rythme',      'workSchedule',   False, False),
    ('etudes',      'educationLevel', False, False),
    ('nature',      'engagementType', False, False),
]

c = pathlib.Path(sys.argv[1])
with (c / 'offres.jsonl').open(encoding='utf8') as f:
    pub = [json.loads(l) for l in f if l.strip()]
pub = [o for o in pub if o['publiable']]

par_pays = collections.defaultdict(list)
for o in pub:
    par_pays[o['countryCode'] or 'INCONNU'].append(o)

rempli = lambda o, col: o.get(col) is not None and str(o.get(col)).strip() != ''

print("═══ MATRICE PAYS × FILTRES ═══")
print(f"  population : {len(pub)} offres PUBLIABLES · seuil facette {SEUIL:.0%}\n")

# Gisement : dimension au-dessus du seuil mais NON filtrable
gisement = collections.defaultdict(lambda: {'pays': 0, 'offres': 0})
for p, offres in par_pays.items():
    if p == 'INCONNU':
        continue
    for nom, col, filtrable, _ in DIMS:
        taux = sum(1 for o in offres if rempli(o, col)) / len(offres)
        if taux >= SEUIL and filtrable is not True:
            gisement[nom]['pays'] += 1
            gisement[nom]['offres'] += sum(1 for o in offres if rempli(o, col))

print("  GISEMENT — dimensions couvertes mais NON filtrables par l'API :")
print(f"  {'dimension':14} {'pays >= seuil':>14} {'offres portant la donnee':>26}")
for nom, d in sorted(gisement.items(), key=lambda kv: -kv[1]['offres']):
    print(f"  {nom:14} {d['pays']:>14} {d['offres']:>26}")

print("\n  COUVERTURE des dimensions FILTRABLES, sur les 12 premiers marches :")
filtrables = [(n, col) for n, col, f, _ in DIMS if f is True]
print(f"  {'pays':7}{'offres':>7}  " + ' '.join(n[:9].rjust(9) for n, _ in filtrables))
for p, offres in sorted(par_pays.items(), key=lambda kv: -len(kv[1]))[:12]:
    if p == 'INCONNU':
        continue
    cells = []
    for _, col in filtrables:
        t = sum(1 for o in offres if rempli(o, col)) / len(offres)
        cells.append((('*' if t >= SEUIL else ' ') + f'{t*100:.0f}%').rjust(9))
    print(f"  {p:7}{len(offres):>7}  " + ' '.join(cells))
