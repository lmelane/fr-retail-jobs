"""D-515 §2 — LA GRILLE DES 63 ALERTES « CDI / CDD », reconstruite de façon rejouable (la lecture R-143 §6, §8 ne l'avait
pas versionnée) : 35 « CDI », 7 « CDI · temps plein », 7 « CDD » sur les recherches de conversion les plus partagées du
marché France (métier + ville), et 14 « permanent » sur les grandes villes de 14 autres marchés, métier « sales-advisor ».
Aucune personne : des critères seuls, tirés de alertes-conversion.json (mesure-alertes-conversion-r143-2026-10-02.mts du
backend), triés par nombre d'inscrits puis par clé, pour un tirage stable.
python3 grille-63.py <alertes-conversion.json> <grille-63.json>"""
import json, sys
_, entree, sortie = sys.argv
conv = json.load(open(entree))
fr = sorted((a for a in conv if a['criteres']['marche'] == 'FR' and a['criteres']['filtres'].get('ville')),
            key=lambda a: (-a['inscrits'], json.dumps(a['criteres'], sort_keys=True)))
def avec(a, filtres, origine):
    c = json.loads(json.dumps(a['criteres']))
    c['filtres'] = {**c['filtres'], **filtres}
    return {'criteres': c, 'inscrits': 1, 'origine': origine}
grille = [avec(a, {'contrat': ['PERMANENT']}, 'grille-cdi') for a in fr[:35]]
grille += [avec(a, {'contrat': ['PERMANENT'], 'temps': ['FULL_TIME']}, 'grille-cdi-temps-plein') for a in fr[:7]]
grille += [avec(a, {'contrat': ['FIXED_TERM']}, 'grille-cdd') for a in fr[:7]]
VILLES = [('US', 'New York'), ('GB', 'London'), ('DE', 'Berlin'), ('IT', 'Milano'), ('ES', 'Madrid'), ('NL', 'Amsterdam'),
          ('CH', 'Genève'), ('JP', '東京'), ('KR', '서울'), ('CN', '上海'), ('CA', 'Toronto'), ('AU', 'Sydney'), ('BE', 'Bruxelles'),
          ('SE', 'Stockholm')]
grille += [{'criteres': {'marche': m, 'motCle': '', 'lieu': v, 'filtres': {'metier': ['sales-advisor'], 'contrat': ['PERMANENT']}},
            'inscrits': 1, 'origine': 'grille-permanent'} for m, v in VILLES]
assert len(grille) == 63
json.dump(grille, open(sortie, 'w'), ensure_ascii=False, indent=1)
print(f'{len(grille)} alertes → {sortie}')
