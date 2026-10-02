"""D-520, classe identité : les résolutions automatiques de la fenêtre, relues à la main (toutes : R1 et D-506 ; la règle 2
n'en a aucune sur la fenêtre). Lecture seule de `preuves.csv.gz`.   python3 relecture.py > relecture.tsv"""
import csv, gzip, io, random, sys
sys.path.insert(0, '.')
from rejeu import classify, registry
reg = registry()
rows = list(csv.DictReader(io.TextIOWrapper(gzip.open('preuves.csv.gz'), encoding='utf-8')))
seen, picked = set(), {'R1': [], 'D506': [], 'R2': []}
for r in rows:
    v, _ = classify(r, reg)
    if v in picked and (r['src'], r['ext']) not in seen:
        seen.add((r['src'], r['ext'])); picked[v].append(r)
random.Random(20261002).shuffle(picked['R2'])
sample = picked['R1'] + picked['D506'] + picked['R2']
w = csv.writer(sys.stdout, delimiter='\t')
w.writerow(['n', 'regle', 'source', 'offre', 'premier_RUN', 'motif', 'libelle_du_RUN', 'libelle_precedent', 'origine_precedente', 'employeur_precedent', 'employeur_resolu', 'temoins', 'intitule', 'url'])
for i, r in enumerate(sample, 1):
    v, _ = classify(r, reg)
    resolved = r['raw'] if v == 'D506' else r['prev_company']  # R1 : l'employeur que l'offre garde
    w.writerow([i, v, r['src'], r['ext'], r['jour'], r['motif'], r['raw'], r['prev_label'], r['prev_origin'], r['prev_company'], resolved, r['temoins_avant'], r['title'], r['url']])
