"""Load derived documents into an isolated PostgreSQL benchmark.

Usage: index.py documents.ndjson pg-access.json psql_binary
Local-only, create-only: refuses to replace existing benchmark tables.
"""
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import time

documents, access_file, psql = map(Path, sys.argv[1:])
metadata = json.loads(Path(str(documents) + '.metadata.json').read_text())
with documents.open('rb') as stream:
    assert hashlib.file_digest(stream, 'sha256').hexdigest() == metadata['projectionSha256'], 'Projection hash mismatch'
access = json.loads(access_file.read_text())
if access['PGHOST'] not in ['localhost', '127.0.0.1', '::1'] or not access['PGDATABASE'].startswith('catwalks_search_benchmark_'):
    raise SystemExit('Refusing anything except an explicitly local benchmark database')
env = {**os.environ, **{k: str(v) for k, v in access.items()}, 'PGOPTIONS': '-c statement_timeout=600000'}

def sql(text, source=None):
    result = subprocess.run([str(psql), '-X', '-v', 'ON_ERROR_STOP=1', '-Atc', text],
                            stdin=source, capture_output=True, env=env)
    if result.returncode:
        raise RuntimeError(result.stderr.decode())
    return result.stdout.decode().strip()

start = time.monotonic()
sql('CREATE TABLE benchmark_document_input(doc jsonb NOT NULL)')
with documents.open('rb') as source:
    sql("COPY benchmark_document_input FROM STDIN WITH (FORMAT csv, DELIMITER E'\\x01', QUOTE E'\\x02')", source)
sql('''CREATE TABLE benchmark_document AS SELECT doc->>'id' AS id, (doc->>'origin')::int AS origin,
 doc->>'country' AS country, doc->>'city' AS city, doc->>'title' AS title, doc->>'company' AS company,
 doc->>'body' AS body, doc->>'duties' AS duties,
 ARRAY(SELECT jsonb_array_elements_text(doc->'roles')) AS roles,
 ARRAY(SELECT jsonb_array_elements_text(doc->'families')) AS families,
 ARRAY(SELECT jsonb_array_elements_text(doc->'sectors')) AS sectors,
 ARRAY(SELECT jsonb_array_elements_text(doc->'companyKeys')) AS "companyKeys",
 (doc->>'postedAt')::float8 AS "postedAt", (doc->>'firstSeenAt')::float8 AS "firstSeenAt",
 setweight(to_tsvector('simple', doc->>'title'),'A') || setweight(to_tsvector('simple', doc->>'company'),'B')
 || setweight(to_tsvector('simple',coalesce(doc->>'duties','')),'C')
 || setweight(to_tsvector('simple',doc->>'body'),'D')
 || to_tsvector('simple',CASE WHEN jsonb_array_length(coalesce(doc->'titleRoles','[]'::jsonb))>0 THEN 'cwhastitlerole' ELSE '' END)
 || to_tsvector('simple', coalesce((SELECT string_agg('cwi' || md5(kind || ':' || value), ' ')
     FROM (SELECT 'role' AS kind, jsonb_array_elements_text(doc->'roles') AS value
       UNION ALL SELECT 'family', jsonb_array_elements_text(doc->'families')
       UNION ALL SELECT 'sector', jsonb_array_elements_text(doc->'sectors')
       UNION ALL SELECT 'company', jsonb_array_elements_text(doc->'companyKeys')) identities), '')) AS vector
    FROM benchmark_document_input;
 ALTER TABLE benchmark_document ADD PRIMARY KEY(id);
 CREATE INDEX benchmark_vector ON benchmark_document USING gin(vector);
 CREATE INDEX ON benchmark_document(country);
 CREATE INDEX ON benchmark_document USING gin(roles);
 CREATE INDEX ON benchmark_document USING gin(families);
 CREATE INDEX ON benchmark_document USING gin(sectors);
 CREATE INDEX ON benchmark_document USING gin("companyKeys");
 ANALYZE benchmark_document;''')
receipt = {'count': int(sql('SELECT count(*) FROM benchmark_document')),
    'postgresIndexSeconds': time.monotonic() - start,
    'postgresBytes': int(sql("SELECT pg_total_relation_size('benchmark_document')"))}
sql('DROP TABLE benchmark_document_input')
with Path(str(documents) + '.postgres-index.json').open('x') as output:
    json.dump(receipt, output, indent=2)
print(json.dumps(receipt))
