"""Couverture RÉELLE de chaque dimension par pays, sur les offres PUBLIABLES.

Le registre `marches.ts` porte des `couverture` figées au 15/09. Ce script les recalcule
depuis le corpus : une facette peut être exposée sur une donnée devenue rare, ou cachée
alors que la donnée suffit — et aucun code ne le signale.
"""
import json, sys, pathlib, collections

SEUIL = 0.2  # SEUIL_AFFICHAGE_FACETTE
DIMS = ['employmentTerm', 'workTime', 'programType', 'isSeasonal', 'workplaceType',
        'experienceYears', 'seniority', 'salaryMin', 'department', 'jobFunction',
        'occupationCode', 'adminArea1', 'language', 'educationLevel', 'workSchedule',
        'engagementType']

c = pathlib.Path(sys.argv[1])
with (c / 'offres.jsonl').open(encoding='utf8') as f:
    pub = [json.loads(l) for l in f if l.strip()]
pub = [o for o in pub if o['publiable']]

par_pays = collections.defaultdict(list)
for o in pub:
    par_pays[o['countryCode'] or 'INCONNU'].append(o)

rempli = lambda o, d: o.get(d) is not None and str(o.get(d)).strip() != ''

print("═══ MATRICE PAYS × DIMENSIONS — couverture mesurée (offres publiables) ═══")
print(f"   seuil d'affichage d'une facette : {SEUIL:.0%}\n")
entete = f"  {'pays':7}{'n':>7}  " + ' '.join(d[:6].rjust(6) for d in DIMS)
print(entete)
for p, offres in sorted(par_pays.items(), key=lambda kv: -len(kv[1]))[:22]:
    n = len(offres)
    cells = []
    for d in DIMS:
        taux = sum(1 for o in offres if rempli(o, d)) / n
        cells.append(('*' if taux >= SEUIL else ' ') + f'{taux*100:>5.0f}')
    print(f"  {p:7}{n:>7}  " + ' '.join(cells))
print("\n  * = au-dessus du seuil d'affichage. Valeurs en % des offres publiables du pays.")
print("  Colonnes :", ', '.join(DIMS))
