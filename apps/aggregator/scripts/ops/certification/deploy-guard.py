"""Compatibility shim: the deploy guard now lives in the repository at apps/aggregator/scripts/ops/deploy-guard.py.

An operational control must not depend exclusively on backups/, and two copies of a guard would eventually diverge —
so this file holds NO logic of its own; it forwards to the single implementation with the same arguments and exit code.
Twenty-one frozen chains call `$R/deploy-guard.py`; their procedure manifests stay valid because this path still works.

The moved version also removes the hard-coded run-id exemption this file used to carry: an exemption is now passed
explicitly with `--allow-running <id>`, so a run reappearing under a known id can no longer be waved through in silence.
"""
import subprocess
import sys

sys.exit(subprocess.run(['python3', 'apps/aggregator/scripts/ops/deploy-guard.py', *sys.argv[1:]]).returncode)
