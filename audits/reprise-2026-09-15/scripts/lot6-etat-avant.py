"""Relevé en lecture seule de l'état du catalogue avant le lot 6 (recherche bornée par marché).

Mesure ce que le périmètre SQL de la recherche ne borne pas encore : la répartition des offres
publiables par pays, la part du stock hors des périmètres des douze marchés, les offres sans pays,
le télétravail sans pays prouvé, les villes présentes dans plusieurs pays, la couverture des codes
postaux et des subdivisions, et l'absence de toute table d'offres directes. Le script interroge
PostgreSQL dans le conteneur ciblé avec `default_transaction_read_only=on` : il ne peut rien écrire.

usage: python3 -B lot6-etat-avant.py --target=clone|test --out=<fichier.json>

Les identifiants de connexion viennent des fichiers d'état privés du dossier d'audit (jamais
versionnés) ; seuls des agrégats sont écrits dans le fichier de sortie.
"""
import json
import os
import pathlib
import subprocess
import sys
from urllib.parse import urlparse

AUDIT = pathlib.Path(os.environ.get('CATWALKS_AUDIT_DIR', '/tmp/catwalks-audit-20260915'))
STATE = {
    'clone': ('lot4e3-state.private.json', 'catwalks_rehearsal_20260915'),
    'test': ('lot1-test-state.json', 'catwalks_lifecycle_test'),
}

# Périmètres géographiques des marchés tels que le site les servait avant le lot (marche.ts du website).
PERIMETRES = {
    'FR': ['FR'], 'DE': ['DE', 'AT'], 'GB': ['GB', 'IE'], 'US': ['US'], 'IT': ['IT'], 'ES': ['ES'],
    'BE': ['BE'], 'CH': ['CH'], 'CA': ['CA'], 'NL': ['NL'], 'AU': ['AU'], 'CN': ['CN'],
}
PAYS_MARCHES = sorted({p for pays in PERIMETRES.values() for p in pays})

PUBLIC = """j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS (
    SELECT 1 FROM "JobSource" s WHERE s."jobId" = j.id AND s."isActive" AND (s."expiresAt" IS NULL OR s."expiresAt" > now()))"""

