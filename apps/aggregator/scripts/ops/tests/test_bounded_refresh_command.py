"""The bounded refresh command must consume exactly the manifest version the planner produces.

Measured on 2026-09-16: the command still required version 2 while the planner had produced version 3 since
lot 1, so every reviewed manifest was refused before deployment. This witness reads the TypeScript constant
and fails whenever the two drift apart again.
"""
import importlib.util
import json
import pathlib
import re
import tempfile
import unittest

OPS = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('bounded_refresh_command', OPS / 'bounded-refresh-command.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
PLANNER = OPS.parents[1] / 'src' / 'pipeline' / 'refreshManifest.ts'


def manifest(version: int, keys=('mecca',)):
    return {'version': version, 'mode': 'DEACTIVATE_REPRESENTATIONS', 'allowedSourceKeys': list(keys), 'entries': [],
            'limits': {'staleHours': 48, 'maxCloseRatio': 0.05, 'minCloseForGuard': 50}, 'planHash': 'a' * 64, 'createdAt': '2026-09-16T00:00:00Z'}


class BoundedRefreshCommandTest(unittest.TestCase):
    def write(self, body):
        path = pathlib.Path(tempfile.mkdtemp()) / 'manifest.json'
        path.write_text(json.dumps(body))
        return str(path)

    def test_version_matches_the_planner(self):
        declared = re.search(r'export const REFRESH_MANIFEST_VERSION = (\d+);', PLANNER.read_text())
        self.assertIsNotNone(declared, 'planner constant not found')
        self.assertEqual(int(declared.group(1)), MODULE.REFRESH_MANIFEST_VERSION)

    def test_accepts_the_current_version_and_carries_the_plan_hash(self):
        command = MODULE.bounded_refresh_command('run', 'mecca', self.write(manifest(MODULE.REFRESH_MANIFEST_VERSION)))
        self.assertIn('REFRESH_ONLY_KEYS=mecca', command)
        self.assertIn('a' * 64, command)
        self.assertIn('loadRefreshManifest', command)

    def test_refuses_a_stale_or_future_version(self):
        for version in (2, 3, MODULE.REFRESH_MANIFEST_VERSION + 1):
            with self.assertRaises(ValueError):
                MODULE.bounded_refresh_command('run', 'mecca', self.write(manifest(version)))

    def test_refuses_a_scope_that_differs_from_the_manifest(self):
        with self.assertRaises(ValueError):
            MODULE.bounded_refresh_command('run', 'mecca,autre', self.write(manifest(MODULE.REFRESH_MANIFEST_VERSION)))

    def test_refuses_an_empty_scope_even_when_the_manifest_is_empty(self):
        with self.assertRaises(ValueError):
            MODULE.bounded_refresh_command('run', '', self.write(manifest(MODULE.REFRESH_MANIFEST_VERSION, keys=())))


if __name__ == '__main__':
    unittest.main()
