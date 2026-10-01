"""D-496 : bilan du rejeu en production (lecture seule) des requêtes servies capturées par capture-proximite.mts.
Le fichier rejoué alterne les blocs « avant » (code de development avant le lot) et « après » (ce lot), 7 tours, les
mêmes cas dans le même ordre. Médiane et p95 par cas et par variante ; le total servi de chaque variante.
Usage : python3 bilan-rejeu.py <sortie psql> <nombre de cas>"""
import re, statistics, sys
lignes = [l for l in open(sys.argv[1]).read().splitlines() if l.strip() and l != 'Timing is on.']
n, m = int(sys.argv[2]), {}
for bloc, i in enumerate(range(0, len(lignes), 3)):
    cas, res, t = lignes[i], lignes[i + 1], float(re.match(r'Time: ([\d.]+) ms', lignes[i + 2]).group(1))
    d = m.setdefault(cas, {}).setdefault(['avant', 'après'][(bloc // n) % 2], {'r': set(), 'ms': []})
    d['r'].add(res.split('|')[0].strip()); d['ms'].append(t)
p95 = lambda x: sorted(x)[min(len(x) - 1, round(0.95 * (len(x) - 1)))]
print(f"{'cas':52}{'avant méd':>11}{'p95':>8}{'après méd':>11}{'p95':>8}  offres avant → après")
for c, d in m.items():
    a, b = d['avant'], d['après']
    print(f"{c[:52]:52}{statistics.median(a['ms']):>9.0f}ms{p95(a['ms']):>6.0f}ms{statistics.median(b['ms']):>9.0f}ms{p95(b['ms']):>6.0f}ms"
          f"  {','.join(sorted(a['r']))} → {','.join(sorted(b['r']))}")
