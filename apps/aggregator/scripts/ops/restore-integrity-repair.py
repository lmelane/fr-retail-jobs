#!/usr/bin/env python3
"""Restore one real dump to a NEW LOCAL clone; inventory ALL FKs before any repair.

No production mode, deletion of business rows, invented parents, disabled integrity,
or partial repair. Unknown semantics block the entire repair. Exit 0 means the
complete post-data section restored and every FK/check/trigger was verified.
Only PostgreSQL's emitted FK/PK DDL is accepted; an unsupported shape fails closed.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

IDENT = r'(?:"(?:[^"\n]|"")+"|[A-Za-z_][A-Za-z_0-9$]*)'
QUALIFIED = rf'{IDENT}\.{IDENT}'
ALTER = re.compile(rf'^ALTER TABLE (?:ONLY )?(?P<table>{QUALIFIED})\n\s+ADD CONSTRAINT (?P<name>{IDENT}) (?P<body>[^;]+);$', re.M)
FK_BODY = re.compile(rf'^FOREIGN KEY \((?P<cols>[^)]+)\) REFERENCES (?P<parent>{QUALIFIED})\((?P<refs>[^)]+)\)(?P<options>.*)$')
OPTION = re.compile(r'^(?: MATCH (?:SIMPLE|FULL)| ON (?:UPDATE|DELETE) (?:NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)| NOT DEFERRABLE| DEFERRABLE| INITIALLY (?:IMMEDIATE|DEFERRED)| NOT VALID)*$')
# Explicit semantic decisions, never inferred from nullability alone.
SAFE_NULL = {('public.CompanyAlias', ('reviewId',), 'public.EmployerIdentityReview', ('id',)):
             'resolveEmployer and companyIdentityWhere ignore aliases without reviewId; no Job state change'}
UNSAFE_NULL = {('public.Company', ('identityReviewId',), 'public.EmployerIdentityReview', ('id',)):
               'Company_identity_relationship_review requires evidence for relationships; canonicalEmployer follows merges without checking reviewId'}


def qi(s):
    return '"' + s.replace('"', '""') + '"'


def literal(s):
    return "'" + s.replace("'", "''") + "'"


def ident(s):
    s = s.strip()
    if not re.fullmatch(IDENT, s):
        raise ValueError('Unsupported SQL identifier')
    return s[1:-1].replace('""', '"') if s.startswith('"') else s.lower()


def qualified(s):
    parts = re.findall(IDENT, s)
    if len(parts) != 2 or '.'.join(parts) != s:
        raise ValueError('Unsupported schema/table identifier')
    return tuple(ident(x) for x in parts)


def columns(s):
    # Commas in quoted identifiers are supported, not split blindly.
    parts = re.findall(IDENT, s)
    if re.sub(r'\s+', '', ','.join(parts)) != re.sub(r'\s+', '', s):
        raise ValueError('Unsupported column list')
    return tuple(ident(x) for x in parts)


def table_sql(table):
    return '.'.join(qi(x) for x in table)


def parse_schema(sql):
    fks, primary = [], {}
    for match in ALTER.finditer(sql):
        table, name, body = qualified(match['table']), ident(match['name']), match['body']
        if body.startswith('PRIMARY KEY '):
            p = re.fullmatch(r'PRIMARY KEY \(([^)]+)\)', body)
            if not p:
                raise ValueError('Unsupported primary key')
            primary[table] = columns(p[1])
        if not body.startswith('FOREIGN KEY '):
            continue
        f = FK_BODY.fullmatch(body)
        if not f or not OPTION.fullmatch(f['options']):
            raise ValueError(f'Unsupported FK: {name}')
        child, parent = columns(f['cols']), columns(f['refs'])
        if len(child) != len(parent):
            raise ValueError('FK arity mismatch')
        fks.append({'table': table, 'name': name, 'columns': child,
                    'parent': qualified(f['parent']), 'references': parent,
                    'match': 'FULL' if 'MATCH FULL' in f['options'] else 'SIMPLE',
                    'notValid': 'NOT VALID' in f['options']})
    # Reject rather than silently omit unsupported/inline FK forms.
    if len(fks) != len(re.findall(r'\bFOREIGN KEY\s*\(', sql)):
        raise ValueError('Not all foreign keys were parsed')
    if len({(f['table'], f['name']) for f in fks}) != len(fks) or not fks:
        raise ValueError('Empty or duplicate FK inventory')
    for f in fks:
        if f['table'] not in primary:
            raise ValueError(f'No stable primary key for {f["table"]}')
        f['primaryKey'] = primary[f['table']]
    return sorted(fks, key=lambda f: (f['table'], f['name']))


def orphan_where(f):
    fields = ['c.' + qi(x) for x in f['columns']]
    present = '(' + ' AND '.join(x + ' IS NOT NULL' for x in fields) + ')'
    missing = 'NOT EXISTS (SELECT 1 FROM ' + table_sql(f['parent']) + ' p WHERE ' + ' AND '.join(
        'p.' + qi(parent) + ' = c.' + qi(child) for child, parent in zip(f['columns'], f['references'])) + ')'
    invalid = f'({present} AND {missing})'
    if f['match'] == 'FULL':
        partial = '(' + ' OR '.join(x + ' IS NULL' for x in fields) + ') AND (' + ' OR '.join(x + ' IS NOT NULL' for x in fields) + ')'
        invalid = '(' + invalid + ' OR (' + partial + '))'
    return invalid


def row_expression(f):
    return 'jsonb_build_object(' + ','.join(literal(k) + ',c.' + qi(k) for k in dict.fromkeys((*f['primaryKey'], *f['columns']))) + ')'


def population_sql(f):
    row = row_expression(f)
    return ('SELECT jsonb_build_object(\'count\',count(*),\'sha256\',encode(sha256(convert_to('
            f"COALESCE(jsonb_agg({row} ORDER BY ({row})::text COLLATE \"C\")::text,'[]'),'UTF8')),'hex')) "
            f'FROM {table_sql(f["table"])} c WHERE {orphan_where(f)}')


def classify(f, nullable):
    key = ('.'.join(f['table']), tuple(f['columns']), '.'.join(f['parent']), tuple(f['references']))
    if not all(nullable):
        return 'STOP_NON_NULLABLE', 'At least one child column is not nullable'
    if key in UNSAFE_NULL:
        return 'STOP_UNSAFE_SEMANTICS', UNSAFE_NULL[key]
    if key in SAFE_NULL:
        return 'SET_NULL', SAFE_NULL[key]
    return 'STOP_UNKNOWN_SEMANTICS', 'No explicit fail-closed semantic decision; no parent inferred'


def repair_sql(entries):
    if any(e['population']['count'] and e['action'] != 'SET_NULL' for e in entries):
        raise ValueError('Blocked population: no partial repair')
    # Lock parents too: the classification must not change if a parent reappears.
    tables = sorted({tuple(e[k]) for e in entries for k in ('table', 'parent')})
    sql = ['BEGIN;', 'SET LOCAL session_replication_role = origin;', 'SET LOCAL lock_timeout = \'5s\';',
           'LOCK TABLE ' + ','.join(table_sql(t) for t in tables) + ' IN SHARE ROW EXCLUSIVE MODE;']
    # All populations, including zero, are compared BEFORE the first UPDATE.
    for e in entries:
        expected = literal(json.dumps(e['population'], sort_keys=True)) + '::jsonb'
        sql.append(f"DO $repair$ BEGIN IF ({population_sql(e)}) IS DISTINCT FROM {expected} THEN RAISE EXCEPTION 'Population changed'; END IF; END $repair$;")
    for e in entries:
        if not e['population']['count']:
            continue
        fields = ','.join(qi(x) + '=NULL' for x in e['columns'])
        sql.append(f'UPDATE {table_sql(e["table"])} c SET {fields} WHERE {orphan_where(e)};')
    # Recheck globally before commit; a nullable column can also be another FK's parent.
    for e in entries:
        sql.append(f"DO $repair$ BEGIN IF EXISTS (SELECT 1 FROM {table_sql(e['table'])} c WHERE {orphan_where(e)}) THEN RAISE EXCEPTION 'Remaining orphan'; END IF; END $repair$;")
    sql.append('COMMIT;')
    return '\n'.join(sql)


class Clone:
    def __init__(self, container, database):
        if not re.fullmatch(r'catwalks-[a-z0-9-]+', container) or not re.fullmatch(r'restore_integrity_[a-z0-9_]+', database):
            raise ValueError('Explicit Catwalks container and new restore_integrity_* database required')
        context = json.loads(subprocess.check_output(['docker', 'context', 'inspect']))[0]
        if not context['Endpoints']['docker']['Host'].startswith('unix://'):
            raise ValueError('Local Docker socket required')
        info = json.loads(subprocess.check_output(['docker', 'inspect', container]))[0]
        env = dict(x.split('=', 1) for x in info['Config']['Env'] if '=' in x)
        self.user = env.get('POSTGRES_USER', 'postgres')
        self.container, self.database = container, database

    def command(self, exe, *args):
        return ['docker', 'exec', '-i', self.container, exe, '-h', '/var/run/postgresql', '-U', self.user, *args]

    def sql(self, sql):
        p = subprocess.run(self.command('psql', '-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-d', self.database),
                           input="SET timezone='UTC'; SET statement_timeout='180s';\n" + sql,
                           text=True, capture_output=True)
        if p.returncode:
            raise RuntimeError(p.stderr)
        return p.stdout.strip()

    def json(self, sql):
        return json.loads(self.sql(sql))

    def create(self):
        # createdb refuses existing databases. Never drop, overwrite or reuse one implicitly.
        subprocess.run(self.command('createdb', '--template=template0', self.database), check=True, capture_output=True)

    def restore(self, dump, section, log):
        with dump.open('rb') as data, log.open('wb') as output:
            r = subprocess.run(self.command('pg_restore', '--exit-on-error', '--no-owner', '--no-privileges',
                                            '--section=' + section, '-d', self.database), stdin=data, stdout=output, stderr=output)
        if r.returncode:
            raise RuntimeError(f'Restore {section} failed; see {log.name}')


def write(path, value):
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + '\n')


def inventory(clone, fks):
    entries = []
    for f in fks:
        nullable = clone.json('SELECT json_agg(NOT attnotnull ORDER BY array_position(ARRAY[' + ','.join(literal(c) for c in f['columns']) +
            ']::text[],attname::text)) FROM pg_attribute WHERE attrelid=' + literal(table_sql(f['table'])) + "::regclass AND attname=ANY(ARRAY[" +
            ','.join(literal(c) for c in f['columns']) + ']::text[]) AND NOT attisdropped;')
        if len(nullable or []) != len(f['columns']):
            raise ValueError('Missing FK column')
        action, reason = classify(f, nullable)
        entries.append({**f, 'nullable': nullable, 'population': clone.json(population_sql(f)), 'action': action, 'reason': reason})
    return entries



def identity_impact(clone, at):
    required = ['CompanyAlias', 'EmployerIdentityReview', 'Company', 'Job', 'JobSource', 'Source',
                'JobEvent', 'OccupationObservation', 'SourceIngestionCompletion', 'CaptureBatch',
                'RawBlob', 'SourceObservation']
    present = clone.json("SELECT json_agg(tablename) FROM pg_tables WHERE schemaname='public';")
    if not set(required) <= set(present or []):
        return {'status': 'UNAVAILABLE', 'reason': 'Application tables absent; no invented impact count'}
    at_literal = literal(at)
    return {'status': 'MEASURED', 'at': at, **clone.json(f'''
WITH orphan_alias AS (
 SELECT a.* FROM "CompanyAlias" a WHERE a."reviewId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "EmployerIdentityReview" r WHERE r.id=a."reviewId")
), orphan_company AS (
 SELECT c.* FROM "Company" c WHERE c."identityReviewId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "EmployerIdentityReview" r WHERE r.id=c."identityReviewId")
), affected_company AS (
 SELECT id FROM orphan_company UNION SELECT "companyId" FROM orphan_alias
), public_job AS (
 SELECT j.id,j."companyId" FROM "Job" j WHERE j."isActive" AND j."mergedIntoId" IS NULL AND EXISTS(SELECT 1 FROM "JobSource" js WHERE js."jobId"=j.id AND js."isActive" AND (js."expiresAt" IS NULL OR js."expiresAt">TIMESTAMPTZ {at_literal}))
), affected_sources AS (
 SELECT "sourceKey" FROM orphan_alias UNION SELECT js."sourceKey" FROM "JobSource" js JOIN "Job" j ON j.id=js."jobId" JOIN affected_company c ON c.id=j."companyId"
)
SELECT json_build_object(
 'orphanCompanies',(SELECT count(*) FROM orphan_company),
 'orphanAliases',(SELECT count(*) FROM orphan_alias),
 'aliasCompanies',(SELECT count(DISTINCT "companyId") FROM orphan_alias),
 'combinedCompanies',(SELECT count(*) FROM affected_company),
 'activeSourcesViaAliases',(SELECT count(*) FROM "Source" s WHERE s.status='ACTIVE' AND s.key IN (SELECT "sourceKey" FROM orphan_alias)),
 'activeSourcesCombined',(SELECT count(*) FROM "Source" s WHERE s.status='ACTIVE' AND s.key IN (SELECT "sourceKey" FROM affected_sources)),
 'publishableJobsTotal',(SELECT count(*) FROM public_job),
 'publishableJobsAtOrphanCompanies',(SELECT count(*) FROM public_job WHERE "companyId" IN (SELECT id FROM orphan_company)),
 'publishableJobsAtAliasCompanies',(SELECT count(*) FROM public_job WHERE "companyId" IN (SELECT "companyId" FROM orphan_alias)),
 'publishableJobsCombined',(SELECT count(*) FROM public_job WHERE "companyId" IN (SELECT id FROM affected_company)),
 'companyRowsViolatingCheckIfNull',(SELECT count(*) FROM orphan_company WHERE "mergedIntoId" IS NOT NULL OR "parentGroupId" IS NOT NULL),
 'distinctAffectedRecords', (SELECT count(*) FROM (
  SELECT 'Company' t,id FROM orphan_company UNION ALL SELECT 'CompanyAlias',id FROM orphan_alias
  UNION ALL SELECT 'JobEvent',e.id FROM "JobEvent" e WHERE NOT EXISTS(SELECT 1 FROM "Job" j WHERE j.id=e."jobId")
  UNION ALL SELECT 'OccupationObservation',o.id FROM "OccupationObservation" o WHERE NOT EXISTS(SELECT 1 FROM "Job" j WHERE j.id=o."jobId")
  UNION ALL SELECT 'SourceIngestionCompletion',c."batchId" FROM "SourceIngestionCompletion" c WHERE NOT EXISTS(SELECT 1 FROM "CaptureBatch" b WHERE b.id=c."batchId") OR NOT EXISTS(SELECT 1 FROM "RawBlob" b WHERE b.hash=c."reportHash")
  UNION ALL SELECT 'SourceObservation',o.id FROM "SourceObservation" o WHERE o."captureBatchId" IS NOT NULL AND NOT EXISTS(SELECT 1 FROM "CaptureBatch" b WHERE b.id=o."captureBatchId")
 ) x)
);
''')}


def validate_final(clone, fks):
    actual = clone.json("SELECT COALESCE(json_agg(json_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,'validated',k.convalidated)),'[]') FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE k.contype='f' AND n.nspname NOT IN ('pg_catalog','information_schema');")
    if {(x['schema'], x['table'], x['name']) for x in actual} != {(f['table'][0], f['table'][1], f['name']) for f in fks}:
        raise ValueError('Restored FK set differs from dump')
    if any(not x['validated'] for x in actual):
        raise ValueError('NOT VALID FK remains')
    disabled = clone.json("SELECT count(*) FROM pg_trigger WHERE tgenabled NOT IN ('O','A');")
    unvalidated = clone.json("SELECT count(*) FROM pg_constraint WHERE contype IN ('c','f') AND NOT convalidated;")
    role = clone.sql('SHOW session_replication_role;')
    if disabled or unvalidated or role != 'origin':
        raise ValueError('Inactive integrity protection')
    after = inventory(clone, fks)
    if any(x['population']['count'] for x in after):
        raise ValueError('Orphans remain')
    return {'foreignKeys': len(actual), 'disabledTriggers': disabled, 'unvalidatedConstraints': unvalidated, 'replicationRole': role, 'orphans': 0}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--dump', type=Path, required=True)
    parser.add_argument('--dump-sha256', required=True)
    parser.add_argument('--container', required=True)
    parser.add_argument('--database', required=True)
    parser.add_argument('--out-dir', type=Path, required=True)
    parser.add_argument('--pg-restore', default='/opt/homebrew/opt/libpq/bin/pg_restore')
    args = parser.parse_args()
    os.umask(0o077)
    args.out_dir.mkdir(parents=True, exist_ok=False)
    report = {'status': 'FAILED', 'restoreComplete': False, 'mutatedRows': 0, 'applicationValidation': 'NOT_EXECUTED'}
    try:
        digest = hashlib.file_digest(args.dump.open('rb'), 'sha256').hexdigest()
        if digest != args.dump_sha256:
            raise ValueError('Dump hash mismatch')
        post = args.out_dir / 'post-data.sql'
        subprocess.run([args.pg_restore, '--section=post-data', '--file=' + str(post), str(args.dump)], check=True, capture_output=True)
        fks = parse_schema(post.read_text())
        write(args.out_dir / 'foreign-keys.json', fks)
        clone = Clone(args.container, args.database)
        clone.create()
        report.update(database=args.database, dumpSha256=digest, foreignKeys=len(fks))
        for section in ['pre-data', 'data']:
            clone.restore(args.dump, section, args.out_dir / (section + '.log'))
        clone.sql('ANALYZE;')
        measured_at = clone.sql('SELECT clock_timestamp()::text;')
        entries = inventory(clone, fks)
        write(args.out_dir / 'inventory.json', entries)
        report['identityImpact'] = identity_impact(clone, measured_at)
        canonical = json.dumps(entries, sort_keys=True, separators=(',', ':'))
        plan_hash = hashlib.sha256(canonical.encode()).hexdigest()
        write(args.out_dir / 'plan.json', {'dumpSha256': digest, 'planSha256': plan_hash, 'foreignKeys': entries})
        violations = [e for e in entries if e['population']['count']]
        blocked = [e for e in violations if e['action'] != 'SET_NULL']
        report.update(planSha256=plan_hash, orphanForeignKeys=len(violations), orphanReferences=sum(e['population']['count'] for e in violations),
                      repairableForeignKeys=len(violations)-len(blocked), blockedForeignKeys=len(blocked))
        if blocked or any(f['notValid'] for f in fks):
            report['status'] = 'BLOCKED_BEFORE_REPAIR'
            report['blockers'] = [{'constraint': e['name'], 'count': e['population']['count'], 'reason': e['reason']} for e in blocked]
            return 2
        sql = repair_sql(entries)
        (args.out_dir / 'repair.sql').write_text(sql)
        clone.sql(sql)
        report['mutatedRows'] = sum(e['population']['count'] for e in violations)
        clone.restore(args.dump, 'post-data', args.out_dir / 'post-data.log')
        report.update(status='PASS', restoreComplete=True, validation=validate_final(clone, fks))
        report['identityImpactAfter'] = identity_impact(clone, measured_at)
        return 0
    except Exception as error:
        report['error'] = str(error)
        return 1
    finally:
        write(args.out_dir / 'result.json', report)
        print(json.dumps(report, sort_keys=True))


if __name__ == '__main__':
    sys.exit(main())
