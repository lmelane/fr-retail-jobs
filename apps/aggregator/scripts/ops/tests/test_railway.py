"""Offline checks: service identity, mutation boundaries and credential handling."""
import importlib.util
import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch, MagicMock

OPS = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(OPS))
import railway_api

spec = importlib.util.spec_from_file_location('railway_service', OPS / 'railway-service.py')
railway = importlib.util.module_from_spec(spec)
spec.loader.exec_module(railway)


class RailwayServiceTests(unittest.TestCase):
    def call(self, query, variables):
        self.assertFalse(query.startswith('mutation'))
        if 'serviceInstances' in query:
            return {'environment': {'serviceInstances': {'edges': [
                {'node': {'serviceName': 'catwalks-api', 'serviceId': 'api-id'}},
                {'node': {'serviceName': 'catwalks-aggregator', 'serviceId': 'other-id'}},
            ]}}}
        self.assertEqual(variables['service'], 'api-id')
        if 'variables(' in query:
            return {'variables': {'DATABASE_URL': 'secret-url', 'PIPELINE_PAUSED': '1'}}
        return {'serviceInstance': {'startCommand': 'api-start', 'latestDeployment': {
            'id': 'deployment-api', 'status': 'FAILED', 'meta': {'commitHash': 'api-commit'},
        }}}

    def test_api_status_and_variables_use_resolved_service(self):
        with patch.object(railway, 'api', side_effect=self.call):
            status = railway.status('api')
            self.assertEqual(status['service'], 'catwalks-api')
            self.assertEqual(status['status'], 'FAILED')
            self.assertEqual(status['commit'], 'api-commit')
            self.assertEqual(railway.variable_names('api'), ['DATABASE_URL', 'PIPELINE_PAUSED'])
            self.assertEqual(railway.variables('api'), {
                'INGEST_ONLY_KEYS': None, 'REFRESH_ONLY_KEYS': None,
                'PIPELINE_PAUSED': '1', 'PIPELINE_CMD': None,
            })

    def test_missing_or_duplicate_api_is_not_replaced_by_another_service(self):
        for edges in [[], [{'node': {'serviceName': 'catwalks-api', 'serviceId': 'a'}}] * 2]:
            with patch.object(railway, 'api', return_value={'environment': {'serviceInstances': {'edges': edges}}}):
                with self.assertRaisesRegex(RuntimeError, 'absent ou ambigu'):
                    railway.status('api')

    def test_retired_service_alias_and_unbounded_mutations_are_refused(self):
        with patch.object(railway, 'api') as api:
            with self.assertRaisesRegex(RuntimeError, 'service inconnu'):
                railway.status('web')
            for service in ['api', 'refresh', 'reconcile', 'unknown']:
                with self.assertRaises(RuntimeError):
                    railway.set_command(service, 'anything')
                with self.assertRaises(RuntimeError):
                    railway.execute(service)
            with patch.dict(os.environ, {'DEPLOY_COMMIT': 'z' * 40}):
                with self.assertRaisesRegex(RuntimeError, 'SHA complet'):
                    railway.set_command('aggregator', 'anything')
            api.assert_not_called()


