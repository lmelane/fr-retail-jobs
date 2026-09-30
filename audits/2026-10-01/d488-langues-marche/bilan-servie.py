"""D-488 : bilan du rejeu en production (lecture seule) de la requête servie capturée par capture-sql.mts.
Le fichier rejoué enchaîne des blocs, un par variante (dans l'ordre donné), plusieurs tours ; chaque bloc porte les
mêmes cas dans le même ordre. Médiane des tours par cas et par variante ; « mêmes » : total et page identiques à la
première variante (la référence).
Usage : python3 bilan-servie.py <sortie psql> <nombre de cas> <variante1,variante2,...>"""
import re, sys
lignes = [l for l in open(sys.argv[1]).read().splitlines() if l.strip() and l != 'Timing is on.']
n, variantes = int(sys.argv[2]), sys.argv[3].split(',')
if len(lignes) % 3:
    raise SystemExit('Sortie inattendue : ' + '\n'.join(lignes[:6]))
mesures = {}
for i in range(0, len(lignes), 3):
    cas, resultat, temps = lignes[i], lignes[i + 1], lignes[i + 2]
    v = variantes[(i // 3 // n) % len(variantes)]
    m = mesures.setdefault(cas, {}).setdefault(v, {'resultats': set(), 'ms': []})
    m['resultats'].add(resultat); m['ms'].append(float(re.match(r'Time: ([\d.]+) ms', temps).group(1)))
med = lambda x: sorted(x)[len(x) // 2]
print(f"{'cas':30}" + ''.join(f"{v:>22}" for v in variantes) + '  résultats identiques à ' + variantes[0])
for cas, m in mesures.items():
    ref = m[variantes[0]]['resultats']
    print(f"{cas:30}" + ''.join(f"{med(m[v]['ms']):>13.0f} ms ({len(m[v]['ms'])}) " for v in variantes)
          + '  ' + ('oui' if all(m[v]['resultats'] == ref and len(ref) == 1 for v in variantes) else 'NON ' + str({v: m[v]['resultats'] for v in variantes})))
