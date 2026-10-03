"""D-522 §6 — registre explicite consolidé du 03/10/2026, construit HORS RÉSEAU.

Base : le fichier relu du 02/10 (appliqué avec r6). Les statuts courants viennent de la lecture seule
`statuts-non-actifs-20261003.txt` (key;status). Les entrées révisées viennent des fichiers relus des groupes
(identité, portails, génériques) et de Ralph Lauren (ci-dessous). Toute source non ACTIVE doit figurer.

Rejeu : python3 construire-registre-0310.py  (écrit registre-explicite-2026-10-03.json)
"""
import json
import pathlib

HERE = pathlib.Path(__file__).parent
BASE = HERE.parents[1] / '2026-10-02' / 'registre-explicite' / 'registre-explicite-2026-10-02.json'

statuses = dict(line.strip().split(';') for line in (HERE / 'statuts-non-actifs-20261003.txt').read_text().splitlines() if line.strip())
base = json.loads(BASE.read_text())
entries = {e['key']: e for e in base['entries']}


def load(path):
    d = json.loads((HERE / path).read_text())
    if isinstance(d, list):
        return d
    if 'entries' in d:
        return d['entries']
    return [d]


revised = []
for path in ['registre-explicite-identite.json', 'registre-explicite-portails.json',
             *(f'{k}/registre-explicite-entree.json' for k in ['ghost', 'sioux', 'nimble', 'rotate', 'minimalist'])]:
    revised += load(path)

revised.append({
    'key': 'ralph-lauren-avature', 'maison': 'Ralph Lauren', 'currentStatus': 'PAUSED', 'intention': 'COLLECTER',
    'targetStatus': 'PAUSED', 'trajectory': 'A_REPARER', 'basis': 'DECISION',
    'decision': 'D-483 (pause jusqu\'au lot anti-robot) ; D-516 §1 (réamorcer une fois, puis enquêter) ; D-522 §6',
    'reason': ('Le 406 venait de la seconde lecture du RUN (origine Avature, en aval du défi AWS ; enquête '
               'audits/2026-10-02/d516-ralph-lauren/). La lecture unique de r6 fait adopter la capture de qualification, '
               'amorçage WAF compris, par l\'ingestion du même tour (témoin du 03/10, '
               'audits/2026-10-03/stock-exceptions/ralph-lauren-avature/). portalScope SINGLE_BRAND posé (D-481 §2).'),
    'nextAction': ('Après le RUN d\'acceptation de r6 : source-add --key=ralph-lauren-avature '
                   '--registered-revision=de332ddf-b45d-42fa-a89e-9ab1106e0d62 --official-domain=ralphlauren.com '
                   '--reviewer=loic-melane-d522 ; juger la collecte par les critères de D-483 '
                   '(audits/2026-09-30/d483-amorcage-waf/criteres-acceptation.md) et source.capture_adopted.'),
    'reviewAt': '2026-10-06', 'question': None,
})

for e in revised:
    entries[e['key']] = e

missing = sorted(set(statuses) - set(entries))
if missing:
    raise SystemExit(f'non ACTIVE sans entrée : {missing}')
out = []
for key in sorted(statuses):
    e = dict(entries[key])
    current = statuses[key]
    if e['currentStatus'] != current:
        # Une entrée du 02/10 dont la cible est appliquée (miu-miu PAUSED -> RETIRED) : l'état courant fait foi.
        if e['targetStatus'] != current:
            raise SystemExit(f'{key}: relu {e["currentStatus"]} -> {e["targetStatus"]}, base {current}')
        e['currentStatus'] = current
    out.append(e)

plan = {'kind': 'registre-explicite/1',
        'reviewer': 'D-522 §6 — stock d\'exceptions, lecture D-492, 03/10/2026 (arbitrages du CTO, D-519, D-523)',
        'observedAt': '2026-10-03T07:30:00Z', 'entries': out}
(HERE / 'registre-explicite-2026-10-03.json').write_text(json.dumps(plan, ensure_ascii=False, indent=1) + '\n')
print(f'{len(out)} entrées, {len(revised)} révisées')
