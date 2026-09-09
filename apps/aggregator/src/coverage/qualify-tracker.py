"""Seven separate verdicts per actor, none inferred from another.

Reads the read-only production snapshot, the candidate inventory, every dated
research pass and every native fetch receipt, and writes one row per FashionJobs
actor plus one row per catalogued source. The verdicts are kept apart on
purpose:

  1. fashionjobsMatch     — is the label a reviewed alias, a name candidate, or nothing
  2. canonicalIdentity    — reviewed employer identity ALREADY IN THE DATABASE (never
                            erased by an incomplete research pass)
  3. officialPortal       — a portal is confirmed only by a verified identity review
                            (official link/domain); research yields candidates
  4. portalResearch       — progress of the dated research passes, failures, unvisited URLs
  5. sourceCertification  — is the CURRENT source configuration covered by a verified
                            review (hash + subject + age), superseded, contradicted, legacy
  6. activation           — catalogue status and last run, distinct from certification
  7. feedCompleteness     — did the latest native receipt/run enumerate the CONFIGURED
                            feed completely; a complete feed proves nothing about
  8. worldwideCoverage    — always NOT_PROVEN until every portal has been investigated

The composer never writes to the database and never invents a certification.
"""
import argparse, collections, csv, json, pathlib, unicodedata
from datetime import datetime, timezone

p = argparse.ArgumentParser()
p.add_argument('inventory'); p.add_argument('snapshot'); p.add_argument('output')
p.add_argument('--research', nargs='*', default=[]); p.add_argument('--probes', nargs='*', default=[])
p.add_argument('--previous-summary', default=None, help='progress-summary.json of the previous tracker, for before/after metrics')
a = p.parse_args()
out = pathlib.Path(a.output); out.mkdir(parents=True, exist_ok=True)
rows = json.load(open(a.inventory)); snap = json.load(open(a.snapshot))
AT = datetime.fromisoformat(snap['at'].replace('Z', '+00:00'))
REVIEW_MAX_AGE_DAYS = 30

def norm(x): return ' '.join(unicodedata.normalize('NFKC', x or '').lower().split())
def age_days(iso):
    if not iso: return None
    return round((AT - datetime.fromisoformat(iso.replace('Z', '+00:00'))).total_seconds() / 86400, 1)

# ---------------------------------------------------------------- database facts
companies = {c['id']: c for c in snap['companies']}
sources = {s['key']: s for s in snap['sources']}
reviews = {r['sourceKey']: r for r in snap['latestIdentityReviews']}          # latest per source, any verdict
latest_runs = {r['sourceKey']: r for r in snap['latestRuns']}
counts = {r['companyId']: r for r in snap['counts']}
company_sources = collections.defaultdict(list)
for r in snap['sourceCompanies']: company_sources[r['companyId']].append(r)
alias_by_norm = collections.defaultdict(list)
for c in companies.values():
    for al in c['aliases']:
        alias_by_norm[norm(al['displayName'])].append({**al, 'companyId': c['id']})
        if al.get('normalizedName'): alias_by_norm[norm(al['normalizedName'])].append({**al, 'companyId': c['id']})

# ---------------------------------------------------------------- research passes
research = collections.defaultdict(list)
for root in a.research:
    f = pathlib.Path(root) / 'research.jsonl'
    if not f.exists(): continue
    for line in f.read_text().splitlines():
        if line.strip():
            rec = json.loads(line); research[rec['id']].append({**rec, 'pass': root})

# ---------------------------------------------------------------- native receipts (latest per source)
# The most recent evidence is the receipt produced by the NEWEST adapter code, then the latest
# in time: probe passes ran concurrently on 2026-09-09, and a long alphabetical run on an older
# revision (b8c153f) finished after targeted re-probes on newer revisions. Ordering by wall
# clock alone showed 26 false "regressions". Revision dates come from `git show -s --format=%ct`.
import subprocess
_rev_dates: dict[str, int] = {}
def revision_date(rev):
    if not rev: return 0
    if rev not in _rev_dates:
        out = subprocess.run(['git', 'show', '-s', '--format=%ct', rev], capture_output=True, text=True)
        _rev_dates[rev] = int(out.stdout.split()[0]) if out.returncode == 0 and out.stdout.strip() else 0
    return _rev_dates[rev]
