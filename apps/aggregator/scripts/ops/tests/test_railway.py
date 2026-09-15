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
