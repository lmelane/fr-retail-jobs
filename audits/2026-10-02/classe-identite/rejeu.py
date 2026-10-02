"""D-520, classe identité d'employeur : les règles du lot rejouées sur les 8 RUN du 24/09 au 01/10. Lecture seule.

    python3 audits/2026-10-02/classe-identite/rejeu.py > audits/2026-10-02/classe-identite/rejeu.out

Entrées (mesurées en lecture seule le 02/10, voir les .sql) : `preuves.csv.gz` (chaque offre refusée, sa dernière
observation attribuée AVANT le RUN, ses témoins D-506, son employeur actuel), `sources.out` (registre), `sourcerun.csv.gz`
(offres publiées par RUN).

Règles rejouées, dans l'ordre du résolveur (`apps/aggregator/src/identity/resolve.ts`) :
  R1 libellé omis      : refus « portail » (l'offre ne nomme pas d'employeur) et dernière observation de l'offre
                         venue d'un libellé NATIF, par une règle native, vers l'employeur qu'elle porte (`ordinaryIdentity.ts`) :
                         l'offre est gardée telle quelle (ni réécrite ni reconfirmée), sans entrée de file ;
  D506 suivi éditeur   : nouvelle graphie, ancien libellé natif, et d'autres offres de la source publiées sous le nouveau
                         libellé avant le RUN (règle D-506 §3, déjà construite, livrée par r4 le 02/10) ;
  R2 même Maison       : nouvelle graphie, ancien libellé NATIF (un employeur venu du registre reste en revue, lecture de
                         D-506 §3), portail relu SINGLE_BRAND, ancien ET nouveau libellé désignant la Maison au registre
                         (R-143 §5). Les gardes d'accord des sources et de ligne Maison ne sont pas rejouées : sur la fenêtre,
                         aucune occurrence n'atteint ce point (la seule nouvelle graphie de Maison, b-s-international,
                         avait un employeur venu du registre) ;
  FILE                 : tout le reste, retenu et mis en file de revue (une entrée par source, motif, libellé, employeur).

Approximations dites : l'employeur « actuel » est celui d'aujourd'hui (une offre déplacée depuis le RUN n'est pas vue) ;
les témoins D-506 comptent les observations attribuées sous ce libellé avant le RUN, sans relire la collecte. Pour tapestry
(26/09), l'audit de D-506 a établi que ses témoins avaient été renommés pendant la collecte : elle ne suit pas (`TEMOINS_RENOMMES`).
"""
import collections
import csv
import gzip
import io
import re
import unicodedata
from datetime import datetime, timedelta
from pathlib import Path

HERE = Path(__file__).parent
NATIVE_RULES = {'REVIEWED_ALIAS', 'REVIEWED_MERGE', 'NATIVE_SOURCE_LABEL', 'NATIVE_EMPLOYER_BRAND_RELATION', 'PUBLISHER_FOLLOWED', 'SAME_REGISTRY_MAISON'}
PORTAL_MOTIFS = {'PORTAL_OWNER_NOT_CERTIFIED', 'PORTAL_OWNER_REPLACES_EMPLOYER'}
TEMOINS_RENOMMES = {('tapestry', 'Sales-Associate-III_JR5246')}
JOB_BOARD = {'SPECIALIST_JOBBOARD', 'AGGREGATOR'}


def native_origin(origin):
    return bool(origin) and origin != 'SOURCE_CATALOGUE_LABEL' and origin != 'LEGACY_UNSPECIFIED' and not origin.startswith('portal.certifiedScope')


def tokens(name):
    norm = re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', name)).strip().lower()
    return [t for t in re.sub(r'[^\w]+|_', ' ', norm).split(' ') if t]


def designates(label, maison):
    t, p = tokens(label), tokens(maison)
    return bool(p) and len(t) >= len(p) and t[:len(p)] == p


def registry():
    rows, section = {}, None
    for line in (HERE / 'sources.out').read_text().splitlines():
        if line.startswith('key|maison'):
            section = 'src'; continue
        if line.startswith('sourceKey|'):
            section = None; continue
        if section == 'src' and '|' in line:
            key, maison, kind, scope, status, tier, domain, _ = line.split('|')
            rows[key] = {'maison': maison, 'scope': scope, 'tier': tier, 'status': status}
    return rows


def published():
    out = {}
    for r in csv.DictReader(io.TextIOWrapper(gzip.open(HERE / 'sourcerun.csv.gz'), encoding='utf-8')):
        out[(r['jour'], r['src'])] = int(r['jobs'])
    return out


def classify(r, reg):
    motif, src = r['motif'], r['src']
    if motif in PORTAL_MOTIFS:
        if native_origin(r['prev_origin']) and r['prev_rule'] in NATIVE_RULES and r['prev_company'] and r['prev_company'] == r['job_company']:
            return 'R1', 'S1 libellé omis, offre déjà nommée par l’éditeur : gardée telle quelle'
        if reg[src]['tier'] in JOB_BOARD:
            return 'FILE', 'S5 job board, offres sans employeur'
        if not r['prev_origin']:
            return 'FILE', 'S4 portail jamais relu, offres sans employeur nommé'
        return 'FILE', 'S4b libellé omis, sans déclaration native qui le prouve'
    if motif == 'EMPLOYER_SPELLING_DIVERGED':
        if native_origin(r['prev_origin']) and int(r['temoins_avant'] or 0) > 0:
            if (src, r['ext']) in TEMOINS_RENOMMES:
                return 'FILE', 'S7 changement d’employeur, témoins renommés pendant la collecte'
            return 'D506', 'S3 changement d’employeur chez l’éditeur, employeur déjà publié par la source'
        maison = reg[src]['maison'].split('(')[0].strip()
        group = reg[src]['scope'] == 'MULTI_BRAND' or '(' in reg[src]['maison']
        same = not group and designates(r['prev_label'], maison) and designates(r['raw'], maison)
        if not native_origin(r['prev_origin']):
            return 'FILE', ('S2 nouvelle graphie de la Maison, employeur précédent venu du registre' if same
                            else 'S6 entité juridique qui ne porte pas le nom de la Maison, employeur précédent venu du registre')
        if same and reg[src]['scope'] == 'SINGLE_BRAND':
            return 'R2', 'S2b nouvelle graphie native de la Maison d’un portail relu'
        return 'FILE', 'S6b nouvelle graphie native, autre employeur'
    return 'FILE', 'S8 autre motif'