def receipt_rank(r): return (revision_date(r.get('revision')), r.get('finishedAt') or r.get('startedAt') or '')
receipts = {}; ever_complete = set()
for root in a.probes:
    for f in pathlib.Path(root).glob('*.receipt.json'):
        r = json.load(open(f)); r['receiptFile'] = str(f)
        key = r['sourceKey']
        if r.get('status') == 'FETCH_COMPLETE': ever_complete.add(key)
        if key not in receipts or receipt_rank(r) > receipt_rank(receipts[key]):
            receipts[key] = r

# ---------------------------------------------------------------- per-source verdicts (shared by both tables)
def certify(source):
    rev = reviews.get(source['key'])
    if not rev:
        return {'verdict': 'RETIRED_UNCERTIFIED' if source['status'] == 'RETIRED' else 'LEGACY_UNCERTIFIED',
                'review': None, 'reason': 'No SourceIdentityReview recorded for this source; it predates the review gate.'}
    current = rev['sourceHash'] == source['identityHash'] and rev['subjectKey'] == source['subjectKey']
    age = age_days(rev['checkedAt'])
    if rev['verdict'] != 'VERIFIED': verdict = rev['verdict']                       # CONTRADICTED / UNRESOLVED win
    elif not current: verdict = 'VERIFIED_FOR_SUPERSEDED_CONFIGURATION'
    elif age is not None and age > REVIEW_MAX_AGE_DAYS: verdict = 'VERIFIED_EXPIRED'
    else: verdict = 'CERTIFIED_CURRENT'
    return {'verdict': verdict, 'configurationCurrent': current, 'ageDays': age,
            'review': {k: rev[k] for k in ['id', 'verdict', 'method', 'officialDomain', 'proofUrl', 'portalUrl', 'artifactHash', 'checkedAt', 'reviewer'] if k in rev},
            'reason': None if verdict == 'CERTIFIED_CURRENT' else f'Latest review {rev["verdict"]} ({rev["method"]}) checked {rev["checkedAt"][:10]}; configuration current: {current}.'}

def activation(source):
    return {'status': source['status'], 'tier': source.get('tier'), 'lastRunAt': source.get('lastRunAt'), 'lastRunStatus': source.get('lastRunStatus'),
            'lastRunJobs': source.get('lastRunJobs'), 'verifiedJobCount': source.get('verifiedJobCount'),
            'robotsVerdict': source.get('robotsVerdict'), 'robotsCheckedAt': source.get('robotsCheckedAt')}

def completeness(source):
    key = source['key']; rc = receipts.get(key); run = latest_runs.get(key)
    evidence = []
    if rc: evidence.append({'kind': 'NATIVE_RECEIPT', 'status': rc.get('status'), 'at': rc.get('finishedAt'), 'fetched': rc.get('fetched'), 'uniqueIds': rc.get('uniqueIds'),
                            'declaredTotal': rc.get('declaredTotal'), 'complete': rc.get('complete'), 'truncated': rc.get('truncated'), 'revision': rc.get('revision'),
                            'configHash': rc.get('configHash'), 'missingInDatabase': len(rc.get('missingInDatabase') or []), 'activeDatabaseAbsentAtSource': len(rc.get('activeDatabaseAbsentAtSource') or []), 'receiptFile': rc.get('receiptFile')})
    if run: evidence.append({'kind': 'PRODUCTION_RUN', 'status': run.get('status'), 'at': run.get('ranAt'), 'fetched': run.get('fetched'), 'accepted': run.get('accepted'), 'jobs': run.get('jobs'),
                             'declaredTotal': run.get('declaredTotal'), 'complete': run.get('complete'), 'truncated': run.get('truncated'), 'errors': run.get('errors'), 'runId': run.get('runId')})
    evidence.sort(key=lambda e: e['at'] or '', reverse=True)
    latest = evidence[0] if evidence else None
    if not latest: verdict = 'NOT_MEASURED'
    elif (latest['kind'] == 'NATIVE_RECEIPT' and latest['status'] == 'FETCH_COMPLETE') or (latest['kind'] == 'PRODUCTION_RUN' and latest['complete'] is True and not latest['truncated'] and (latest['errors'] or 0) == 0):
        verdict = 'CONFIGURED_FEED_ENUMERATED_COMPLETELY'
    elif latest['kind'] == 'PRODUCTION_RUN' and latest['status'] in ('BROKEN', 'TIMEOUT', 'ERROR', 'CHALLENGED'): verdict = 'LATEST_RUN_FAILED'
    else: verdict = 'PARTIAL_OR_UNPROVEN'
    return {'verdict': verdict, 'measuredAt': latest and latest['at'], 'latest': latest, 'evidence': evidence,
            'scope': 'The configured feed only. Says nothing about employer identity, other portals, or field quality.'}

