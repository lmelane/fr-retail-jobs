"""Résumé d'un flux Teamtailor jobs.json lu (fichier local) : employeur déclaré x pays. Usage : python3 resumer-flux.py f.json"""
import collections, json, sys
d = json.load(open(sys.argv[1]))
print('feed_url', d.get('feed_url'), '| items', len(d['items']), '| next_url', d.get('next_url'))
c = collections.Counter(((i.get('_jobposting', {}).get('hiringOrganization') or {}).get('name'),
                         ((i.get('_jobposting', {}).get('jobLocation') or [{}])[0].get('address') or {}).get('addressCountry')) for i in d['items'])
for (org, country), n in sorted(c.items(), key=lambda x: -x[1]): print(f'{n:3d}  {org} ({country})')