def main():
    reg, pub = registry(), published()
    rows = list(csv.DictReader(io.TextIOWrapper(gzip.open(HERE / 'preuves.csv.gz'), encoding='utf-8')))
    runs = sorted({r['jour'] for r in rows} | {k[0] for k in pub})
    occ = collections.defaultdict(list)          # (run, src) -> [(verdict, sous-cause, row)]
    for r in rows:
        verdict, cause = classify(r, reg)
        occ[(r['jour'], r['src'])].append((verdict, cause, r))

    print(f'Fenêtre : {len(runs)} RUN ingest-all ({runs[0][:10]} → {runs[-1][:10]}), {len(rows)} refus d’offres, {len(occ)} occurrences (source × RUN)\n')
    # 1. Sous-causes
    sub = collections.defaultdict(lambda: {'occ': set(), 'src': set(), 'offres': set(), 'refus': 0, 'verdict': None})
    for (run, src), items in occ.items():
        for verdict, cause, r in items:
            s = sub[cause]; s['occ'].add((run, src)); s['src'].add(src); s['offres'].add((src, r['ext'])); s['refus'] += 1; s['verdict'] = verdict
    print('sous-cause | traitement | occurrences (source × RUN) | sources | offres distinctes | refus (offre × RUN)')
    for cause in sorted(sub):
        s = sub[cause]
        print(f"{cause} | {s['verdict']} | {len(s['occ'])} | {len(s['src'])} | {len(s['offres'])} | {s['refus']}  ({', '.join(sorted(s['src']))})")

    # 2. Occurrences absorbées : toutes leurs offres résolues sans revue.
    absorbed = {k for k, items in occ.items() if all(v != 'FILE' for v, _, _ in items)}
    by_proof = collections.Counter('+'.join(sorted({v for v, _, _ in occ[k]})) for k in absorbed)
    print(f"\nOccurrences absorbées sans intervention : {len(absorbed)} sur {len(occ)} ({', '.join(f'{p} {n}' for p, n in sorted(by_proof.items()))})")
    print(f"Refus d’offres absorbés : {sum(1 for items in occ.values() for v, _, _ in items if v != 'FILE')} sur {len(rows)}")

    # 3. La file, RUN par RUN : entrées ouvertes, nouvelles, escaladées (échéance 48 h si la source ne publie rien, 7 jours sinon).
    entries = {}                                  # clé -> {'first': datetime, 'deadline': datetime, 'escalated': bool}
    print('\nRUN | sources bloquées avant | occurrences absorbées | entrées en file (ouvertes) | nouvelles | escaladées | interventions après')
    tot_before = tot_after = 0
    questions = {}
    for run in runs:
        now = datetime.strptime(run, '%Y-%m-%d %H:%M')
        here = {k: v for k, v in occ.items() if k[0] == run}
        keys = {}
        for (_, src), items in here.items():
            for verdict, cause, r in items:
                if verdict != 'FILE':
                    continue
                proposed = '' if r['motif'] in PORTAL_MOTIFS else r['proposed'].lower()
                key = (src, r['motif'], r['raw'].lower(), proposed)
                keys.setdefault(key, set()).add(r['ext'])
                questions.setdefault(key, cause)
        collected = {k[1] for k in pub if k[0] == run}
        for key in [k for k in entries if k not in keys and k[0] in collected]:
            del entries[key]                       # collecte complète sans ce refus : résolue
        new = escalated = 0
        for key, ids in keys.items():
            jobs = pub.get((run, key[0]), 0)
            if key not in entries:
                entries[key] = {'first': now, 'deadline': now + (timedelta(days=7) if jobs > 0 else timedelta(hours=48)), 'escalated': False}
                new += 1
            e = entries[key]
            if jobs == 0:
                e['deadline'] = min(e['deadline'], e['first'] + timedelta(hours=48))
            if not e['escalated'] and now >= e['deadline']:
                e['escalated'] = True; escalated += 1
        before = len(here)
        tot_before += before; tot_after += new + escalated
        print(f"{run} | {before} | {len([k for k in here if k in absorbed])} | {len(keys)} | {new} | {escalated} | {new + escalated}")
    print(f"TOTAL | {tot_before} | {len(absorbed)} | | | | {tot_after}")

    print('\nEntrées de la file sur la fenêtre (source · motif · libellé · employeur en jeu · sous-cause) :')
    for key in sorted(questions):
        print(f"  {key[0]} · {key[1]} · « {key[2]} » · {key[3] or '-'} · {questions[key]}")


if __name__ == '__main__':
    main()
