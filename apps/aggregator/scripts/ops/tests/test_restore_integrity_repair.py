"""Failure boundaries of the single-clone integrity repair, plus opt-in real PostgreSQL tests."""
import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile
import hashlib
import json
import sys
import unittest
import uuid

spec = importlib.util.spec_from_file_location('integrity', Path(__file__).resolve().parents[1] / 'restore-integrity-repair.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

DDL = '''ALTER TABLE ONLY public."CompanyAlias"
    ADD CONSTRAINT "CompanyAlias_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."CompanyAlias"
    ADD CONSTRAINT "CompanyAlias_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES public."EmployerIdentityReview"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
'''


class ParseTests(unittest.TestCase):
    def test_semantics_must_be_explicit_and_nullable(self):
        f = m.parse_schema(DDL)[0]
        self.assertEqual(m.classify(f, [True])[0], 'SET_NULL')
        self.assertEqual(m.classify(f, [False])[0], 'STOP_NON_NULLABLE')
        f['table'] = ('public', 'Unknown')
        self.assertEqual(m.classify(f, [True])[0], 'STOP_UNKNOWN_SEMANTICS')
        f['table'], f['columns'] = ('public', 'Company'), ('identityReviewId',)
        self.assertEqual(m.classify(f, [True])[0], 'STOP_UNSAFE_SEMANTICS')

    def test_unknown_ddl_never_disappears_from_inventory(self):
        for ddl in [DDL.replace('ON DELETE RESTRICT', 'MATCH PARTIAL'), DDL.replace('public."CompanyAlias"', '"CompanyAlias"'), DDL.replace('    ADD CONSTRAINT', '    ADD\n    CONSTRAINT')]:
            with self.subTest(ddl=ddl), self.assertRaises(ValueError):
                m.parse_schema(ddl)

    def test_composite_match_and_quoted_identifiers(self):
        f = m.parse_schema(DDL.replace('("reviewId") REFERENCES', '("reviewId", "b, c") REFERENCES').replace('(id) ON UPDATE', '(id, "a""b") MATCH FULL ON UPDATE'))[0]
        self.assertEqual(f['columns'], ('reviewId', 'b, c'))
        self.assertEqual(f['references'], ('id', 'a"b'))
        self.assertEqual(f['match'], 'FULL')
        self.assertIn(' OR ', m.orphan_where(f))

    def test_one_blocker_refuses_all_updates(self):
        f = {**m.parse_schema(DDL)[0], 'action': 'STOP_UNKNOWN_SEMANTICS', 'population': {'count': 1, 'sha256': 'x'}}
        with self.assertRaisesRegex(ValueError, 'no partial repair'):
            m.repair_sql([f])

    def test_refuses_existing_or_remote_database_names_before_docker(self):
        for database in ['railway', 'postgres', 'catwalks_consolide_rehearsal']:
            with self.assertRaises(ValueError):
                m.Clone('catwalks-consolide-rehearsal', database)


@unittest.skipUnless(os.environ.get('INTEGRITY_TEST_CONTAINER'), 'Set INTEGRITY_TEST_CONTAINER for isolated PostgreSQL witnesses')
class DatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.clone = m.Clone(os.environ['INTEGRITY_TEST_CONTAINER'], 'restore_integrity_test_' + uuid.uuid4().hex[:10])
        cls.clone.create()
        cls.addClassCleanup(lambda: subprocess.run(cls.clone.command('dropdb', cls.clone.database), check=True, capture_output=True))

    def setUp(self):
        self.clone.sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE TABLE public."EmployerIdentityReview" (id text PRIMARY KEY); CREATE TABLE public."CompanyAlias" (id text PRIMARY KEY, "reviewId" text); INSERT INTO "CompanyAlias" VALUES (\'a\',\'missing\'),(\'b\',NULL);')
        self.fks = m.parse_schema(DDL)

    def test_null_repair_preserves_objects_and_enforces_constraints(self):
        entries = m.inventory(self.clone, self.fks)
        self.assertEqual(entries[0]['population']['count'], 1)
        self.clone.sql(m.repair_sql(entries))
        self.assertEqual(self.clone.json('SELECT count(*) FROM "CompanyAlias";'), 2)
        self.assertEqual(self.clone.json('SELECT count(*) FROM "EmployerIdentityReview";'), 0)
        self.clone.sql('ALTER TABLE ONLY' + DDL.rsplit('ALTER TABLE ONLY', 1)[1])
        self.assertEqual(m.validate_final(self.clone, self.fks)['orphans'], 0)
        with self.assertRaises(RuntimeError):
            self.clone.sql('INSERT INTO "CompanyAlias" VALUES (\'bad\',\'missing\');')

    def test_same_count_different_ids_aborts_before_update(self):
        entries = m.inventory(self.clone, self.fks)
        self.clone.sql("UPDATE \"CompanyAlias\" SET id='changed' WHERE id='a';")
        with self.assertRaisesRegex(RuntimeError, 'Population changed'):
            self.clone.sql(m.repair_sql(entries))
        self.assertEqual(self.clone.json('SELECT count(*) FROM "CompanyAlias" WHERE "reviewId" IS NOT NULL;'), 1)

    def test_count_drift_and_new_orphan_in_previously_empty_population_abort(self):
        self.clone.sql('UPDATE "CompanyAlias" SET "reviewId"=NULL;')
        entries = m.inventory(self.clone, self.fks)
        self.clone.sql("UPDATE \"CompanyAlias\" SET \"reviewId\"='missing' WHERE id='b';")
        with self.assertRaisesRegex(RuntimeError, 'Population changed'):
            self.clone.sql(m.repair_sql(entries))
        self.assertEqual(self.clone.json('SELECT count(*) FROM "CompanyAlias" WHERE "reviewId" IS NOT NULL;'), 1)

    def test_company_null_fails_existing_relationship_check(self):
        self.clone.sql('CREATE TABLE "Company" (id text PRIMARY KEY, "identityReviewId" text, "mergedIntoId" text, "parentGroupId" text, CHECK (("mergedIntoId" IS NULL AND "parentGroupId" IS NULL) OR "identityReviewId" IS NOT NULL)); INSERT INTO "Company" VALUES (\'old\',\'missing\',\'root\',NULL);')
        with self.assertRaisesRegex(RuntimeError, 'check constraint'):
            self.clone.sql('UPDATE "Company" SET "identityReviewId"=NULL;')
        self.assertEqual(self.clone.json('SELECT count(*) FROM "Company" WHERE "identityReviewId" IS NOT NULL;'), 1)

    def test_complete_restore_zero_exit_on_clean_dump(self):
        self.clone.sql('UPDATE "CompanyAlias" SET "reviewId"=NULL;')
        self.clone.sql('ALTER TABLE ONLY' + DDL.rsplit('ALTER TABLE ONLY', 1)[1])
        with tempfile.TemporaryDirectory(prefix='catwalks-integrity-test-') as tmp:
            root = Path(tmp)
            dump = root / 'clean.dump'
            with dump.open('wb') as stream:
                subprocess.run(self.clone.command('pg_dump', '-Fc', '--no-owner', '--no-privileges', self.clone.database), stdout=stream, check=True)
            target = 'restore_integrity_test_' + uuid.uuid4().hex[:10]
            self.addCleanup(lambda: subprocess.run(self.clone.command('dropdb', '--if-exists', target), check=True, capture_output=True))
            run = subprocess.run([sys.executable, str(Path(m.__file__)), '--dump', str(dump), '--dump-sha256', hashlib.sha256(dump.read_bytes()).hexdigest(), '--container', self.clone.container, '--database', target, '--out-dir', str(root / 'out')], capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stdout + run.stderr)
            report = json.loads((root / 'out/result.json').read_text())
            self.assertTrue(report['restoreComplete'])
            self.assertEqual(report['validation']['foreignKeys'], 1)
            self.assertEqual(report['validation']['disabledTriggers'], 0)

    def test_composite_null_semantics(self):
        self.clone.sql('CREATE TABLE parent (a int,b int, PRIMARY KEY(a,b)); CREATE TABLE child (id int PRIMARY KEY,a int,b int); INSERT INTO child VALUES (1,1,NULL),(2,1,2),(3,NULL,NULL);')
        f = {'table': ('public','child'), 'parent': ('public','parent'), 'columns': ('a','b'), 'references': ('a','b'), 'primaryKey': ('id',), 'match': 'SIMPLE'}
        self.assertEqual(self.clone.json(m.population_sql(f))['count'], 1)
        f['match'] = 'FULL'
        self.assertEqual(self.clone.json(m.population_sql(f))['count'], 2)


if __name__ == '__main__':
    unittest.main()