# ---------------------------------------------------------------- per-actor composition
def research_block(r):
    passes = sorted(research[r['id']], key=lambda x: x.get('at') or '')
    if not passes: return {'verdict': 'RESEARCH_NOT_RUN', 'passes': 0}
    latest = passes[-1]
    pages = {(p['url'], p['sha256']): p for step in passes for p in step.get('pages', [])}
    read_urls = {u for u, _ in pages}
    failures = {}
    for step in passes:
        for f in step.get('failures', []): failures[f.get('url')] = f
    url_of = lambda x: x if isinstance(x, str) else (x or {}).get('url') or (x or {}).get('to')
    unvisited = sorted({url_of(u) for u in (latest.get('unvisited') or []) if url_of(u) and url_of(u) not in read_urls})
    remaining_profiles = [url_of(u) for u in (latest.get('remainingProfileUrls') or []) if url_of(u)]
    candidates = {}
    for page in pages.values():
        for c in page.get('atsCandidates', []):
            key = json.dumps([c['type'], c.get('config')], sort_keys=True)
            e = candidates.setdefault(key, {'ats': c['type'], 'portal': c['careersUrl'], 'configuration': c.get('config'), 'confidence': c.get('confidence'), 'proofs': []})
            e['proofs'].append({'url': page['url'], 'sha256': page['sha256'], 'at': page.get('at')})
    links = sorted({url_of(l) for step in passes for l in (step.get('links') or []) if url_of(l)})
    vendors = sorted({p['unsupportedVendor'] for p in pages.values() if p.get('unsupportedVendor')})
    return {'verdict': latest.get('status'), 'passes': len(passes), 'lastPassAt': latest.get('at'), 'versions': sorted({s.get('version') for s in passes}),
            'pagesRead': len(pages), 'failures': [{'url': u, 'error': (f.get('error') or f.get('reason') or '')[:200]} for u, f in failures.items()],
            'unvisitedUrls': unvisited, 'remainingProfileUrls': remaining_profiles, 'careerLinks': links[:50], 'careerLinkCount': len(links),
            'atsCandidates': list(candidates.values()), 'unsupportedVendors': vendors,
            'note': 'Research yields candidates and documented failures; it never certifies identity or absence.'}

def fj_match(r):
    hits = []
    for label in r['labels']:
        for al in alias_by_norm.get(norm(label), []):
            if al.get('reviewId') and al['companyId'] in r['candidateCompanyIds']:
                hits.append({'label': label, 'aliasId': al['id'], 'companyId': al['companyId'], 'sourceKey': al['sourceKey'], 'reviewId': al['reviewId']})
    if hits: return {'verdict': 'REVIEWED_ALIAS_DECISION', 'candidates': r['candidateCompanyIds'], 'reviewedAliases': hits}
    if r['candidateCompanyIds']: return {'verdict': 'EXACT_NAME_OR_ALIAS_CANDIDATE', 'candidates': r['candidateCompanyIds'], 'reviewedAliases': []}
    return {'verdict': 'NO_CANDIDATE', 'candidates': [], 'reviewedAliases': []}

