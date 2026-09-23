"""Offline checks for the historical Railway log reader transport and credential handling."""
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