class RailwayPauseGuardTests(unittest.TestCase):
    commit = 'a' * 40
    command = 'env INGEST_ONLY_KEYS=mecca node bounded-ingest'

    def setUp(self):
        self.calls = []
        self.remote_pause = '0'
        self.environ = patch.dict(os.environ, {
            'DEPLOY_COMMIT': self.commit, 'INGEST_KEYS': 'mecca', 'PIPELINE_PAUSED': '0',
        })
        self.environ.start()
        self.addCleanup(self.environ.stop)
        self.api = patch.object(railway, 'api', side_effect=self.call)
        self.api.start()
        self.addCleanup(self.api.stop)

    def call(self, query, variables):
        self.calls.append(query)
        if 'variables(' in query:
            return {'variables': {'PIPELINE_PAUSED': self.remote_pause}}
        if query.startswith('mutation'):
            return {'ok': True}
        return {'serviceInstance': {'startCommand': self.command, 'latestDeployment': {
            'id': 'bounded-deployment', 'status': 'SUCCESS', 'meta': {
                'commitHash': self.commit, 'serviceManifest': {'deploy': {'startCommand': self.command}},
            },
        }}}

    def test_paused_missing_or_invalid_remote_value_refuses_all_bounded_mutations(self):
        for value in ('1', None, '', 'false', ' 0', 0, False):
            for action in ('set-command', 'execute'):
                with self.subTest(value=value, action=action):
                    self.calls.clear()
                    self.remote_pause = value
                    with self.assertRaisesRegex(RuntimeError, 'PIPELINE_PAUSED distant'):
                        if action == 'set-command':
                            railway.set_command('aggregator', self.command)
                        else:
                            railway.execute('aggregator')
                    self.assertTrue(any('variables(' in query for query in self.calls))
                    self.assertFalse(any(query.startswith('mutation') for query in self.calls))

    def test_remote_zero_allows_bounded_mutations_after_reading_pause(self):
        for action, expected_mutations in [('set-command', 2), ('execute', 1)]:
            with self.subTest(action=action):
                self.calls.clear()
                if action == 'set-command':
                    railway.set_command('aggregator', self.command)
                else:
                    railway.execute('aggregator')
                self.assertIn('variables(', self.calls[0])
                self.assertEqual(sum(query.startswith('mutation') for query in self.calls), expected_mutations)

    def test_restore_normal_command_remains_possible_while_paused(self):
        self.remote_pause = '1'
        railway.set_command('aggregator', railway.SERVICES['aggregator']['normalCommand'])
        self.assertEqual(sum(query.startswith('mutation') for query in self.calls), 2)

    def test_similar_normal_command_does_not_bypass_the_pause(self):
        self.remote_pause = '1'
        for command in [railway.SERVICES['aggregator']['normalCommand'] + ' ', '', 'sh other-script.sh']:
            with self.subTest(command=command):
                with self.assertRaisesRegex(RuntimeError, 'PIPELINE_PAUSED distant'):
                    railway.set_command('aggregator', command)
        self.assertFalse(any(query.startswith('mutation') for query in self.calls))

    def test_status_and_variable_reads_remain_available_while_paused(self):
        self.remote_pause = '1'
        self.assertEqual(railway.status('aggregator')['status'], 'SUCCESS')
        self.assertEqual(railway.variables('aggregator')['PIPELINE_PAUSED'], '1')
        self.assertEqual(railway.variable_names('aggregator'), ['PIPELINE_PAUSED'])
        self.assertFalse(any(query.startswith('mutation') for query in self.calls))

    def test_failed_remote_read_never_falls_back_to_local_environment(self):
        with patch.object(railway, 'api', side_effect=RuntimeError('remote read unavailable')) as api:
            for action in (lambda: railway.set_command('aggregator', self.command),
                           lambda: railway.execute('aggregator')):
                with self.assertRaisesRegex(RuntimeError, 'remote read unavailable'):
                    action()
            self.assertTrue(all(not call.args[0].startswith('mutation') for call in api.call_args_list))


class RailwayTransportTests(unittest.TestCase):
    def test_transport_returns_only_data_and_sends_parameters_without_shell(self):
        response = MagicMock()
        response.__enter__.return_value = io.StringIO(json.dumps({'data': {'ok': True}}))
        opener = MagicMock()
        opener.open.return_value = response
        with patch.dict(os.environ, {'CATWALKS_RAILWAY_TOKEN': 'private-token'}), \
                patch.object(railway_api.urllib.request, 'build_opener', return_value=opener):
            self.assertEqual(railway_api.api('query Test', {'id': '$(not-a-command)'}), {'ok': True})
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_header('Authorization'), 'Bearer private-token')
        self.assertEqual(json.loads(request.data)['variables']['id'], '$(not-a-command)')

    def test_graphql_errors_never_echo_variable_values_or_accept_partial_success(self):
        for payload in [{'errors': [{'message': 'secret-url'}], 'data': {'ok': True}}, None, {'data': None}]:
            response = MagicMock()
            response.__enter__.return_value = io.StringIO(json.dumps(payload))
            opener = MagicMock()
            opener.open.return_value = response
            with patch.object(railway_api, '_token', return_value='private-token'), \
                    patch.object(railway_api.urllib.request, 'build_opener', return_value=opener):
                with self.assertRaises(RuntimeError) as error:
                    railway_api.api('query Test')
                self.assertNotIn('secret-url', str(error.exception))
                self.assertNotIn('private-token', str(error.exception))


if __name__ == '__main__':
    unittest.main()
