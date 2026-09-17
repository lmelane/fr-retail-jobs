"""Relevé en lecture seule des faits qui fondent les fermetures d'offres.

Mesure, avant le lot 5G3C, ce que les chemins de fermeture actuels lisent réellement : `SourceRun` (élagué à
10 jours), le journal `PipelineEvent`, la purge de génération (`Job.pipelineVersion < PIPELINE_VERSION`) et la
chaîne de captures scellées. Le script interroge PostgreSQL dans le conteneur ciblé avec
`default_transaction_read_only=on` : il ne peut rien écrire, même par erreur.

usage: python3 -B absence-inventory.py --target=clone|test --out=<fichier.json>

Les identifiants de connexion viennent des fichiers d'état privés du dossier d'audit (jamais versionnés) ;
seuls des agrégats sont écrits dans le fichier de sortie.
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

QUERIES = {
    'rows': """SELECT json_build_object(
        'Job',(SELECT count(*) FROM "Job"),'JobSource',(SELECT count(*) FROM "JobSource"),
        'SourceObservation',(SELECT count(*) FROM "SourceObservation"),'Source',(SELECT count(*) FROM "Source"),
        'SourceRevision',(SELECT count(*) FROM "SourceRevision"),'SourceRun',(SELECT count(*) FROM "SourceRun"),
        'PipelineRun',(SELECT count(*) FROM "PipelineRun"),'PipelineEvent',(SELECT count(*) FROM "PipelineEvent"),
        'CaptureBatch',(SELECT count(*) FROM "CaptureBatch"),'CaptureOutcome',(SELECT count(*) FROM "CaptureOutcome"),
        'SourceValidation',(SELECT count(*) FROM "SourceValidation"),
        'SourceIngestionAdmission',(SELECT count(*) FROM "SourceIngestionAdmission"),
        'SourceExtraction',(SELECT count(*) FROM "SourceExtraction"),'RawCapture',(SELECT count(*) FROM "RawCapture"),
        'MaintenancePlan',(SELECT count(*) FROM "MaintenancePlan"),'DataCorrection',(SELECT count(*) FROM "DataCorrection"),
        'migrations',(SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL))""",
    'jobsByGeneration': """SELECT json_agg(t) FROM (SELECT "pipelineVersion", "isActive", count(*)::int AS n
        FROM "Job" GROUP BY 1,2 ORDER BY 1,2) t""",
    'generationPurgeExposure': """SELECT json_build_object(
        'activeJobsBelowVersion7WithActiveSource',(SELECT count(DISTINCT j.id) FROM "Job" j JOIN "JobSource" js ON js."jobId"=j.id
            WHERE j."isActive" AND j."pipelineVersion"<7 AND js."isActive"),
        'bySource',(SELECT json_agg(t) FROM (SELECT js."sourceKey", s.status AS "sourceStatus", count(DISTINCT j.id)::int AS jobs
            FROM "Job" j JOIN "JobSource" js ON js."jobId"=j.id LEFT JOIN "Source" s ON s.key=js."sourceKey"
            WHERE j."isActive" AND j."pipelineVersion"<7 AND js."isActive" GROUP BY 1,2 ORDER BY 3 DESC LIMIT 25) t),
        'sourcesConcerned',(SELECT count(DISTINCT js."sourceKey") FROM "Job" j JOIN "JobSource" js ON js."jobId"=j.id
            WHERE j."isActive" AND j."pipelineVersion"<7 AND js."isActive"))""",
    'sourceRuns': """SELECT json_build_object(
        'total',(SELECT count(*) FROM "SourceRun"),'oldest',(SELECT min("ranAt") FROM "SourceRun"),'newest',(SELECT max("ranAt") FROM "SourceRun"),
        'withoutRunId',(SELECT count(*) FROM "SourceRun" WHERE "runId" IS NULL),
        'byStatus',(SELECT json_agg(t) FROM (SELECT status, count(*)::int AS n FROM "SourceRun" GROUP BY 1 ORDER BY 1) t),
        'latestPerSourceCanAttest',(SELECT count(*) FROM (SELECT DISTINCT ON ("sourceKey") "canAttestAbsence" FROM "SourceRun"
            ORDER BY "sourceKey","ranAt" DESC,id DESC) l WHERE l."canAttestAbsence"),
        'latestPerSourceTotal',(SELECT count(DISTINCT "sourceKey") FROM "SourceRun"),
        'activeSourcesWithoutAnyRun',(SELECT count(*) FROM "Source" s WHERE s.status='ACTIVE' AND NOT EXISTS (SELECT 1 FROM "SourceRun" r WHERE r."sourceKey"=s.key)))""",
    'pipelineEvents': """SELECT json_build_object(
        'byEvent',(SELECT json_agg(t) FROM (SELECT event, count(*)::int AS n, min(at) AS first, max(at) AS last FROM "PipelineEvent"
            WHERE event IN ('source.enumeration_observed','job.write_failed','job.publication_held','source.rows_rejected','source.purge_completed','source.purge_refused')
            GROUP BY 1 ORDER BY 1) t),
        'enumerationWithCanonicalIds',(SELECT count(*) FROM "PipelineEvent" WHERE event='source.enumeration_observed'
            AND EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(payload->'enumeration'->'pageEvidence','[]'::jsonb)) pe WHERE pe ? 'canonicalIds')),
        'sourcesWithEnumerationEvidence',(SELECT count(DISTINCT "sourceKey") FROM "PipelineEvent" WHERE event='source.enumeration_observed'),
        'runsByStatus',(SELECT json_agg(t) FROM (SELECT status, count(*)::int AS n FROM "PipelineRun" GROUP BY 1 ORDER BY 1) t))""",
    'captureChain': """SELECT json_build_object(
        'batchesByPurposeFormat',(SELECT json_agg(t) FROM (SELECT b.purpose, b."formatVersion", o.status AS outcome, count(*)::int AS n
            FROM "CaptureBatch" b LEFT JOIN "CaptureOutcome" o ON o."batchId"=b.id GROUP BY 1,2,3 ORDER BY 1,2,3) t),
        'batchesWithRevision',(SELECT count(*) FROM "CaptureBatch" WHERE "sourceRevisionId" IS NOT NULL),
        'batchesWithRunId',(SELECT count(*) FROM "CaptureBatch" WHERE "runId" IS NOT NULL),
        'admissions',(SELECT count(*) FROM "SourceIngestionAdmission"),
        'validationsByVerdict',(SELECT json_agg(t) FROM (SELECT verdict, count(*)::int AS n FROM "SourceValidation" GROUP BY 1 ORDER BY 1) t),
        'jobSourcesWithCapture',(SELECT count(*) FROM "JobSource" WHERE "captureBatchId" IS NOT NULL),
        'activeJobSources',(SELECT count(*) FROM "JobSource" WHERE "isActive"),
        'activeJobSourcesWithCapture',(SELECT count(*) FROM "JobSource" WHERE "isActive" AND "captureBatchId" IS NOT NULL),
        'observationsHeld',(SELECT count(*) FROM "SourceObservation" WHERE "publicationHold" IS NOT NULL),
        'observationsWithCapture',(SELECT count(*) FROM "SourceObservation" WHERE "captureBatchId" IS NOT NULL))""",
    'lifecycle': """SELECT json_build_object(
        'jobs',(SELECT json_agg(t) FROM (SELECT "isActive", ("closedAt" IS NOT NULL) AS closed, "withdrawalReason", count(*)::int AS n
            FROM "Job" GROUP BY 1,2,3 ORDER BY 1,2,3) t),
        'sourcesByStatus',(SELECT json_agg(t) FROM (SELECT status, count(*)::int AS n FROM "Source" GROUP BY 1 ORDER BY 1) t),
        'maintenancePlans',(SELECT json_agg(t) FROM (SELECT kind, version, count(*)::int AS n FROM "MaintenancePlan" GROUP BY 1,2 ORDER BY 1,2) t),
        'corrections',(SELECT json_agg(t) FROM (SELECT finding, count(*)::int AS n FROM "DataCorrection" GROUP BY 1 ORDER BY 1) t),
        'jobEventsByType',(SELECT json_agg(t) FROM (SELECT type, count(*)::int AS n FROM "JobEvent" GROUP BY 1 ORDER BY 1) t))""",
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
              'PGOPTIONS=-c default_transaction_read_only=on -c statement_timeout=180000',
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
              'measuredAt': query("SELECT to_json(now())")}
    for name, sql in QUERIES.items():
        result[name] = query(sql)
    pathlib.Path(out).write_text(json.dumps(result, indent=2, default=str) + '\n')
    print(json.dumps({k: result[k] for k in ('target', 'database', 'measuredAt', 'rows')}, indent=1, default=str))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
