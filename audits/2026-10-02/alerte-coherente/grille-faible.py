"""Lecture D-492 du 02/10/2026 (alerte cohérente) — la grille de 63 alertes, puis sa variante « faible » : les mêmes
filtres d'emploi (contrat, temps) par marché, SANS métier ni lieu, dédoublonnés (une alerte « CDI » seule sur la France
n'est qu'une alerte, quelle que soit la ville qu'on lui a retirée). Les 63 correspondent toutes fortement (métier et
ville, ou métier et lieu) : le correctif ne doit RIEN y changer ; la variante faible montre ce qu'il retire.
python3 grille-faible.py ../alertes-deux-temps/grille-63.json grille-80.json   (les 63, puis les 17 faibles)"""
import json, sys
_, entree, sortie = sys.argv
grille = json.load(open(entree))
assert len(grille) == 63
vus, faibles = set(), []
for a in grille:
    c = a['criteres']
    filtres = {k: v for k, v in c['filtres'].items() if k in ('contrat', 'temps')}
    cle = json.dumps([c['marche'], filtres], sort_keys=True)
    if cle in vus:
        continue
    vus.add(cle)
    faibles.append({'criteres': {'marche': c['marche'], 'motCle': '', 'lieu': '', 'filtres': filtres}, 'inscrits': 1,
                    'origine': a['origine'] + '-faible'})
json.dump(grille + faibles, open(sortie, 'w'), ensure_ascii=False, indent=1)
print(f'{len(grille)} + {len(faibles)} alertes faibles → {sortie}')
