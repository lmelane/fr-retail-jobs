"""Exécute une commande contre le CLONE de répétition.

Le code est versionné ; les IDENTIFIANTS ne le sont pas — ils vivent avec les preuves, hors dépôt. Le dossier
de preuves est donc une ENTRÉE (`CERTIFICATION_EVIDENCE_DIR`), jamais le dossier du script : coder le chemin
en dur ramènerait le secret à côté du code, ce que le rangement des lots précédents interdit.
"""
import json, os, pathlib, subprocess, sys

evidence = pathlib.Path(os.environ.get('CERTIFICATION_EVIDENCE_DIR', 'backups/lot4-20260909'))
access = evidence / 'local-access-d.json'
if not access.exists():
    sys.exit(f"accès clone introuvable : {access} — poser CERTIFICATION_EVIDENCE_DIR sur le dossier de preuves")
url = json.load(open(access))['DATABASE_URL']
env = os.environ.copy()
env.update(DATABASE_URL=url, DIRECT_URL=url)
sys.exit(subprocess.run(sys.argv[1:], env=env).returncode)