def identity_block(r):
    per_company = []
    for cid in r['candidateCompanyIds']:
        c = companies[cid]; proofs = []
        if c.get('identityReview'):
            proofs.append({'kind': 'EMPLOYER_IDENTITY_REVIEW', 'reviewId': c['identityReview']['id'], 'reviewedAt': c['identityReview']['reviewedAt'], 'reviewedBy': c['identityReview']['reviewedBy'], 'planHash': c['identityReview']['planHash']})
        for sc in company_sources.get(cid, []):
            s = sources.get(sc['sourceKey'])
            if not s: continue
            cert = certify(s)
            if cert['review'] and cert['review']['verdict'] == 'VERIFIED':
                proofs.append({'kind': 'SOURCE_IDENTITY_REVIEW', 'sourceKey': s['key'], 'verdict': cert['verdict'], 'method': cert['review']['method'], 'officialDomain': cert['review']['officialDomain'],
                               'proofUrl': cert['review']['proofUrl'], 'artifactHash': cert['review']['artifactHash'], 'checkedAt': cert['review']['checkedAt'], 'configurationCurrent': cert['configurationCurrent']})
            elif cert['review']:
                proofs.append({'kind': 'SOURCE_IDENTITY_REVIEW', 'sourceKey': s['key'], 'verdict': cert['verdict'], 'checkedAt': cert['review']['checkedAt']})
        current = [x for x in proofs if x['kind'] == 'EMPLOYER_IDENTITY_REVIEW' or x.get('verdict') == 'CERTIFIED_CURRENT']
        contradicted = [x for x in proofs if x.get('verdict') in ('CONTRADICTED', 'UNRESOLVED')]
        verdict = 'CONTRADICTED_OR_UNRESOLVED' if contradicted and not current else 'ATTESTED' if current else 'ATTESTED_BUT_SUPERSEDED_OR_EXPIRED' if proofs else 'NAME_MATCH_ONLY'
        per_company.append({'companyId': cid, 'name': c['name'], 'kind': c['kind'], 'verdict': verdict, 'proofs': proofs})
    if not per_company: overall = 'NO_CANDIDATE'
    elif any(x['verdict'] == 'ATTESTED' for x in per_company): overall = 'ATTESTED'
    elif any(x['verdict'] == 'CONTRADICTED_OR_UNRESOLVED' for x in per_company): overall = 'CONTRADICTED_OR_UNRESOLVED'
    elif any(x['verdict'] == 'ATTESTED_BUT_SUPERSEDED_OR_EXPIRED' for x in per_company): overall = 'ATTESTED_BUT_SUPERSEDED_OR_EXPIRED'
    else: overall = 'NAME_MATCH_ONLY'
    return {'verdict': overall, 'companies': per_company, 'note': 'Read from reviewed database decisions only; research progress never changes this block.'}

def portal_block(r, ident, res):
    confirmed = [{'sourceKey': x['sourceKey'], 'portalUrl': reviews[x['sourceKey']]['portalUrl'], 'proofUrl': x['proofUrl'], 'method': x['method'], 'checkedAt': x['checkedAt']}
                 for c in ident['companies'] for x in c['proofs'] if x['kind'] == 'SOURCE_IDENTITY_REVIEW' and x.get('verdict') == 'CERTIFIED_CURRENT']
    if confirmed: return {'verdict': 'OFFICIAL_PORTAL_CONFIRMED', 'confirmed': confirmed, 'candidates': res.get('atsCandidates', [])}
    if res.get('atsCandidates'): return {'verdict': 'CANDIDATE_PORTALS_ONLY', 'confirmed': [], 'candidates': res['atsCandidates']}
    if res.get('careerLinkCount'): return {'verdict': 'CAREER_LINKS_NOT_YET_QUALIFIED', 'confirmed': [], 'candidates': []}
    return {'verdict': 'NONE_OBSERVED_YET', 'confirmed': [], 'candidates': [], 'note': 'Absence of a link on the pages read is not proof of absence of a portal.'}

def source_blocks(r):
    keys = sorted({sc['sourceKey'] for cid in r['candidateCompanyIds'] for sc in company_sources.get(cid, [])})
    return [{'key': k, 'kind': sources[k]['kind'], 'tenantKey': sources[k]['tenantKey'], 'certification': certify(sources[k]), 'activation': activation(sources[k]), 'completeness': completeness(sources[k])} for k in keys if k in sources]

