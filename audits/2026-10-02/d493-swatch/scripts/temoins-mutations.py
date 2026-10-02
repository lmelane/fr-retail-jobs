#!/usr/bin/env python3
"""
Chaque garde du lecteur Swatch Group (D-493) retirée tour à tour : le témoin qui la protège doit passer au ROUGE.

Rejouable depuis la racine du dépôt, sur un arbre propre (l'adaptateur doit être identique à HEAD) :
    python3 audits/2026-10-02/d493-swatch/scripts/temoins-mutations.py

Pour chaque mutation : remplacement exact (refusé s'il ne s'applique pas une et une seule fois), vitest sur le fichier
de témoins, puis restauration de l'adaptateur depuis HEAD (`git show HEAD:…`) et contrôle que le fichier est revenu à
l'identique. Sortie : `../temoins-mutations.txt`.
"""
import json, os, subprocess, sys, hashlib

ROOT = subprocess.check_output(['git', 'rev-parse', '--show-toplevel'], text=True).strip()
ADAPTER = 'apps/aggregator/src/ats/adapters/swatchgroup.ts'
TESTS = 'src/ats/adapters/swatchgroup.enumeration.test.ts'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'temoins-mutations.txt')

MUTATIONS = [
    ('G1 lecture des partitions supprimée',
     'for (const value of partitionValues) partitions.push(await sweep(value));',
     'for (const value of [] as string[]) partitions.push(await sweep(value));'),
    ('G2 somme des partitions = total, non vérifiée',
     "if (partitionValues.length > 0 && publisherTotal !== undefined && partitionSum !== publisherTotal) proofIssues.push('PARTITION_TOTALS_DIFFER');",
     ''),
    ('G3 offre dans deux partitions, non vérifiée',
     "if (overlaps.size) proofIssues.push('PARTITION_OVERLAP');",
     ''),
    ('G4 même dernière page annoncée sur chaque page, non vérifiée',
     "if (announced !== undefined && announced !== lastIndex) sameAnnouncement = false;",
     ''),
    ('G5 union = total, non vérifiée',
     "if (publisherTotal !== undefined && seen.size !== publisherTotal) proofIssues.push(seen.size > publisherTotal ? 'UNION_ABOVE_PUBLISHER_TOTAL' : 'PUBLISHER_TOTAL_NOT_REACHED');",
     ''),
    ('G6 filtre de partition absent, non signalé',
     "if (partitionValues.length === 0) proofIssues.push('PARTITION_FILTER_ABSENT');",
     ''),
    ('G7 page au-delà de la dernière, non vérifiée',
     "if (beyond.count !== 0) result.shapeIssues.push('PAGE_BEYOND_LAST_NOT_EMPTY');",
     ''),
    ('G8 requêtes de listing dépendantes du résultat (partitions arrêtées dès le total atteint)',
     'for (const value of partitionValues) partitions.push(await sweep(value));',
     'for (const value of partitionValues) { if (full.total !== undefined && seen.size >= full.total) break; partitions.push(await sweep(value)); }'),
]

def sha(path):
    return hashlib.sha256(open(path, 'rb').read()).hexdigest()

def main():
    adapter = os.path.join(ROOT, ADAPTER)
    head = subprocess.check_output(['git', 'show', f'HEAD:{ADAPTER}'], cwd=ROOT)
    if open(adapter, 'rb').read() != head:
        sys.exit("refus : l'adaptateur diffère de HEAD")
    original = head.decode('utf8')
    lines = [f'Témoins du lecteur Swatch Group (D-493), commit {subprocess.check_output(["git", "rev-parse", "--short", "HEAD"], cwd=ROOT, text=True).strip()}',
             '']
    baseline = run_tests()
    lines.append(f'Sans mutation : {baseline["passed"]} réussis, {baseline["failed"]} échoués')
    for name, old, new in MUTATIONS:
        if original.count(old) != 1:
            sys.exit(f'refus : la mutation « {name} » ne s’applique pas exactement une fois')
        open(adapter, 'w').write(original.replace(old, new))
        try:
            result = run_tests()
        finally:
            open(adapter, 'wb').write(head)
        assert open(adapter, 'rb').read() == head, 'restauration incomplète'
        lines.append('')
        lines.append(f'{name} : {result["failed"]} échoués / {result["passed"]} réussis')
        for t in result['failedNames']:
            lines.append(f'  ROUGE  {t}')
    open(OUT, 'w').write('\n'.join(lines) + '\n')
    print('\n'.join(lines))

def run_tests():
    report = os.path.join(ROOT, 'audits/2026-10-02/d493-swatch/.vitest-report.json')
    subprocess.run(['npx', 'vitest', 'run', TESTS, '--reporter=json', f'--outputFile={report}'], cwd=os.path.join(ROOT, 'apps/aggregator'),
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    data = json.load(open(report))
    os.remove(report)
    failed = [t['title'] for f in data['testResults'] for t in f['assertionResults'] if t['status'] != 'passed']
    return {'passed': data['numPassedTests'], 'failed': data['numFailedTests'] + data.get('numPendingTests', 0) * 0, 'failedNames': failed}

main()
