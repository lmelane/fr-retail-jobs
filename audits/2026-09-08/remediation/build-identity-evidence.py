import csv,json,pathlib
root=pathlib.Path(__file__).parent
chain=json.loads(pathlib.Path('backups/remediation-20260908/source-identity-chain.json').read_text())
def write_csv(path,rows):
 with path.open('w',newline='',encoding='utf-8-sig') as f:
  w=csv.DictWriter(f,fieldnames=list(rows[0]));w.writeheader();w.writerows(rows)
rows=[]
for s in chain:
 if s['status']!='ACTIVE':continue
 history=s['history']
 rows.append(dict(source=s['key'],nom_catalogue=s['maison'],tenant=s['tenantKey'],offres_actives=s['n'],employeurs=s['companies'],trace_gate=' | '.join(h['verified'] for h in history)or'ARCHIVE_GATE_ABSENTE',nom_archive=' | '.join(h['maison']for h in history),note_activation=s['note'],certification_identite='NON_DEDUITE_DU_STATUT_ACTIVE'))
write_csv(root/'sources-identite-trace.csv',rows)
proofs=[
 ('via','Via, plateforme de mobilité','https://job-boards.greenhouse.io/via/jobs/8700271002'),
 ('ashoka','Ashoka, entrepreneuriat social','https://jobs.lever.co/ashoka/45d1d066-b9e7-4452-9733-dbe4faf90ba5'),
 ('coast','Coast, cartes de paiement pour flottes','https://job-boards.greenhouse.io/coast/jobs/4645584004'),
 ('blend','Blend Labs, logiciels bancaires','https://job-boards.greenhouse.io/blend/jobs/6148697004'),
 ('tala','Tala, infrastructure de crédit','https://jobs.lever.co/tala/a538a1ca-0b76-46d1-a933-d43dbe7f5c83'),
 ('ion','ION Group, logiciels financiers','https://jobs.lever.co/ion/82c48e10-8f67-4227-a68c-3fbe3f181389'),
 ('gate','Gate, plateforme de cryptomonnaies','https://jobs.lever.co/gate/432e213a-7f09-4a16-9dc0-7bcdf0ffc362'),
 ('didi','DiDi, conduite autonome','https://job-boards.greenhouse.io/didi/jobs/8131863'),
 ('fay','Fay, plateforme de nutrition et santé','https://job-boards.greenhouse.io/fay/jobs/5238250008'),
 ('honor','Honor Technology, aide à domicile','https://job-boards.greenhouse.io/honor/jobs/8777116002'),
 ('hone','Hone, formation professionnelle','https://job-boards.greenhouse.io/hone/jobs/4110121009'),
 ('cleo','Cleo Communications, intégration logicielle','https://job-boards.greenhouse.io/cleo/jobs/4725537005'),
 ('gridline','Gridline, investissements privés','https://jobs.lever.co/gridline/60d566e4-aa74-4b93-a98d-6f5ebe11c98d'),
 ('novara','Novara, logiciels EHS et gestion des risques','https://jobs.lever.co/novara/1faa23a2-ce3f-46b2-8714-4f5ccc4c2fa6'),
 ('sep','SEP, ingénierie logicielle','https://jobs.lever.co/sep/7b96b0c6-8429-4861-bf69-a00956e42a8d'),
 ('public','Public, plateforme d’investissement','https://job-boards.greenhouse.io/public/jobs/7982150003'),
 ('galileo','Galileo, soins médicaux','https://job-boards.greenhouse.io/galileo/jobs/8703228002'),
 ('eclipse','Eclipse Laboratories, blockchain','https://job-boards.greenhouse.io/eclipse/jobs/4981191008'),
 ('seer','Seer, protéomique et biotechnologies','https://seer.bio/'),
 ('yes','YES LLC, installations électriques industrielles','https://cjyes.com/'),
]
rows=[]
for key,actual,url in proofs:
 s=next(s for s in chain if s['key']==key)
 rows.append(dict(source=key,identite_catalogue=s['maison'],employeur_du_portail=actual,offres_actives=s['n'],preuve_officielle=url,verifie_le='2026-09-08',statut_prod=s['status'],reparation_prod='NON_EFFECTUEE_A_CET_INSTANT',trace_gate=' | '.join(h['verified']for h in s['history'])))
write_csv(root/'homonymes-confirmes.csv',rows)
print('active sources',440,'contradicted sources',len(rows),'jobs',sum(r['offres_actives']for r in rows))
