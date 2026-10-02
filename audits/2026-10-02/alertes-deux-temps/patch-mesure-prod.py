"""Le temps d'une mesure à blanc sur la PRODUCTION : la colonne `JobSource.availabilityHold` (R-143 §2, migration
20261002140000) n'y existe pas encore, et aucune retenue n'y est donc posée. On retire du code mesuré les deux conditions
qui la lisent (même résultat qu'en production aujourd'hui), on mesure, puis on rétablit les fichiers (`--retablir`).
python3 patch-mesure-prod.py <racine> [--retablir]"""
import sys, shutil, pathlib
racine = pathlib.Path(sys.argv[1]); fichiers = ['packages/db/availability.ts', 'apps/api/lib/jobs.ts']
if '--retablir' in sys.argv:
    for f in fichiers: shutil.move(str(racine / (f + '.avant-mesure')), str(racine / f))
    sys.exit(0)
for f in fichiers: shutil.copy(racine / f, racine / (f + '.avant-mesure'))
a = (racine / fichiers[0]).read_text()
a = a.replace("return { AND: [availableSourceWhere(at), { availabilityHold: null }] };", "return { AND: [availableSourceWhere(at)] };")
a = a.replace('AND available_source."availabilityHold" IS NULL', '')
assert 'availabilityHold" IS NULL' not in a and '{ availabilityHold: null }' not in a
(racine / fichiers[0]).write_text(a)
j = (racine / fichiers[1]).read_text().replace(',\n    availabilityHold: true } as const', '\n  } as const')
assert 'availabilityHold: true' not in j
(racine / fichiers[1]).write_text(j)
