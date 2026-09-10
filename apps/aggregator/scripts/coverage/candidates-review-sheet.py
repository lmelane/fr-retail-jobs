"""Business-review sheet for technically qualified ATS candidates.
The machine says what each portal is and what it serves; a reviewer decides the employer identity
(reciprocal official link), group/brand/franchise relations and scope. Nothing here activates anything."""
import json, csv, pathlib, collections, sys
src = pathlib.Path(sys.argv[1] if len(sys.argv) > 1 else 'backups/lot4-20260909/candidates-qualification/candidates.jsonl')
out = pathlib.Path(sys.argv[2] if len(sys.argv) > 2 else 'audits/2026-09-09/lot4-world-coverage/tracker-v4/candidates-review.csv')
rows = [json.loads(l) for l in open(src) if l.strip()]
def proof_kind(r):
    hosts = {p['url'].split('/')[2] for p in r.get('proofs', [])}
    return 'OFFICIAL_OR_ACTOR_PAGE' if any(not any(v in h for v in ['teamtailor', 'workday', 'smartrecruiters', 'lever', 'greenhouse', 'icims', 'personio', 'recruitee', 'successfactors', 'eightfold', 'welcometothejungle', 'talent-soft', 'oraclecloud', 'pinpointhq', 'flatchr', 'avature']) for h in hosts) else 'VENDOR_PAGE_ONLY'
def next_action(r):
    if r['verdict'] == 'ALREADY_CATALOGUED': return f"Déjà au catalogue ({r['source']['key']}, {r['source']['status']}) : vérifier que l'acteur pointe bien cette source"
    if r['verdict'] == 'PROBE_FAILED': return 'Échec technique : lire l\'erreur, corriger l\'adaptateur ou la configuration, re-sonder'
    if r['verdict'] == 'READABLE_EMPTY': return 'Portail lisible mais vide : garder en candidat, ne pas activer'
    return 'Revue identité : lien réciproque site officiel → portail, employeur natif ↔ marque, groupe/franchise ; puis candidat DRAFT → revue → promotion'
with out.open('w') as f:
    w = csv.writer(f); w.writerow(['Tenant', 'ATS', 'Portail', 'Libellés acteurs', 'Nb acteurs', 'Preuve (type de page)', 'Verdict technique', 'Offres', 'Total déclaré', 'Énumération complète', 'Méthode', 'Employeurs natifs (top)', 'Pays (top)', 'Avec description', 'Avec date', 'Secondes', 'Erreur', 'Action suivante'])
    for r in sorted(rows, key=lambda r: (r['verdict'] != 'READABLE_WITH_POSTINGS', -(r.get('postings') or 0))):
        w.writerow([r['tenantKey'], r['type'], r['careersUrl'], ' | '.join(r.get('labels', [])), len(r.get('actors', [])), proof_kind(r), r['verdict'], r.get('postings', ''), r.get('declaredTotal', ''), r.get('complete', ''), (r.get('enumeration') or {}).get('method', ''),
                    ' | '.join(f"{n} ({c})" for n, c in (r.get('employers') or [])[:5]), ' | '.join(f"{n} ({c})" for n, c in (r.get('countries') or [])[:5]), r.get('withDescription', ''), r.get('withDate', ''), r.get('seconds', ''), (r.get('error') or '')[:120], next_action(r)])
summary = {'tenants': len(rows), 'verdicts': dict(collections.Counter(r['verdict'] for r in rows)), 'byType': dict(collections.Counter(r['type'] for r in rows)), 'postingsReadable': sum(r.get('postings') or 0 for r in rows if r['verdict'] == 'READABLE_WITH_POSTINGS'),
           'completeEnumerations': sum(1 for r in rows if r.get('complete') is True), 'officialOrActorPageProof': sum(1 for r in rows if proof_kind(r) == 'OFFICIAL_OR_ACTOR_PAGE'), 'vendorPageOnly': sum(1 for r in rows if proof_kind(r) == 'VENDOR_PAGE_ONLY')}
print(json.dumps(summary, ensure_ascii=False, indent=1))
