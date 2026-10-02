"""D-510 : la requête servie au contrat 1 (sans l'en-tête) est-elle la même avant et après le lot ? Compare deux captures
de capture-servie.mts (CONTRAT=1), aux seules différences de forme près : l'instant de la requête (`asOf`), les espaces,
et l'alias redondant `pri AS pri` (même colonne, même valeur). Toute autre différence est imprimée.
Usage : python3 comparer-contrat1.py <avant.sql> <apres.sql>"""
import re, sys
def forme(t):
    t = re.sub(r"'\d{4}-\d\d-\d\dT[\d:.]+Z'::timestamptz", "'<asOf>'::timestamptz", t)
    t = re.sub(r'\s+', ' ', t).replace('pri AS pri,', 'pri,')
    return re.sub(r'\( ', '(', re.sub(r' \)', ')', t))
a, b = (open(f).read().split('\\echo')[1:] for f in sys.argv[1:3])
differentes = [x.split('\n')[0] for x, y in zip(a, b) if forme(x) != forme(y)]
print(f"{len(a)} requêtes, {len(a) - len(differentes)} identiques aux différences de forme près ; différentes : {differentes}")
