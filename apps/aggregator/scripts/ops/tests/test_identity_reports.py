"""Real report commands must never revive a historical, unbound certification."""
import csv
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

COVERAGE = Path(__file__).resolve().parents[2] / 'coverage'


class IdentityReportTests(unittest.TestCase):
    def run_reports(self, *, bound=True, ordered=True, strict=True, certified=True, revision='revision-current'):
        source = {'key': 'test-source', 'maison': 'Test', 'kind': 'greenhouse', 'tenantKey': 'greenhouse:test',
                  'status': 'ACTIVE', 'currentRevisionId': 'revision-current', 'identityHash': 'same-hash', 'subjectKey': 'test'}
        if strict:
            source['identityVerdict'] = {'certified': certified, 'reason': None if certified else 'CONTRADICTED'}
        review = {'id': 'test-review', 'sourceKey': source['key'], 'sourceHash': 'same-hash', 'subjectKey': 'test',
                  'verdict': 'VERIFIED', 'method': 'OFFICIAL_LINK', 'checkedAt': '2026-09-16T00:00:00Z'}
        if bound:
            review['sourceRevisionId'] = revision
        if ordered:
            review['sequence'] = '9007199254740993'
        snapshot = {'at': '2026-09-16T12:00:00Z', 'sources': [source], 'latestIdentityReviews': [review],
                    'latestRuns': [], 'counts': [], 'sourceCompanies': [], 'companies': [], 'sourcePostings': [], 'totals': [{}]}
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / 'snapshot.json').write_text(json.dumps(snapshot))
            (root / 'inventory.json').write_text('[]')
            subprocess.run([sys.executable, str(COVERAGE / 'qualify-tracker.py'), str(root / 'inventory.json'),
                            str(root / 'snapshot.json'), str(root / 'qualification')], check=True, capture_output=True, text=True)
            subprocess.run([sys.executable, str(COVERAGE / 'proof-dimensions.py'), str(root / 'snapshot.json'),
                            str(root / 'dimensions')], check=True, capture_output=True, text=True)
            qualification = json.loads((root / 'qualification/sources-qualification.json').read_text())[0]['certification']['verdict']
            with (root / 'dimensions/sources-proof-dimensions.csv').open() as stream:
                dimension = next(csv.DictReader(stream))['identity']
            return qualification, dimension

    def test_current_strict_decision_is_reported(self):
        self.assertEqual(self.run_reports(), ('CERTIFIED_CURRENT', 'CERTIFIED_CURRENT'))

    def test_unknown_historical_revision_never_certifies(self):
        for verdict in self.run_reports(bound=False):
            self.assertFalse(verdict.startswith('CERTIFIED_CURRENT'))

    def test_unknown_historical_order_never_certifies(self):
        for verdict in self.run_reports(ordered=False):
            self.assertFalse(verdict.startswith('CERTIFIED_CURRENT'))

    def test_return_to_same_hash_with_new_revision_never_certifies(self):
        for verdict in self.run_reports(revision='old-revision'):
            self.assertFalse(verdict.startswith('CERTIFIED_CURRENT'))

    def test_hash_only_fallback_is_removed(self):
        for verdict in self.run_reports(strict=False):
            self.assertFalse(verdict.startswith('CERTIFIED_CURRENT'))

    def test_strict_rejection_cannot_be_turned_into_success(self):
        for verdict in self.run_reports(certified=False):
            self.assertFalse(verdict.startswith('CERTIFIED_CURRENT'))
