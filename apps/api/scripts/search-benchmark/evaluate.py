"""Evaluate a frozen run against versioned native-content judgments.

Usage: python3 -B evaluate.py documents.ndjson measurements.ndjson
Unknown judgments stay unknown. Empty results with known positives score zero.
"""
import hashlib
import itertools
import json
import math
from pathlib import Path
import statistics
import sys

HERE = Path(__file__).parent


def quantile(values, q):
    return sorted(values)[max(0, math.ceil(q * len(values)) - 1)] if values else None


def mean(values):
    values = [x for x in values if x is not None]
    return statistics.mean(values) if values else None


def quality(ids, grades):
    """No invented negatives; grade 1 acceptable, grade 2 strongly relevant."""
    relevant = {id for id, grade in grades.items() if grade > 0}
    top = ids[:20]
    complete = all(id in grades for id in top)
    precision = sum(grades[id] > 0 for id in top) / len(top) if complete and top else (0 if complete and relevant else None)
    strict = sum(grades[id] == 2 for id in top) / len(top) if complete and top else (0 if complete and relevant else None)
    dcg = lambda values: sum((2**g - 1) / math.log2(i + 2) for i, g in enumerate(values))
    ideal = dcg(sorted(grades.values(), reverse=True)[:20])
    ndcg = dcg([grades[id] for id in top]) / ideal if complete and ideal else None
    return {'precisionAtAvailable20': precision, 'strictPrecisionAtAvailable20': strict,
            'ndcgAt20': ndcg, 'pooledRecallAt20': len(set(top) & relevant) / len(relevant) if relevant else None,
            'pooledRecallAt100': len(set(ids[:100]) & relevant) / len(relevant) if relevant else None}


def evaluate(documents_file, measurements_file):
    intentions = {i['id']: i for i in json.loads((HERE / 'intentions.json').read_text())}
    metadata = json.loads(Path(str(documents_file) + '.metadata.json').read_text())
    with documents_file.open('rb') as stream:
        if hashlib.file_digest(stream, 'sha256').hexdigest() != metadata['projectionSha256']:
            raise ValueError('Projection hash mismatch')
    documents = {}
    for line in documents_file.open():
        d = json.loads(line)
        documents[d['id']] = {'country': d['country'], 'occupationCode': d['occupationCode']}
    measurements = [json.loads(line) for line in measurements_file.open()]
    labels = {}
    for filename, key in [('judgments.json', 'judgments'), ('anchors.json', 'anchors')]:
        artifact = json.loads((HERE / filename).read_text())
        if artifact['snapshotSha256'] != metadata['snapshotSha256']:
            raise ValueError(f'{filename}: snapshot mismatch')
        for item in artifact[key]:
            grades = labels.setdefault(item['intentionId'], {})
            for id in item.get('ids', [item.get('id')]):
                if id not in documents or item['grade'] not in (0, 1, 2):
                    raise ValueError(f'{filename}: invalid judgment')
                if id in grades and grades[id] != item['grade']:
                    raise ValueError(f'{filename}: conflicting judgment for {id}')
                grades[id] = item['grade']
    engines = sorted({r['engine'] for r in measurements})
    expected = {(i['id'], q) for i in intentions.values() for q in i['variants']}
    for engine in engines:
        rows = [r for r in measurements if r['engine'] == engine]
        if len(rows) != len(expected) or {(r['intentionId'], r['q']) for r in rows} != expected:
            raise ValueError(f'{engine}: incomplete or duplicated measurements')
    qualities = {(r['engine'], r['intentionId'], r['q']): quality(r['ids'], labels.get(r['intentionId'], {})) for r in measurements}
    paired = {key for key in expected if all(qualities[(e, *key)]['ndcgAt20'] is not None for e in engines)}
    report = {'snapshotSha256': metadata['snapshotSha256'], 'projectionSha256': metadata['projectionSha256'],
              'intentions': len(intentions), 'variants': len(expected), 'measurementRows': len(measurements), 'engines': {},
              'comparisonLimits': [
                  'Single-agent engine-blind native-content labels; no independent human validation.',
                  'Baseline times include facet/count SQL; candidates retrieve IDs+total only.',
                  'One local measured pass, concurrency one: NOT production API p95/SLO.',
                  'Recall uses pooled annotated documents plus nine native-content anchors, not all relevant market offers.',
                  'Market guard checks indexed country, not correctness of source geography.',
                  'Snapshot has no public DirectOffer: real two-origin behaviour is not measured here.',
              ]}
    for engine in engines:
        rows = [r for r in measurements if r['engine'] == engine]
        times = [r['elapsedMs'] for r in rows]
        violations, overlap, empty_equivalences, judged, positions, unclassified = 0, [], 0, 0, 0, []
        known_positive_zero = []
        for r in rows:
            market = intentions[r['intentionId']]['market']
            countries = {'GB': ['GB', 'IE'], 'DE': ['DE', 'AT']}.get(market, [market])
            violations += sum(documents[id]['country'] not in countries for id in r['ids'])
            grades = labels.get(r['intentionId'], {})
            top = r['ids'][:20]
            positions += len(top); judged += sum(id in grades for id in top)
            if r['total'] == 0 and any(grade == 2 for grade in grades.values()):
                known_positive_zero.append({'intentionId': r['intentionId'], 'q': r['q']})
            no_code = {id for id, grade in grades.items() if grade > 0 and not documents[id]['occupationCode']}
            if no_code: unclassified.append(len(set(r['ids'][:100]) & no_code) / len(no_code))
        for key in intentions:
            variants = [r for r in rows if r['intentionId'] == key]
            values = []
            for a, b in itertools.combinations(variants, 2):
                left, right = set(a['ids'][:20]), set(b['ids'][:20])
                if not left and not right:
                    empty_equivalences += 1; continue
                values.append(len(left & right) / len(left | right))
            if values: overlap.append(statistics.mean(values))
        scores = [qualities[(engine, r['intentionId'], r['q'])] for r in rows]
        paired_scores = [qualities[(engine, *key)] for key in sorted(paired)]
        metrics = list(scores[0])
        report['engines'][engine] = {
            'queries': len(rows), 'zeroResultQueries': sum(r['total'] == 0 for r in rows),
            'zeroDespiteKnownPositive': len(known_positive_zero), 'knownPositiveZeroQueries': known_positive_zero,
            'p50Ms': quantile(times, .5), 'p95Ms': quantile(times, .95), 'maxMs': max(times),
            'outsideIndexedMarket': violations, 'macroVariantJaccard20': mean(overlap),
            'bothEmptyVariantPairsExcluded': empty_equivalences,
            'top20JudgmentCoverage': judged / positions if positions else 0,
            'precisionQueries': sum(s['precisionAtAvailable20'] is not None for s in scores),
            **{m: mean([s[m] for s in scores]) for m in metrics},
            'pooledUnclassifiedRecallAt100': mean(unclassified),
            'pairedComparison': {'queries': len(paired), **{m: mean([s[m] for s in paired_scores]) for m in metrics}},
            'bySplit': {},
        }
        for split in sorted({i['split'] for i in intentions.values()}):
            subset = [qualities[(engine, *key)] for key in sorted(paired) if intentions[key[0]]['split'] == split]
            report['engines'][engine]['bySplit'][split] = {'pairedQueries': len(subset), **{m: mean([s[m] for s in subset]) for m in metrics}}
    return report


if __name__ == '__main__':
    print(json.dumps(evaluate(*map(Path, sys.argv[1:3])), ensure_ascii=False, indent=2))
