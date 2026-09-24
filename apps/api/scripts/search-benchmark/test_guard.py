import json
from pathlib import Path
import unittest
from guard import assess

POLICY = json.loads(Path(__file__).with_name('guard-policy.json').read_text())


class GuardTest(unittest.TestCase):
    def test_missing_or_invalid_measurements_are_unknown(self):
        for data in [{}, {'searchSamples': 200, 'p95Ms': float('nan'), 'documents': True, 'cpuFractions': [None]}]:
            result = assess(data, POLICY)
            self.assertFalse(result['benchmarkRequired'])
            self.assertIn('p95Ms', result['unknown'])
            self.assertIn('documents', result['unknown'])

    def test_low_traffic_is_not_a_latency_verdict(self):
        self.assertFalse(assess({'searchSamples': 4, 'p95Ms': 3000}, POLICY)['benchmarkRequired'])

    def test_sustained_cpu_requires_consecutive_samples(self):
        self.assertFalse(assess({'cpuFractions': [.9, .1, .9, .9]}, POLICY)['benchmarkRequired'])
        self.assertIn('cpuFractions', assess({'cpuFractions': [.1, .9, .9, .9]}, POLICY)['reasons'])

    def test_each_condition_can_reopen_the_decision(self):
        witnesses = [
            ('p95Ms', {'searchSamples': 200, 'p95Ms': 1001}),
            ('documents', {'documents': POLICY['measuredDocuments']+1}),
            ('oldestPendingSeconds', {'oldestPendingSeconds': 121}),
            ('deadlocksDelta', {'deadlocksDelta': 1}),
            ('ingestionSlowdownRatio', {'ingestionSlowdownRatio': 1.6}),
            ('rebuildSeconds', {'rebuildSeconds': 500}),
            ('failedRelevanceRegressions', {'failedRelevanceRegressions': 1}),
            ('precisionAtAvailable20', {'precisionAtAvailable20': .85}),
            ('ndcgAt20', {'ndcgAt20': .80}),
        ]
        for reason, data in witnesses:
            with self.subTest(reason=reason):
                self.assertIn(reason, assess(data, POLICY)['reasons'])


if __name__ == '__main__':
    unittest.main()
