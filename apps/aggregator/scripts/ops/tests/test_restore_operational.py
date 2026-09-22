"""Operational restore never repairs rows or broadens the pinned historical allowance."""
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import unittest
import uuid

OPS=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('restore',OPS/'restore-operational.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
DDL='''ALTER TABLE ONLY public."CompanyAlias"
    ADD CONSTRAINT "CompanyAlias_pkey" PRIMARY KEY (id);
ALTER TABLE ONLY public."CompanyAlias"
    ADD CONSTRAINT "CompanyAlias_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES public."EmployerIdentityReview"(id) ON UPDATE CASCADE ON DELETE RESTRICT;
'''

class PolicyTests(unittest.TestCase):
    def test_policy_is_exactly_45_constraints_eight_debts(self):
        p=json.loads(m.POLICY_PATH.read_text())
        self.assertEqual(len(p['constraints']),45)
        self.assertEqual(len(m.debt_names(p)),8)
        self.assertEqual(sum(e['population']['count'] for e in p['constraints']),754)

    def test_population_drift_same_count_different_hash_is_refused(self):
        p=json.loads(m.POLICY_PATH.read_text());rows=json.loads(json.dumps(p['constraints']))
        m.assert_policy(rows,p)
        rows[0]['population']['sha256']='changed'
        with self.assertRaises(ValueError):m.assert_policy(rows,p)

    def test_new_corruption_or_changed_schema_refused(self):
        p=json.loads(m.POLICY_PATH.read_text())
        for key,value in [('population',{'count':1,'sha256':'x'}),('columns',['different'])]:
            rows=json.loads(json.dumps(p['constraints']));rows[0][key]=value
            with self.assertRaises(ValueError):m.assert_policy(rows,p)

    def test_toc_excludes_only_named_eight(self):
        p=json.loads(m.POLICY_PATH.read_text())
        lines=['; Archive header']+[f'{i}; 2606 100 FK CONSTRAINT public {e["table"][1]} {e["name"]} postgres' for i,e in enumerate(p['constraints'],1)]
        result=m.filtered_toc('\n'.join(lines),p)
        self.assertEqual(sum('FK CONSTRAINT' in l and not l.startswith(';') for l in result.splitlines()),37)
        with self.assertRaises(ValueError):m.filtered_toc('\n'.join(lines[2:]),p)

    def test_unknown_ddl_is_not_silently_omitted(self):
        with self.assertRaises(ValueError):m.parse_schema(DDL.replace('ON DELETE RESTRICT','MATCH PARTIAL'))

    def test_no_integrity_disabling_operational_entrypoint(self):
        # Scan operational launchers AND runtime, including new tracked files and untracked work.
        root=OPS.parents[3]
        banned=re.compile(r'(?:\b(?:set\s+(?:local\s+|session\s+)?|set_config\s*\(\s*[\'\"]?)session_replication_role\b[\s\S]{0,60}\breplica\b|\bdisable\s+trigger\s+(?:all|user|[\'\"`]))',re.I)
        findings=[]
        for base in [root/'apps/aggregator/scripts',root/'apps/aggregator/src',root/'apps/api',root/'packages/db']:
            for f in base.rglob('*'):
                if f.suffix not in {'.ts','.mts','.mjs','.js','.py','.sh','.sql'} or any(x in {'node_modules','__pycache__','tests','prisma','.next','.next-e2e-api'} or x.startswith('.next-') for x in f.parts):continue
                if '.test.' in f.name:continue
                # Comments are not executable SQL. Keep string content intact.
                text=re.sub(r'/\*[\s\S]*?\*/','',f.read_text())
                text=re.sub(r'^\s*(?://|#).*$', '',text,flags=re.M)
                if banned.search(text):findings.append(str(f.relative_to(root)))
        self.assertEqual(findings,[])
        self.assertFalse((OPS/'nettoyer-collecte.mts').exists())

    def test_remote_or_existing_business_database_not_a_target(self):
        with self.assertRaises(ValueError):m.Clone('catwalks-consolide-rehearsal','railway')

@unittest.skipUnless(os.environ.get('INTEGRITY_TEST_CONTAINER'),'Explicit local PostgreSQL witness required')
class DatabaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.db=m.Clone(os.environ['INTEGRITY_TEST_CONTAINER'],'restore_operational_test_'+uuid.uuid4().hex[:10]);cls.db.create()
        cls.addClassCleanup(lambda:subprocess.run(cls.db.command('dropdb',cls.db.database),check=True,capture_output=True))

    def setUp(self):
        self.db.sql('DROP SCHEMA public CASCADE; CREATE SCHEMA public; CREATE TABLE "EmployerIdentityReview"(id text PRIMARY KEY); CREATE TABLE "CompanyAlias"(id text PRIMARY KEY,"reviewId" text, "aliasKey" text, "normalizedName" text); INSERT INTO "CompanyAlias" VALUES (\'a\',\'missing\',\'alias\',\'name\');')
        self.db.sql("CREATE SEQUENCE witness_seq; SELECT setval('witness_seq',42,true);")
        self.db.sql("ALTER TABLE \"CompanyAlias\" ADD COLUMN payload jsonb NOT NULL DEFAULT 'null'::jsonb;")
        self.fks=m.parse_schema(DDL);self.entries=m.inventory(self.db,self.fks)
        self.policy={'constraints':[{k:e[k] for k in m.POLICY_FIELDS} for e in self.entries]}

    def test_historical_rows_preserved_not_valid_rejects_new_orphan(self):
        before=m.fingerprints(self.db)
        self.db.sql(self.fks[0]['ddl'][:-1]+' NOT VALID;')
        result=m.validate_final(self.db,self.fks,self.policy)
        self.assertEqual(result['historicalNotValid'],1)
        w=m.rejection_witnesses(self.db,self.fks,self.policy)
        self.assertEqual(w[0]['applicationInsertRejected']['state'],'23503')
        self.assertEqual(before,m.fingerprints(self.db))

    def test_valid_restore_still_rejects_orphans(self):
        with self.assertRaises(RuntimeError):self.db.sql(self.fks[0]['ddl'])

    def test_hash_changes_even_with_same_count(self):
        self.db.sql("UPDATE \"CompanyAlias\" SET id='other';")
        with self.assertRaises(ValueError):m.assert_policy(m.inventory(self.db,self.fks),self.policy)

    def test_composite_match_semantics(self):
        self.db.sql('CREATE TABLE p(a int,b int,PRIMARY KEY(a,b));CREATE TABLE c(id int,a int,b int);INSERT INTO c VALUES (1,1,NULL),(2,1,2),(3,NULL,NULL);')
        f={'table':('public','c'),'parent':('public','p'),'columns':('a','b'),'references':('a','b'),'primaryKey':('id',),'match':'SIMPLE'}
        self.assertEqual(self.db.json(m.population_sql(f))['count'],1)
        f['match']='FULL';self.assertEqual(self.db.json(m.population_sql(f))['count'],2)

if __name__=='__main__':unittest.main()