def blocking_reason(r, fj, ident, portal, res, srcs):
    reasons = []
    if fj['verdict'] == 'NO_CANDIDATE': reasons.append('no exact name/alias match in the database')
    if ident['verdict'] == 'NAME_MATCH_ONLY': reasons.append('candidate identity never reviewed (name match only)')
    if ident['verdict'] == 'CONTRADICTED_OR_UNRESOLVED': reasons.append('latest identity review contradicts or leaves the employer unresolved')
    if portal['verdict'] != 'OFFICIAL_PORTAL_CONFIRMED':
        if res['verdict'] == 'RESEARCH_NOT_RUN': reasons.append('portal research not run')
        else: reasons.append(f"portal not confirmed: research {res['verdict']} after {res['pagesRead']} pages, {len(res['failures'])} failures, {len(res['unvisitedUrls'])} URLs unvisited")
    active = [s for s in srcs if s['activation']['status'] == 'ACTIVE']
    if srcs and not active: reasons.append('all known sources are paused or retired')
    for s in active:
        if s['certification']['verdict'] != 'CERTIFIED_CURRENT': reasons.append(f"{s['key']}: {s['certification']['verdict']}")
        if s['completeness']['verdict'] != 'CONFIGURED_FEED_ENUMERATED_COMPLETELY': reasons.append(f"{s['key']}: feed {s['completeness']['verdict']}")
    reasons.append('worldwide portal coverage not investigated')
    return reasons

def next_action(fj, ident, portal, res, srcs):
    if ident['verdict'] in ('NO_CANDIDATE', 'NAME_MATCH_ONLY'): return 'Establish the employer identity from an official page (link/domain), then record a SourceIdentityReview; a name match is not ownership proof.'
    if portal['verdict'] == 'CANDIDATE_PORTALS_ONLY': return 'Qualify the candidate portal(s): official reciprocal link, robots, native enumeration, then promote through the gate.'
    if portal['verdict'] in ('CAREER_LINKS_NOT_YET_QUALIFIED', 'NONE_OBSERVED_YET'): return 'Continue official-domain research (regional portals, languages, group portals); no absence has been established.'
    weak = [s['key'] for s in srcs if s['activation']['status'] == 'ACTIVE' and s['completeness']['verdict'] != 'CONFIGURED_FEED_ENUMERATED_COMPLETELY']
    if weak: return f"Prove complete enumeration of {', '.join(weak)} (pagination, counters, ids) before any closure decision."
    return 'Investigate the remaining portals worldwide (other regions, brands, business units) before claiming coverage.'

tracker = []
for r in rows:
    fj = fj_match(r); ident = identity_block(r); res = research_block(r); portal = portal_block(r, ident, res); srcs = source_blocks(r)
    single = r['candidateCompanyIds'][0] if len(r['candidateCompanyIds']) == 1 else None
    row = {'id': r['id'], 'labels': r['labels'], 'editions': r['editions'], 'profiles': r['profiles'], 'databaseAt': snap['at'],
           'fashionjobsMatch': fj, 'canonicalIdentity': ident, 'officialPortal': portal, 'portalResearch': res, 'sources': srcs,
           'activation': {'verdict': 'ACTIVE_SOURCE' if any(s['activation']['status'] == 'ACTIVE' for s in srcs) else 'ONLY_PAUSED_OR_RETIRED' if srcs else 'NO_SOURCE',
                          'active': [s['key'] for s in srcs if s['activation']['status'] == 'ACTIVE'], 'paused': [s['key'] for s in srcs if s['activation']['status'] == 'PAUSED'], 'retired': [s['key'] for s in srcs if s['activation']['status'] == 'RETIRED']},
           'feedCompleteness': {'verdict': 'ALL_ACTIVE_FEEDS_COMPLETE' if srcs and all(s['completeness']['verdict'] == 'CONFIGURED_FEED_ENUMERATED_COMPLETELY' for s in srcs if s['activation']['status'] == 'ACTIVE') and any(s['activation']['status'] == 'ACTIVE' for s in srcs)
                                else 'SOME_ACTIVE_FEED_PARTIAL_OR_UNPROVEN' if any(s['activation']['status'] == 'ACTIVE' for s in srcs) else 'NO_ACTIVE_FEED'},
           'worldwideCoverage': {'verdict': 'NOT_PROVEN', 'observedPortals': len({c['portal'] for c in res.get('atsCandidates', [])} | {s['tenantKey'] for s in srcs}),
                                 'note': 'A complete configured feed proves nothing about other regional, brand or business-unit portals; investigation pending.'},
           'activeJobs': counts.get(single, {}).get('world') if single else None, 'franceJobs': counts.get(single, {}).get('france') if single else None}
    row['blockingReasons'] = blocking_reason(r, fj, ident, portal, res, srcs); row['nextAction'] = next_action(fj, ident, portal, res, srcs)
    tracker.append(row)

