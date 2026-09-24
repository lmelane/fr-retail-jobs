"""Index the SAME derived documents in local PostgreSQL and Elasticsearch.

Usage: index.py documents.ndjson pg-access.json psql_binary
Local-only, create-only: refuses to replace existing benchmark tables/indexes.
"""
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request

elastic_only = '--elastic-only' in sys.argv
arguments = [a for a in sys.argv[1:] if a != '--elastic-only']
documents, access_file, psql = map(Path, arguments)
profile = json.loads(Path(__file__).with_name('elastic-profile.json').read_text())
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

def elastic(path, body=None, method='GET', ndjson=False):
    data = body.encode() if ndjson else json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request('http://127.0.0.1:59200' + path, data=data, method=method,
        headers={'Content-Type': 'application/x-ndjson' if ndjson else 'application/json'})
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.load(response)

start = time.monotonic()
if not elastic_only:
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
pg_seconds = time.monotonic() - start
if elastic_only: pg_seconds = None
index = profile['index']
start = time.monotonic()
elastic('/' + index, {
    'settings': {'number_of_shards': 1, 'number_of_replicas': 0, 'refresh_interval': '-1',
                 'analysis': {'analyzer': {'catwalks': {'type': 'custom', 'tokenizer': 'standard', 'filter': ['lowercase', 'asciifolding']}}}},
    'mappings': {'_meta': {'ready': False, 'projectionSha256': metadata['projectionSha256']}, 'dynamic': 'strict', 'properties': {
        **{f'linguistic_{lang}_{field}': {'type': 'text', 'analyzer': analyzer}
           for lang, analyzer in profile['languages'].items() for field in ['title', 'duties', 'body']},
        **{k: {'type': 'keyword'} for k in ['id','country','city','titleRoles','roles','families','sectors','companyKeys','occupationCode','employmentTerm','workTime','programType','language']},
        **{k: {'type': 'text', 'analyzer': 'catwalks'} for k in ['title','company','body','duties']},
        'origin': {'type': 'integer'}, 'postedAt': {'type': 'double'}, 'firstSeenAt': {'type': 'double'},
    }},
}, method='PUT')
count, batch = 0, []

def flush():
    result = elastic('/_bulk', '\n'.join(batch) + '\n', method='POST', ndjson=True)
    if result['errors']:
        raise RuntimeError([r for r in result['items'] if r['index']['status'] >= 300][:3])

with documents.open() as source:
    for line in source:
        document = json.loads(line)
        lang = document.get('language')
        if lang in profile['languages']:
            document.update({f'linguistic_{lang}_{field}': document[field] for field in ['title', 'duties', 'body']})
        batch.extend([json.dumps({'index': {'_index': index, '_id': document['id']}}), json.dumps(document, ensure_ascii=False)])
        count += 1
        if len(batch) >= 500:
            flush(); batch.clear()
    if batch:
        flush()
elastic('/' + index + '/_settings', {'index': {'refresh_interval': '1s'}}, method='PUT')
elastic('/' + index + '/_refresh', method='POST')
assert elastic('/' + index + '/_count')['count'] == count == int(sql('SELECT count(*) FROM benchmark_document'))
elastic('/' + index + '/_mapping', {'_meta': {'ready': True, 'projectionSha256': metadata['projectionSha256']}}, method='PUT')
receipt = {'count': count, 'postgresIndexSeconds': pg_seconds, 'elasticIndexSeconds': time.monotonic() - start,
    'postgresBytes': int(sql("SELECT pg_total_relation_size('benchmark_document')")),
    'elastic': elastic('/' + index + '/_stats/store')['indices'][index]['total']['store']}
if not elastic_only: sql('DROP TABLE benchmark_document_input')
with Path(str(documents) + '.linguistic-index.json').open('x') as output:
    json.dump(receipt, output, indent=2)
print(json.dumps(receipt))
