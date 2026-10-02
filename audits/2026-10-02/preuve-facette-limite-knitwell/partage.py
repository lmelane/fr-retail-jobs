"""Partage des fermetures des fausses preuves de knitwell contre la liste complète. python3 partage.py > partage.out"""
import csv, json, pathlib, collections
here = pathlib.Path(__file__).parent
listing = json.loads((here / 'liste-knitwell.json').read_text())
assert listing['complete'] and listing['proving'] and listing['distinct'] == len(listing['ids']), 'liste non prouvée'
listed = set(listing['ids'])
rows = list(csv.DictReader((here / 'fermetures-ids.out').read_text().splitlines()[2:], delimiter='|'))
by = collections.Counter((r['deactivated'], r['externalId'] in listed) for r in rows)
print(f"liste complète : {len(listed)} offres, {listing['termination']}, lue le {listing['at']}")
print(f"désactivées sur preuve depuis le 23/09 et toujours inactives : {len(rows)}")
print(f"  encore listées (fermées à tort, à rouvrir) : {sum(r['externalId'] in listed for r in rows)}")
print(f"  absentes de la liste complète (fermées à bon droit) : {sum(r['externalId'] not in listed for r in rows)}")
for (day, inlist), n in sorted(by.items()): print(f"  {day} {'à tort' if inlist else 'à bon droit'} : {n}")
