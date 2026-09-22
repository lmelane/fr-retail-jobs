#!/usr/bin/env python3
"""Restore a real dump without changing rows. Only eight pinned historical FKs
are recreated NOT VALID; their exact populations must match the versioned policy.
All other post-data is restored normally. Local new clone only, no repair mode.
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
                    'notValid': 'NOT VALID' in f['options'], 'ddl': match[0]})
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


class Clone:
    def __init__(self, container, database):
        if not re.fullmatch(r'catwalks-[a-z0-9-]+', container) or not re.fullmatch(r'restore_operational_[a-z0-9_]+', database):
            raise ValueError('Explicit Catwalks container and new restore_operational_* database required')
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
        entries.append({**f, 'nullable': nullable, 'population': clone.json(population_sql(f))})
    return entries


POLICY_PATH = Path(__file__).with_name('restore-operational-policy.json')
POLICY_FIELDS = ('table','name','columns','parent','references','match','primaryKey','nullable','population')


def assert_policy(entries, policy):
    observed = {e['name']: {k: e[k] for k in POLICY_FIELDS} for e in entries}
    expected = json.loads(json.dumps({e['name']: e for e in policy['constraints']}))
    # JSON canonicalization handles tuples returned by the DDL parser, without relaxing values.
    if json.loads(json.dumps(observed)) != expected:
        changed = sorted(k for k in set(observed) | set(expected)
                         if json.loads(json.dumps(observed.get(k))) != expected.get(k))
        raise ValueError('Historical population or schema changed: ' + ', '.join(changed))


def debt_names(policy):
    return {e['name'] for e in policy['constraints'] if e['population']['count']}


def filtered_toc(toc, policy):
    names = debt_names(policy)
    matched = set()
    all_names = set()
    lines = []
    for line in toc.splitlines():
        if not line.startswith(';') and ' FK CONSTRAINT ' in line:
            parts = line.split()
            index = parts.index('CONSTRAINT')
            name = parts[index + 3]
            if name in all_names:
                raise ValueError('Duplicate FK in archive')
            all_names.add(name)
            if name in names:
                if name in matched:
                    raise ValueError('Duplicate historical FK in archive')
                matched.add(name)
                line = '; historical FK recreated explicitly NOT VALID: ' + line
        lines.append(line)
    if all_names != {e['name'] for e in policy['constraints']}:
        raise ValueError('Archive FK set differs from pinned policy')
    if matched != names:
        raise ValueError('Historical FK archive entries missing')
    return '\n'.join(lines) + '\n'


def fingerprints(clone):
    tables = clone.json("SELECT json_agg(json_build_array(schemaname,tablename) ORDER BY schemaname,tablename) FROM pg_tables WHERE schemaname='public';")
    out = {}
    for t in tables:
        # Full rows, including bytea/JSON, not just IDs or representative counts.
        out['.'.join(t)] = clone.json(f'''SELECT json_build_object('rows',count(*),'sha256',encode(sha256(convert_to(
          COALESCE(string_agg(h,'' ORDER BY h COLLATE "C"),''),'UTF8')),'hex')) FROM (
          SELECT encode(sha256(convert_to(to_jsonb(t)::text,'UTF8')),'hex') h FROM {table_sql(t)} t) rows;''')
    sequences = clone.json("SELECT COALESCE(json_agg(json_build_array(schemaname,sequencename) ORDER BY schemaname,sequencename),'[]') FROM pg_sequences WHERE schemaname='public';")
    for seq in sequences:
        out['sequence:' + '.'.join(seq)] = clone.json(f"SELECT json_build_object('last_value',last_value,'log_cnt',log_cnt,'is_called',is_called) FROM {table_sql(seq)};")
    return out


def validate_final(clone, fks, policy):
    actual = clone.json("SELECT COALESCE(json_agg(json_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,'validated',k.convalidated,'triggerCount',(SELECT count(*) FROM pg_trigger t WHERE t.tgconstraint=k.oid),'activeTriggerCount',(SELECT count(*) FROM pg_trigger t WHERE t.tgconstraint=k.oid AND t.tgenabled IN ('O','A')))),'[]') FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE k.contype='f' AND n.nspname='public';")
    if {(x['schema'], x['table'], x['name']) for x in actual} != {(f['table'][0], f['table'][1], f['name']) for f in fks}:
        raise ValueError('Restored FK set differs from dump')
    names = debt_names(policy)
    if any(x['validated'] != (x['name'] not in names) for x in actual):
        raise ValueError('Incorrect VALID/NOT VALID split')
    if any(x['triggerCount'] < 4 or x['activeTriggerCount'] != x['triggerCount'] for x in actual):
        raise ValueError('FK triggers missing or inactive')
    disabled = clone.json("SELECT count(*) FROM pg_trigger WHERE tgenabled NOT IN ('O','A');")
    role = clone.sql('SHOW session_replication_role;')
    if disabled or role != 'origin':
        raise ValueError('Inactive integrity protection')
    assert_policy(inventory(clone, fks), policy)
    return {'foreignKeys': actual, 'valid': len(actual)-len(names), 'historicalNotValid': len(names),
            'disabledTriggers': disabled, 'replicationRole': role}


def rejection_witnesses(clone, fks, policy):
    results = []
    for f in fks:
        if f['name'] not in debt_names(policy):
            continue
        child = table_sql(f['table'])
        # Read historical rows; never update them. New IDs only, transactions always rolled back.
        import uuid
        fresh = 'restore-probe-' + uuid.uuid4().hex
        patch = {k: fresh for k in f['primaryKey']}
        if f['table'][1] == 'Company':
            patch.update(fashionjobsUrl=fresh, canonicalKey=fresh, mergedIntoId=None, parentGroupId=None,
                         sectorCodes=[], sectorEvidence=None, sectorReviewId=None)
        if f['table'][1] == 'CompanyAlias':
            patch.update(aliasKey=fresh, normalizedName=fresh)
        # All supplied values remain local and transient. No surrogate parent is created.
        cols = clone.json('SELECT json_agg(attname ORDER BY attnum) FROM pg_attribute WHERE attrelid=' + literal(child) + "::regclass AND attnum>0 AND NOT attisdropped AND attgenerated='';")
        # Copy original typed values directly: JSON null must not become SQL NULL.
        patch_record = f'jsonb_populate_record(NULL::{child}, {literal(json.dumps(patch))}::jsonb)'
        values = ','.join(f'({patch_record}).{qi(c)}' if c in patch else 'c.'+qi(c) for c in cols)
        insert = f'INSERT INTO {child} ({",".join(qi(c) for c in cols)}) SELECT {values} FROM {child} c WHERE {orphan_where(f)} LIMIT 1'
        sql = f'''BEGIN;
CREATE TEMP TABLE witness_result(state text, constraint_name text, message text) ON COMMIT DROP;
DO $witness$ DECLARE s text; n text; m text; BEGIN
 BEGIN {insert}; RAISE EXCEPTION 'WRITE_WAS_ACCEPTED' USING ERRCODE='ZX001';
 EXCEPTION WHEN OTHERS THEN GET STACKED DIAGNOSTICS s=RETURNED_SQLSTATE,n=CONSTRAINT_NAME,m=MESSAGE_TEXT;
 IF s='ZX001' THEN RAISE; END IF;
 INSERT INTO witness_result VALUES(s,n,m); END;
END $witness$;
SELECT row_to_json(w) FROM witness_result w;
ROLLBACK;'''
        rejection = clone.json(sql)
        allowed_guard = {
            'SourceIngestionCompletion': ('23514', 'Ingestion completion requires an admitted, sealed job extraction whose outputs are all accounted for'),
            'SourceObservation': ('P0001', 'A source evidence capture cannot attest a job publication'),
        }.get(f['table'][1])
        direct = rejection['state'] == '23503' and rejection['constraint_name'] == f['name']
        if not direct and (not allowed_guard or (rejection['state'], rejection['message']) != allowed_guard):
            raise ValueError('Unexpected refusal, not an integrity witness: ' + f['name'] + ' ' + json.dumps(rejection))
        # Some BEFORE triggers reject even earlier than RI. Also exercise each exact FK definition
        # with a transient child table referencing the REAL parents: requires 23503 on this FK.
        # This does not disable, replace or alter any trigger on the restored application tables.
        projection = ','.join(qi(c) for c in f['columns'])
        statement = f['ddl']
        fk_body = FK_BODY.fullmatch(ALTER.fullmatch(statement)['body'])
        options = fk_body['options'].replace(' NOT VALID','')
        witness_fk = f'FOREIGN KEY ({projection}) REFERENCES {table_sql(f["parent"])} ({",".join(qi(c) for c in f["references"])}){options} NOT VALID'
        witness_schema = qi('restore_ri_' + uuid.uuid4().hex)
        witness_table = witness_schema + '.ri_probe'
        pure = f'''BEGIN;
CREATE SCHEMA {witness_schema};
CREATE TABLE {witness_table} AS SELECT {projection} FROM {child} WITH NO DATA;
ALTER TABLE {witness_table} ADD CONSTRAINT {qi(f['name'])} {witness_fk};
CREATE TEMP TABLE ri_result(state text, constraint_name text) ON COMMIT DROP;
DO $witness$ DECLARE s text; n text; BEGIN
 BEGIN INSERT INTO {witness_table} SELECT {','.join('c.'+qi(c) for c in f['columns'])} FROM {child} c WHERE {orphan_where(f)} LIMIT 1;
 RAISE EXCEPTION 'RI_ACCEPTED' USING ERRCODE='ZX001';
 EXCEPTION WHEN foreign_key_violation THEN GET STACKED DIAGNOSTICS s=RETURNED_SQLSTATE,n=CONSTRAINT_NAME; INSERT INTO ri_result VALUES(s,n); END;
END $witness$;
SELECT row_to_json(r) FROM ri_result r; ROLLBACK;'''
        ri = clone.json(pure)
        if ri != {'state':'23503','constraint_name':f['name']}:
            raise ValueError('NOT VALID RI witness failed')
        results.append({'constraint':f['name'],'applicationInsertRejected':rejection,'exactDefinitionRiWitness':ri})
    return results



def complete_restore(clone, dump, pg_restore, out, policy, fks, toc_path):
    report = {}
    clone.sql('ANALYZE;')
    entries = inventory(clone,fks)
    write(out/'inventory-before.json',entries)
    assert_policy(entries,policy)
    before = fingerprints(clone)
    write(out/'data-before.json',before)
    normal = out/'normal-post-data.sql'
    subprocess.run([pg_restore,'--section=post-data','--use-list='+str(toc_path),'--file='+str(normal),str(dump)],check=True,capture_output=True)
    # Exact normal post-data, only the eight explicit TOC entries omitted. Every error is fatal.
    with normal.open('rb') as stream, (out/'post-data.log').open('wb') as log:
        run = subprocess.run(clone.command('psql','-X','-v','ON_ERROR_STOP=1','-d',clone.database),stdin=stream,stdout=log,stderr=log)
    if run.returncode: raise ValueError('Normal post-data failed')
    debt_sql = '\n'.join(f['ddl'].removesuffix(';').removesuffix(' NOT VALID')+' NOT VALID;' for f in fks if f['name'] in debt_names(policy))
    (out/'historical-foreign-keys.sql').write_text(debt_sql)
    clone.sql('BEGIN;\n'+debt_sql+'\nCOMMIT;')
    report['constraints'] = validate_final(clone,fks,policy)
    report['newWrites'] = rejection_witnesses(clone,fks,policy)
    after = fingerprints(clone)
    write(out/'data-after.json',after)
    if before != after: raise ValueError('Data or sequence changed during reconstruction/probes')
    report.update(status='PASS',restoreComplete=True,dataIdentical=True,dataLoss=0,inventedData=0,
                  tables=len([k for k in before if not k.startswith('sequence:')]))
    return report


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
    report = {'status':'FAILED','restoreComplete':False,'dataRepair':False}
    try:
        policy = json.loads(POLICY_PATH.read_text())
        if len(policy['constraints']) != 45 or len(debt_names(policy)) != 8:
            raise ValueError('Unexpected versioned policy')
        with args.dump.open('rb') as stream:
            digest = hashlib.file_digest(stream,'sha256').hexdigest()
        if digest != args.dump_sha256:
            raise ValueError('Dump hash mismatch')
        post = args.out_dir/'post-data.sql'
        subprocess.run([args.pg_restore,'--section=post-data','--file='+str(post),str(args.dump)],check=True,capture_output=True)
        fks = parse_schema(post.read_text())
        toc = subprocess.check_output([args.pg_restore,'--list',str(args.dump)],text=True)
        toc_path = args.out_dir/'normal-post-data.list'
        toc_path.write_text(filtered_toc(toc,policy))
        clone = Clone(args.container,args.database)
        clone.create()
        report.update(database=args.database,dumpSha256=digest)
        for section in ['pre-data','data']:
            clone.restore(args.dump,section,args.out_dir/(section+'.log'))
        report.update(complete_restore(clone,args.dump,args.pg_restore,args.out_dir,policy,fks,toc_path))
        return 0
    except Exception as error:
        report['error'] = str(error)
        return 1
    finally:
        write(args.out_dir/'result.json',report)
        print(json.dumps({k:v for k,v in report.items() if k not in ('constraints','newWrites')},sort_keys=True))


if __name__ == '__main__':
    sys.exit(main())
