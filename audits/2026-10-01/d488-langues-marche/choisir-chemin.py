"""D-488 : assemble la requête servie de la RÈGLE FINALE pour chaque cas de la grille, avec les comptes de PRODUCTION.
Les deux captures (`capture-sql.mts`, code de la branche) diffèrent seulement par le chemin de la clause de métier :
`index.sql` (condition indexable) et `relecture.sql` (clause de métier hors index). Pour chaque cas, la règle de
`apps/api/lib/search-chemin.ts` (marché d'au plus 5 000 offres actives, ou métier portant au moins 20 % des offres du
marché) choisit l'une ou l'autre, avec `resultats/parts.txt` (offres actives par marché et métier, lecture seule) et
les totaux par marché ci-dessous (même source, 30/09/2026 20:50 UTC).
Usage : python3 choisir-chemin.py index.sql relecture.sql metiers-des-cas.json > finale.sql"""
import json, re, sys
from pathlib import Path

TOTAL = {'US': 39953, 'FR': 13368, 'GB': 4200, 'DE': 3478, 'CA': 3428, 'IT': 2902, 'ES': 2221, 'NL': 1865, 'CH': 1291,
         'CN': 1238, 'BE': 708, 'JP': 588}
parts = {}
for ligne in (Path(__file__).parent / 'resultats' / 'parts.txt').read_text().splitlines()[1:]:
    a = ligne.split('|')
    if len(a) == 3:
        parts[(a[0], a[1])] = int(a[2])
metiers = json.load(open(sys.argv[3]))
blocs = lambda f: re.split(r"(?m)^(?=\\echo )", open(f).read())
index, relecture = blocs(sys.argv[1]), blocs(sys.argv[2])
sortie, relus = [index[0]], 0
for x, y in zip(index[1:], relecture[1:]):
    cas = re.match(r"\\echo '(.*)'", x).group(1).replace("''", "'")
    marche, metier = cas.split()[0], metiers.get(cas)
    relu = metier is not None and (TOTAL[marche] <= 5000 or parts.get((marche, metier), 0) >= 0.2 * TOTAL[marche])
    relus += relu
    sortie.append(y if relu else x)
print(''.join(sortie), end='')
print(f'{relus} cas sur {len(index) - 1} relisent le marché', file=sys.stderr)