# ---------------------------------------------------------------- per-source table (all catalogued sources)
source_table = []
for s in snap['sources']:
    owners = [companies[sc['companyId']]['name'] for sc in snap['sourceCompanies'] if sc['sourceKey'] == s['key'] and sc['active'] > 0][:5]
    source_table.append({'key': s['key'], 'maison': s['maison'], 'kind': s['kind'], 'tenantKey': s['tenantKey'], 'certification': certify(s), 'activation': activation(s), 'completeness': completeness(s), 'employersWithActiveJobs': owners})

# ---------------------------------------------------------------- outputs
(out / 'fashionjobs-tracker.json').write_text(json.dumps(tracker, ensure_ascii=False, indent=1))
(out / 'sources-qualification.json').write_text(json.dumps(source_table, ensure_ascii=False, indent=1))
def cell(v): return "'" + v if isinstance(v, str) and v.startswith(('=', '+', '-', '@')) else v
with (out / 'fashionjobs-tracker.csv').open('w') as f:
    w = csv.writer(f); w.writerow(['ID', 'Libellés RAW', 'Éditions', 'Correspondance FashionJobs', 'Entreprises candidates', 'Identité canonique attestée', 'Preuve identité (méthode · domaine · date)', 'Portail officiel confirmé', 'Recherche portail (statut)', 'Pages lues', 'Échecs documentés', 'URLs non visitées', 'Sources BDD (clé:statut)', 'Certification config courante', 'Activation', 'Complétude flux configuré (verdict · date)', 'Couverture mondiale', 'Offres actives (candidat unique)', 'France', 'Motifs non résolus', 'Action restante', 'Dernière vérification BDD'])
    for t in tracker:
        proofs = [x for c in t['canonicalIdentity']['companies'] for x in c['proofs'] if x['kind'] == 'EMPLOYER_IDENTITY_REVIEW' or x.get('verdict') == 'CERTIFIED_CURRENT']
        proof_txt = ' | '.join((f"{x['method']} · {x['officialDomain']} · {x['checkedAt'][:10]}" if x['kind'] == 'SOURCE_IDENTITY_REVIEW' else f"employer review {x['reviewId'][:12]} · {x['reviewedAt'][:10]}") for x in proofs)
        comp = ' | '.join(f"{s['key']}: {s['completeness']['verdict']} · {(s['completeness']['measuredAt'] or '')[:10]}" for s in t['sources'])
        w.writerow([cell(x) for x in [t['id'], ' | '.join(t['labels']), ' | '.join(t['editions']), t['fashionjobsMatch']['verdict'], ' | '.join(c['name'] for c in t['canonicalIdentity']['companies']), t['canonicalIdentity']['verdict'], proof_txt, t['officialPortal']['verdict'] + (' · ' + ' | '.join(c['portalUrl'] for c in t['officialPortal']['confirmed']) if t['officialPortal']['confirmed'] else ''), t['portalResearch']['verdict'], t['portalResearch'].get('pagesRead', 0), len(t['portalResearch'].get('failures', [])), len(t['portalResearch'].get('unvisitedUrls', [])), ' | '.join(f"{s['key']}:{s['activation']['status']}" for s in t['sources']), ' | '.join(f"{s['key']}: {s['certification']['verdict']}" for s in t['sources']), t['activation']['verdict'], comp, t['worldwideCoverage']['verdict'], t['activeJobs'], t['franceJobs'], '; '.join(t['blockingReasons']), t['nextAction'], t['databaseAt']]])
