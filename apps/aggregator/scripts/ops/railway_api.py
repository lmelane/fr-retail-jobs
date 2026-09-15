"""Railway GraphQL transport shared by the maintained operations tools.

Credentials: CATWALKS_RAILWAY_TOKEN, or the existing Railway CLI login.
No executable or credential is loaded from an audit/backup directory.
"""
import json
import os
from pathlib import Path
import urllib.error
import urllib.request


def _token():
    token = os.environ.get('CATWALKS_RAILWAY_TOKEN')
    if not token:
        try:
            token = json.loads((Path.home() / '.railway/config.json').read_text())['user']['token']
        except (OSError, ValueError, KeyError, TypeError):
            raise RuntimeError('Railway credentials unavailable: use railway login or CATWALKS_RAILWAY_TOKEN') from None
    if not isinstance(token, str) or not token.strip() or any(c in token for c in '\r\n'):
        raise RuntimeError('Railway credential is empty or invalid')
    return token


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Do not forward a bearer credential to a redirect target.
        return None


def api(query, variables=None):
    request = urllib.request.Request(
        'https://backboard.railway.app/graphql/v2',
        data=json.dumps({'query': query, 'variables': variables or {}}).encode(),
        headers={'Authorization': 'Bearer ' + _token(), 'Content-Type': 'application/json',
                 'User-Agent': 'Catwalks-operations/1.0'},
    )
    try:
        with urllib.request.build_opener(_NoRedirect).open(request, timeout=25) as response:
            payload = json.load(response)
    except urllib.error.HTTPError as error:
        raise RuntimeError(f'Railway HTTP {error.code}') from None
    except (OSError, ValueError):
        raise RuntimeError('Railway response unavailable or invalid') from None
    # Do not echo server errors: they can include variable values or secrets.
    if not isinstance(payload, dict) or payload.get('errors') or not isinstance(payload.get('data'), dict):
        raise RuntimeError('Railway GraphQL request failed or returned no data')
    return payload['data']
