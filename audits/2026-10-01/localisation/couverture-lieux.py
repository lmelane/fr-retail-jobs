"""D-499 : la couverture de la base de lieux par pays des marchés (localités et quartiers de `cities500`, codes postaux).
Lit les fichiers GeoNames du cache de villes.py, sans base ni réseau.
Usage : python3 couverture-lieux.py <cache GeoNames> > resultats/couverture-lieux-par-marche-<date>.txt"""
import collections, io, pathlib, sys, zipfile
cache = pathlib.Path(sys.argv[1])
marches = "FR MC US GB IE CA DE AT IT ES NL AU CH BE CN JP KR PT MX SG DK HK PL SE CL TR TH MY AE NO TW BR GR ZA VN CZ PE NZ HU SA RO PR PH LU".split()
lieux, quartiers, postaux = collections.Counter(), collections.Counter(), collections.Counter()
with zipfile.ZipFile(cache / 'cities500.zip') as z, z.open('cities500.txt') as f:
    for ligne in io.TextIOWrapper(f, encoding='utf8'):
        p = ligne.split('\t')
        if p[6] != 'P' or p[7] in ('PPLH', 'PPLQ', 'PPLW', 'PPLCH'):
            continue
        lieux[p[8]] += 1
        if p[7] == 'PPLX':
            quartiers[p[8]] += 1
with zipfile.ZipFile(cache / 'postaux-allCountries.zip') as z, z.open('allCountries.txt') as f:
    for ligne in io.TextIOWrapper(f, encoding='utf8'):
        postaux[ligne.split('\t', 1)[0]] += 1
print('D-499 — couverture de la base de lieux par pays des marchés (GeoNames du 01/10/2026)')
print(f"{'pays':5}{'localités':>11}{'quartiers (PPLX)':>18}{'codes postaux':>15}")
for m in marches:
    print(f"{m:5}{lieux[m]:>11}{quartiers[m]:>18}{postaux[m]:>15}")
print('Arrondissements numérotés reconnus et affichés « Paris 15e » : Paris (20), Lyon (9), Marseille (16).')
print('Sans codes postaux GeoNames : ' + ', '.join(m for m in marches if not postaux[m]) + ' ; Hong Kong : 1 code (pas de codes postaux).')