QUERIES = {
    'publiables': f"""SELECT json_build_object(
        'monde',(SELECT count(*) FROM "Job" j WHERE {PUBLIC}),
        'sansPays',(SELECT count(*) FROM "Job" j WHERE {PUBLIC} AND j."countryCode" IS NULL),
        'paysNonIso2',(SELECT count(*) FROM "Job" j WHERE {PUBLIC} AND j."countryCode" IS NOT NULL AND j."countryCode" !~ '^[A-Z]{{2}}$'),
        'isFranceSansCodeFR',(SELECT count(*) FROM "Job" j WHERE {PUBLIC} AND j."isFrance" AND (j."countryCode" IS NULL OR j."countryCode" <> 'FR')),
        'codeFRSansIsFrance',(SELECT count(*) FROM "Job" j WHERE {PUBLIC} AND j."countryCode" = 'FR' AND NOT j."isFrance"),
        'paysDistincts',(SELECT count(DISTINCT j."countryCode") FROM "Job" j WHERE {PUBLIC} AND j."countryCode" IS NOT NULL),
        'parPays',(SELECT json_agg(t) FROM (SELECT j."countryCode" AS pays, count(*)::int AS n FROM "Job" j WHERE {PUBLIC}
            GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 40) t))""",
    'marches': f"""SELECT json_build_object(
        'dansUnPerimetre',(SELECT count(*) FROM "Job" j WHERE {PUBLIC} AND j."countryCode" = ANY(ARRAY{PAYS_MARCHES}::text[])),
        'horsPerimetres',(SELECT count(*) FROM "Job" j WHERE {PUBLIC} AND j."countryCode" IS NOT NULL AND NOT (j."countryCode" = ANY(ARRAY{PAYS_MARCHES}::text[]))),
        'parMarche',(SELECT json_object_agg(m.code, m.n) FROM (VALUES {', '.join(f"('{code}', (SELECT count(*)::int FROM \"Job\" j WHERE {PUBLIC} AND j.\"countryCode\" = ANY(ARRAY{pays}::text[])))" for code, pays in PERIMETRES.items())}) AS m(code, n)),
        'horsPerimetresParPays',(SELECT json_agg(t) FROM (SELECT j."countryCode" AS pays, count(*)::int AS n FROM "Job" j WHERE {PUBLIC}
            AND j."countryCode" IS NOT NULL AND NOT (j."countryCode" = ANY(ARRAY{PAYS_MARCHES}::text[])) GROUP BY 1 ORDER BY 2 DESC LIMIT 25) t))""",
    'teletravail': f"""SELECT json_build_object(
        'remote',(SELECT count(*) FROM "Job" j WHERE {PUBLIC} AND j."workplaceType" = 'REMOTE'),
        'remoteSansPays',(SELECT count(*) FROM "Job" j WHERE {PUBLIC} AND j."workplaceType" = 'REMOTE' AND j."countryCode" IS NULL),
        'hybrid',(SELECT count(*) FROM "Job" j WHERE {PUBLIC} AND j."workplaceType" = 'HYBRID'),
        'remoteParPays',(SELECT json_agg(t) FROM (SELECT j."countryCode" AS pays, count(*)::int AS n FROM "Job" j WHERE {PUBLIC}
            AND j."workplaceType" = 'REMOTE' GROUP BY 1 ORDER BY 2 DESC NULLS LAST LIMIT 12) t))""",
    'lieux': f"""SELECT json_build_object(
        'avecVille',(SELECT count(*) FROM "Job" j WHERE {PUBLIC} AND j.city IS NOT NULL AND j.city <> ''),
        'avecCodePostal',(SELECT count(*) FROM "Job" j WHERE {PUBLIC} AND j."postalCode" IS NOT NULL AND j."postalCode" <> ''),
        'avecSubdivision',(SELECT count(*) FROM "Job" j WHERE {PUBLIC} AND j."adminArea1" IS NOT NULL AND j."adminArea1" <> ''),
        'villesMultiPays',(SELECT count(*) FROM (SELECT upper(trim(j.city)) AS ville FROM "Job" j WHERE {PUBLIC}
            AND j.city IS NOT NULL AND j."countryCode" IS NOT NULL GROUP BY 1 HAVING count(DISTINCT j."countryCode") > 1) v),
        'villesDistinctes',(SELECT count(DISTINCT upper(trim(j.city))) FROM "Job" j WHERE {PUBLIC} AND j.city IS NOT NULL AND j."countryCode" IS NOT NULL),
        'parisParPays',(SELECT json_agg(t) FROM (SELECT j."countryCode" AS pays, j."adminArea1" AS subdivision, count(*)::int AS n FROM "Job" j
            WHERE {PUBLIC} AND upper(trim(j.city)) = 'PARIS' GROUP BY 1,2 ORDER BY 3 DESC NULLS LAST) t),
        'texas',(SELECT count(*) FROM "Job" j WHERE {PUBLIC} AND j."adminArea1" = 'Texas'),
        'villesFrontalieresBEFR',(SELECT json_agg(t) FROM (SELECT upper(trim(j.city)) AS ville, j."countryCode" AS pays, count(*)::int AS n FROM "Job" j
            WHERE {PUBLIC} AND upper(trim(j.city)) IN ('LILLE','TOURNAI','MOUSCRON','MONS','VALENCIENNES') GROUP BY 1,2 ORDER BY 1,2) t))""",
    'facettesInconnues': f"""SELECT json_build_object(
        'FR',(SELECT json_build_object('total',count(*),'contratNull',count(*) FILTER (WHERE j."employmentTerm" IS NULL),
            'tempsNull',count(*) FILTER (WHERE j."workTime" IS NULL)) FROM "Job" j WHERE {PUBLIC} AND j."countryCode" = 'FR'),
        'US',(SELECT json_build_object('total',count(*),'contratNull',count(*) FILTER (WHERE j."employmentTerm" IS NULL),
            'tempsNull',count(*) FILTER (WHERE j."workTime" IS NULL)) FROM "Job" j WHERE {PUBLIC} AND j."countryCode" = 'US'))""",
    'schema': """SELECT json_build_object(
        'directOfferTable',(SELECT count(*) FROM information_schema.tables WHERE table_name IN ('DirectOffer','DirectOfferVersion','CatalogueDirect')),
        'searchTextIndex',(SELECT count(*) FROM pg_indexes WHERE tablename = 'Job' AND indexname = 'Job_searchText_trgm_idx'),
        'migrations',(SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL),
        'sourcesCatwalks',(SELECT count(*) FROM "Source" WHERE key ILIKE '%catwalks%'),
        'jobSourcesCatwalks',(SELECT count(*) FROM "JobSource" WHERE "sourceKey" ILIKE '%catwalks%'))""",
}


def main() -> int:
    args = {a.split('=', 1)[0][2:]: a.split('=', 1)[1] for a in sys.argv[1:] if a.startswith('--') and '=' in a}
    target, out = args.get('target'), args.get('out')
    if target not in STATE or not out:
        print(__doc__, file=sys.stderr)
        return 2
    file_name, expected_db = STATE[target]
    state = json.loads((AUDIT / file_name).read_text())
    url = urlparse(state['url'])
    assert url.hostname == '127.0.0.1' and url.path == f'/{expected_db}', 'unexpected database target'
    if target == 'clone':
        assert state.get('database') == expected_db and state.get('status') == 'HISTORICAL_WITHDRAWAL_APPLIED_AND_AUDITED'
    env = {k: v for k, v in os.environ.items() if k not in ('DOCKER_HOST', 'DOCKER_CONTEXT')}
    docker = ['docker', '--host', state['endpoint'], 'exec', '-i', '-e',
              'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=300000',
              state['container'], 'psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1',
              '--username=catwalks', f'--dbname={expected_db}']

    def query(sql: str):
        run = subprocess.run(docker, input=sql + ';', text=True, env=env, capture_output=True)
        if run.returncode:
            raise SystemExit(f'query failed: {run.stderr.strip()}')
        return json.loads(run.stdout)

    # The read-only mode is proven, not assumed: a write must be refused by the server.
    probe = subprocess.run(docker, input='CREATE TEMP TABLE x(a int);', text=True, env=env, capture_output=True)
    assert probe.returncode != 0 and 'read-only' in probe.stderr, 'read-only transaction mode is not enforced'

    result = {'target': target, 'database': expected_db, 'container': state['container'], 'readOnlyProven': True,
              'perimetresMarches': PERIMETRES, 'measuredAt': query("SELECT to_json(now())")}
    for name, sql in QUERIES.items():
        result[name] = query(sql)
    pathlib.Path(out).write_text(json.dumps(result, indent=2, default=str) + '\n')
    print(json.dumps({k: result[k] for k in ('target', 'measuredAt', 'publiables', 'marches', 'schema')}, indent=1, default=str))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
