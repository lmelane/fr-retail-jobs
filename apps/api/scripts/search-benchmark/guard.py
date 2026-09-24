"""Assess existing measurements; no network, database write or runtime engine.

Usage: guard.py observations.json [policy.json]
The thread follow-up collects existing Railway evidence and starts the benchmark
when required. Missing evidence is unknown, never a fabricated zero or PASS.
"""
import json
import math
from pathlib import Path
import sys


def assess(observed, policy):
    reasons, unknown = [], []

    def number(key):
        value = observed.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
            unknown.append(key)
            return None
        return value

    def over(key, limit):
        value = number(key)
        if value is not None and value > limit:
            reasons.append(key)

    samples = number('searchSamples')
    if samples is not None and samples >= policy['minimumSearchSamples']:
        over('p95Ms', policy['p95MaxMs'])
    else:
        unknown.append('p95Ms')
    over('documents', policy['measuredDocuments'])
    over('oldestPendingSeconds', policy['oldestPendingMaxSeconds'])
    over('deadlocksDelta', 0)
    over('ingestionSlowdownRatio', policy['ingestionSlowdownMaxRatio'])
    over('rebuildSeconds', policy['rebuildMaxSeconds'])
    over('failedRelevanceRegressions', 0)
    # Fractions are measured CPU usage / actual CPU limit, not core counts.
    cpu = observed.get('cpuFractions')
    n = policy['cpuConsecutiveSamples']
    if not isinstance(cpu, list) or len(cpu) < n or any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in cpu):
        unknown.append('cpuFractions')
    elif any(all(v > policy['cpuMaxFraction'] for v in cpu[i:i+n]) for i in range(len(cpu)-n+1)):
        reasons.append('cpuFractions')
    precision = number('precisionAtAvailable20')
    if precision is not None and precision < policy['precisionMin']:
        reasons.append('precisionAtAvailable20')
    ndcg = number('ndcgAt20')
    if ndcg is not None and ndcg < policy['ndcgMin']:
        reasons.append('ndcgAt20')
    return {'benchmarkRequired': bool(reasons), 'reasons': reasons,
            'unknown': sorted(set(unknown)), 'policyVersion': policy['version']}


if __name__ == '__main__':
    policy_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path(__file__).with_name('guard-policy.json')
    print(json.dumps(assess(json.loads(Path(sys.argv[1]).read_text()), json.loads(policy_path.read_text()))))