with (out / 'sources-qualification.csv').open('w') as f:
    w = csv.writer(f); w.writerow(['Clé', 'Maison', 'Kind', 'Tenant', 'Statut', 'Certification config courante', 'Méthode · domaine · date', 'Dernier run (statut · offres · date)', 'Complétude flux configuré', 'Mesuré le', 'Compteurs (fetched / uniques / déclaré)', 'Employeurs actifs'])
    for s in source_table:
        rv = s['certification'].get('review') or {}; l = s['completeness']['latest'] or {}
        w.writerow([cell(x) for x in [s['key'], s['maison'], s['kind'], s['tenantKey'], s['activation']['status'], s['certification']['verdict'], f"{rv.get('method','')} · {rv.get('officialDomain','')} · {(rv.get('checkedAt') or '')[:10]}".strip(' ·'), f"{s['activation']['lastRunStatus'] or ''} · {s['activation']['lastRunJobs'] if s['activation']['lastRunJobs'] is not None else ''} · {(s['activation']['lastRunAt'] or '')[:10]}", s['completeness']['verdict'], (s['completeness']['measuredAt'] or '')[:19], f"{l.get('fetched','')} / {l.get('uniqueIds', l.get('accepted',''))} / {l.get('declaredTotal','')}", ' | '.join(s['employersWithActiveJobs'])]])

def dist(items, key): return dict(collections.Counter(key(x) for x in items))
after = {
    'databaseAt': snap['at'], 'totals': snap['totals'][0], 'rows': len(tracker), 'labels': sum(len(t['labels']) for t in tracker),
    'fashionjobsMatch': dist(tracker, lambda t: t['fashionjobsMatch']['verdict']),
    'canonicalIdentity': dist(tracker, lambda t: t['canonicalIdentity']['verdict']),
    'officialPortal': dist(tracker, lambda t: t['officialPortal']['verdict']),
    'portalResearch': dist(tracker, lambda t: t['portalResearch']['verdict']),
    'activation': dist(tracker, lambda t: t['activation']['verdict']),
    'feedCompleteness': dist(tracker, lambda t: t['feedCompleteness']['verdict']),
    'worldwideCoverage': dist(tracker, lambda t: t['worldwideCoverage']['verdict']),
    'actorsWithUnvisitedUrls': sum(1 for t in tracker if t['portalResearch'].get('unvisitedUrls')),
    'unvisitedUrls': sum(len(t['portalResearch'].get('unvisitedUrls', [])) for t in tracker),
    'actorsWithDocumentedFailures': sum(1 for t in tracker if t['portalResearch'].get('failures')),
    'sources': {'total': len(source_table), 'byStatus': dist(source_table, lambda s: s['activation']['status']),
                'certification': dist(source_table, lambda s: s['certification']['verdict']),
                'certificationActiveOnly': dist([s for s in source_table if s['activation']['status'] == 'ACTIVE'], lambda s: s['certification']['verdict']),
                'completenessActiveOnly': dist([s for s in source_table if s['activation']['status'] == 'ACTIVE'], lambda s: s['completeness']['verdict']),
                'withNativeReceipt': sum(1 for s in source_table if any(e['kind'] == 'NATIVE_RECEIPT' for e in s['completeness']['evidence'])),
                # The earlier baseline (385/423) counted a source complete if ANY receipt ever said so.
                # The verdict above uses the LATEST evidence: a later partial receipt supersedes an older complete one.
                'activeWithAnyCompleteReceiptEver': sum(1 for s in source_table if s['activation']['status'] == 'ACTIVE' and s['key'] in ever_complete),
                'activeCompleteOnLatestReceiptOnly': sum(1 for s in source_table if s['activation']['status'] == 'ACTIVE' and (receipts.get(s['key']) or {}).get('status') == 'FETCH_COMPLETE'),
                'activeRegressedSinceCompleteReceipt': sorted(s['key'] for s in source_table if s['activation']['status'] == 'ACTIVE' and s['key'] in ever_complete and (receipts.get(s['key']) or {}).get('status') != 'FETCH_COMPLETE')},
    'note': 'Each dimension is measured separately. ATTESTED identity never implies a confirmed portal, an active source, a complete feed or worldwide coverage, and vice versa.'}
before = json.load(open(a.previous_summary)) if a.previous_summary else None
(out / 'progress-summary.json').write_text(json.dumps({'before': before, 'after': after}, ensure_ascii=False, indent=2))
print(json.dumps(after, ensure_ascii=False, indent=1))
