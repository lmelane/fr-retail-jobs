"""D-515 §1 (arbitrage du 02/10/2026) : bilan des filtres secteur et langue, avant / après, par marché et par valeur
(sorties de mesure-inconnu.mts ; l'après lu avec SECTION=1). Après : la liste ne porte que les reconnues (son total doit
égaler le filtre strict d'avant) ; les inconnues forment une section à part (`section`), annoncée et bornée par le site.
Usage : python3 bilan-inconnu.py <avant.json> <apres.json>"""
import json, sys
from collections import defaultdict
av, ap = (json.load(open(f)) for f in sys.argv[1:3])
cle = lambda l: (l['marche'], l['filtre'], l['valeur'])
A = {cle(l): l for l in av['lignes']}
B = {cle(l): l for l in ap['lignes']}
assert A.keys() == B.keys(), 'les deux mesures ne portent pas sur les mêmes recherches'
assert all('section' in B[k] for k in B), "l'après doit être lu avec SECTION=1"
ecarts = [k for k in A if B[k]['total'] != A[k]['total'] or B[k]['totalConfirmes'] != A[k]['total']]
print(f"{len(A)} recherches (marché × filtre × valeur), avant {av['debut']}, après {ap['debut']} ; colonne de retenue en production : {ap['colonneRetenue']}")
print(f"la liste d'après (total et confirmées) = le filtre strict d'avant : {len(A) - len(ecarts)} / {len(A)} ; écarts : {ecarts}")
inconnu = {m['marche']: m for m in ap['marches']}
print("\n# Cas demandés : liste (= avant) et section des inconnues à part")
for k in [('US', 'secteur', 'EYEWEAR'), ('US', 'secteur', 'WATCHMAKING'), ('US', 'secteur', 'BEAUTY'), ('FR', 'secteur', 'JEWELRY'), ('FR', 'langue', 'en')]:
    if k in A: print(f"{k[0]} {k[1]} {k[2]} : liste {A[k]['total']} → {B[k]['total']} ; section à part : {B[k]['section']}")
par = defaultdict(lambda: [0, 0, 0])
lignes = []
for k in sorted(A, key=lambda k: (k[1], -inconnu[k[0]]['servies'], k[0], k[2])):
    m, f, v = k
    par[(f, m)][0] += A[k]['total']; par[(f, m)][1] += B[k]['section']; par[(f, m)][2] += 1
    lignes.append(f"{f}\t{m}\t{v}\t{A[k]['total']}\t{B[k]['total']}\t{B[k]['section']}")
print('\n# Par filtre et par marché (somme sur les valeurs proposées) : liste avant = après ; section à part ; inconnues du marché')
for f in ('secteur', 'langue'):
    ta = ts = 0
    for (ff, m), (a, sct, n) in sorted(par.items(), key=lambda x: -inconnu[x[0][1]]['servies']):
        if ff != f: continue
        ta += a; ts += sct
        inc = inconnu[m]['secteurInconnu' if f == 'secteur' else 'langueInconnue']
        print(f"{f:8} {m:3} {n:2} valeurs  liste {a:7}  section {sct:7}  (inconnues du marché : {inc} / {inconnu[m]['servies']})")
    print(f"{f:8} TOTAL  liste {ta}  section {ts}")
print('\n# Détail : filtre, marché, valeur, liste avant, liste après, section à part')
print('\n'.join(lignes))
