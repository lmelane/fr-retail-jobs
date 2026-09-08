"""Separate identity evidence, current coverage and technical source validation.
Reads the dated, read-only production export; never writes to the database.
"""
import csv, json, pathlib, re, unicodedata
root=pathlib.Path(__file__).parent
original=root.parent/'reaudit'/'tableaux'/'maisons-sources-a-instruire.csv'
private=root.parents[2]/'backups'/'remediation-20260908'/'coverage-current.jsonl'
def norm(s):
 return re.sub('[^a-z0-9]','',unicodedata.normalize('NFKD',s or '').encode('ascii','ignore').decode().lower())
data=[json.loads(l) for l in private.read_text().splitlines() if l.startswith('{')]
summary=next(x for x in data if x['dataset']=='current-coverage')
companies=next(x['rows'] for x in data if x['dataset']=='company-identities')
decisions={d['subject']:d for d in json.loads((root/'candidate-identity-decisions.json').read_text())}
rows=[]
for item in csv.DictReader(original.open(encoding='utf-8-sig')):
 name=item['identite_canonique_proposee']
 keys={norm(name),*(norm(a) for a in item['aliases_observes'].split('|') if a.strip())}
 matches=[c for c in companies if keys & {norm(c['name']),norm(c['canonicalKey']),*(norm(a[k]) for a in c['aliases'] or [] for k in ['key','display'])}]
 proof=item['preuve']; domain=item['domaine_officiel']; parent=item['groupe_parent_prouve']; comment='Identité documentée ; validation du connecteur indépendante.'
 if name in ['SMCP','Maje','Claudie Pierlot','Fursac']:
  proof='https://www.smcp.com/fr/marques/'
  comment='SMCP nomme explicitement ses quatre marques. L’absence de domaine propre renseigné ne remet pas en cause cette identité.'
 elif item['groupe_parent_prouve']=='Inditex':
  proof='https://www.inditexpeople.com/fr/fr'
  comment='Acteur nommé explicitement sur le portail officiel Inditex People. Domaine propre et connecteur sont des validations distinctes.'
 elif name=='L’Atelier du Sourcil':
  proof='https://ievagroup.com/atelier-du-sourcil-boudoir-du-regard/'
  domain='atelierdusourcil.com';parent='IEVA Group'
  comment='Identité et groupe confirmés par IEVA et atelierdusourcil.com/pages/notre-univers. La piste NOVI du premier inventaire est rejetée ; portail carrière à qualifier.'
 decision=decisions.get(name)
 if not decision or decision['scope']!='COMMERCIAL_IDENTITY_ONLY' or decision['decision']!='DOCUMENTED':
  raise ValueError(f'Revue documentaire explicite manquante : {name}. Ne pas déduire une identité du domaine ou du nom.')
 proof=decision['proofUrl']
 comment=decision['statement']
 rows.append(dict(identite=name,lot='CORRECTION_SMCP' if item['statut']=='RATTACHEMENT_ERRONE_DEMONTRE' else 'EXTENSION_OU_COUVERTURE',identite_documentee='OUI',portee_preuve=decision['scope'],date_revue=decision['reviewDate'],preuve_identite=proof,groupe_parent=parent,domaine=domain,presence_company='PRESENTE' if matches else 'NON_RETROUVEE_NOM_CLE_ALIAS',fiches_company=' | '.join(c['name'] for c in matches),offres_actives=sum(c['active'] for c in matches),collecte_nouvelle_validee='NON',nouvelle_source_activee='NON',commentaire=comment))
with (root/'couverture-qualifiee.csv').open('w',newline='',encoding='utf-8-sig') as f:
 w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
extension=[r for r in rows if r['lot']=='EXTENSION_OU_COUVERTURE']
summary['candidate_dossiers']=len(rows)
summary['extension_or_coverage_dossiers']=len(extension)
summary['extension_identities_not_found_by_name_key_alias']=sum(r['presence_company']!='PRESENTE' for r in extension)
summary['existing_identities_to_strengthen']=[r['identite'] for r in extension if r['presence_company']=='PRESENTE']
summary['smcp_correction_dossiers']=len(rows)-len(extension)
summary['new_activated_sources']=0
(root/'coverage-current-summary.json').write_text(json.dumps(summary,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(summary,ensure_ascii=False,indent=2))
