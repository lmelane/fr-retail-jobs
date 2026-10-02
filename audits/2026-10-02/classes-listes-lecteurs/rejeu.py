"""D-520 — rejeu des 8 RUN (24/09 → 01/10) pour les trois classes « liste non prouvée », « régression de volume » et
« qualification rejetée » : ce qui a bloqué, ce que les règles de development AVANT ce lot en font, ce que ce lot en fait,
et ce qui reste, nommé. Lecture seule : les CSV viennent de catalogue.sql (dossier remediation-auto), detail.sql et
sourceruns.sql (ce dossier), exportés le 02/10 à 14:55 UTC.
Rejouable : python3 rejeu.py > rejeu.out

Unité : une occurrence = une source × un RUN dans la classe du catalogue (la même règle `classe` que catalogue.sql).
« Bloquante » = elle fait échouer le RUN selon les règles appliquées (D-453 §1, D-480 §1, D-484 §2, D-491, ce lot).
Les règles se rejouent sur les FAITS enregistrés (SourceRun : lu, annoncé, tronqué, complet, note) ; un correctif de
LECTEUR ne se rejoue pas sur des faits (il change les faits) : il est porté à part, avec sa preuve (collectes
postérieures) et son commit.
"""
import csv, collections, pathlib, re

HERE = pathlib.Path(__file__).parent
cat = [r for r in csv.DictReader(open(HERE / 'catalogue.csv')) if r['classe'][:2] in ('D1', 'D2', 'B1')]
det = {(r['run'], r['src']): r for r in csv.DictReader(open(HERE / 'detail.csv'))}
hist = collections.defaultdict(list)
for r in csv.DictReader(open(HERE / 'sourceruns.csv')): hist[r['sourceKey']].append(r)

CLASS = {'D1': 'liste non prouvée', 'D2': 'régression de volume', 'B1': 'qualification rejetée'}
D480 = {'lumentee': {'ENUMERATION_NOT_PROVEN'}, 'attaquer': {'ENUMERATION_NOT_PROVEN'}, 'kastner-ohler': {'ENUMERATION_NOT_PROVEN'},
        'picard': {'ENUMERATION_NOT_PROVEN'}, 'tapestry': {'ENUMERATION_REFUTED', 'ENUMERATION_NOT_PROVEN'},
        'knitwell-us-retail': {'ENUMERATION_REFUTED', 'ENUMERATION_NOT_PROVEN'}, 'on-running': {'DESCRIPTION_COVERAGE_BELOW_FLOOR'}}
# Familles dont le lecteur nomme une limite structurelle (STRUCTURAL_LIMIT_MARKERS) : liens d'une page d'accueil
# (startUrl sans liste ni plan) et flux RSS (feedUrl). Lu sur la configuration (configs.csv), pas sur le nom de la source.
cfg = {r['key']: r['config'] for r in csv.DictReader(open(HERE / 'configs.csv'))}
def structural(src):
    c = cfg.get(src, '')
    return ('feedUrl' in c) or ('startUrl' in c and 'listingUrl' not in c and 'apiUrl' not in c and 'reader' not in c)
# Lecteurs corrigés sur development depuis l'occurrence : commit et preuve (collectes postérieures, sourceruns.csv).
READER_FIX = {
    'hugo-boss-phenom': ('898ffb5 (30/09) ordre Phenom', 'prouvée depuis le 30/09 04:42'),
    'skechers-phenom': ('898ffb5 (30/09) ordre Phenom', 'prouvée depuis le 30/09 05:06'),
    'mango': ('D-482 (30/09) lignes sans chemin comptées par rang', 'prouvée depuis le 30/09 08:44'),
    'nordstrom': ('D-482 (30/09) seconde passe quand le total change', 'prouvée depuis le 30/09 08:34'),
    'pandora-talenthub': ('898ffb5 (30/09) relecture différée des fiches', 'prouvée depuis le 30/09 05:31'),
    'gemmyo': ('4b410ee (01/10 19:08 UTC) carte join.com jamais servie', 'prouvée le 02/10 05:03'),
    'crocs': ('7918aa4 (01/10 18:56 UTC) seconde passe SuccessFactors', 'prouvée le 02/10 04:31'),
    'sephora-france': ('7918aa4 (01/10 18:56 UTC) seconde passe SuccessFactors ; D-481/D-482 (30/09) pour la qualification', 'prouvée le 02/10 04:44'),
    'ulta-jibe': ('463f375 (01/10 18:59 UTC) seconde passe Jibe', 'complète le 02/10 05:02'),
    'ganni-talentrecruiter': ('55018b6 (01/10 18:50 UTC) motifs dans l’ordre des offres (rejeu déterministe)', 'validée le 02/10 05:19'),
    'estee-lauder-companies': ('D-481 §3 (30/09) description vide native, relecture après la fenêtre du pare-feu', 'validée depuis le 30/09 05:56'),
    'kering': ('D-482 (30/09) cadence partagée Eightfold et relecture', 'validée depuis le 30/09 06:23'),
    'pvh': ('D-481 §4 (30/09) bascule Phenom CareerConnect', 'validée depuis le 30/09 07:26'),
    'zegna-altamira': ('D-482 (30/09) lecteur Altamira', 'validée depuis le 30/09 06:34'),
    'groupe-chantelle': ('898ffb5 (30/09) relecture différée Talentsoft', 'validée depuis le 30/09 06:36'),
}

# Une retenue à instruire s'écrit « N à instruire (MOTIF=n) » ; « non prouvée … à instruire » est l'étiquette de la liste.
TO_INSTRUCT = re.compile(r'\d+ à instruire \(')

def prev_declared(src, ran_at):
    rows = [h for h in hist[src] if h['ranAt'] < ran_at and int(h['jobs'] or 0) > 0]
    return int(rows[-1]['declaredTotal']) if rows and rows[-1]['declaredTotal'] else None

def judge(r):
    """(raison non bloquante avant ce lot | None, raison non bloquante après | None, classe de sourceState après, motif)."""
    d = det.get((r['run'], r['src']), {})
    note, src, k = d.get('note', '') or '', r['src'], r['classe'][:2]
    code = r['code']
    if k == 'B1':
        return None, None, 'QUALIFICATION_REFUSEE', (r['msg'] or '')[:70]
    if 'troncature' in note:
        return None, None, 'LISTE_NON_PROUVEE', 'troncature (lu < annoncé) → ENUMERATION_TRUNCATED'
    if 'énumération non prouvée' in note or 'énumération réfutée' in note:
        cur = 'ENUMERATION_NOT_PROVEN' if ('non prouvée' in note or structural(src)) else 'ENUMERATION_REFUTED'
        before = 'D-480 §1' if cur in D480.get(src, set()) else None
        if src == 'marc-o-polo': before = 'D-485 (pause, lecteur dédié)'
        # Ce lot : une retenue à instruire à côté d'un défaut de liste est nommée et bloque, même sous D-480 ou une limite.
        if TO_INSTRUCT.search(note):
            return before, None, 'CONTENU_INCOMPLET', 'retenue à instruire à côté de la liste → RETENTION_TO_INSTRUCT'
        # Le 24/09, ces sources étaient dites « réfutées » sans fait observé (correction d'étiquette de D-453, 25/09) : le code
        # de development les lit NON PROUVÉES. Ce lot nomme la raison (ENUMERATION_UNPROVABLE) sans changer le blocage :
        # bloquante, sauf échec connu de D-480 §1 (D-482). Approximation assumée : la famille est lue sur la configuration
        # (startUrl seul, feedUrl), pas sur la sortie scellée du lecteur, et le plafond de 150 liens n'est pas rejoué.
        if structural(src) and cur == 'ENUMERATION_NOT_PROVEN':
            return before, before, 'LISTE_INDEMONTRABLE', 'page d’accueil ou flux : le lecteur ne lit ni total ni fin de liste'
        if src == 'knitwell-us-retail':
            # Ce lot : la facette couvrante lit tout (3 515) ; la preuve n'est pas adoptée, la source reste sous D-480 §1.
            return before, before, 'LISTE_NON_PROUVEE', 'plafond Workday 2 000 (lue en entier par la facette couvrante, preuve non adoptée)'
        return before, before, 'LISTE_NON_PROUVEE', re.sub(r'.*\(([^)]*)\).*', r'\1', note.split('·')[0])[:60]
    if 'descriptions manquantes' in note:
        b = 'D-480 §1' if src in D480 and 'DESCRIPTION_COVERAGE_BELOW_FLOOR' in D480[src] else None
        return b, b, 'CONTENU_INCOMPLET', 'descriptions manquantes'
    if 'non publiables archivées' in note:
        # Code du 24/09 : une retenue sans motif natif était bloquante ; D-453 §1 (appliqué le 25/09) la rend non bloquante
        # quand son motif est natif. Aucune de ces 21 sources ne revient dans la classe après le 24/09.
        return 'D-453 §1 (retenue sur preuve de la source, depuis le 25/09)', 'D-453 §1', None, 'retenues du 24/09, code d’avant D-453 §1'
    if 'garde technique' in note:
        return None, None, 'ANOMALIE_VOLUME', 'saut de retenues (garde de la preuve négative)'
    if TO_INSTRUCT.search(note):
        return None, None, 'CONTENU_INCOMPLET', 'retenue à instruire → RETENTION_TO_INSTRUCT'
    m = re.search(r"(\d+) % d’offres en moins", note)
    if m:
        jobs, prev = int(d['jobs']), int(d['previousJobs'] or 0)
        decl, pdecl = int(d['declaredTotal']) if d.get('declaredTotal') else None, prev_declared(src, d.get('_ran', '9999'))
        confirmed = decl and pdecl and d['complete'] == 't' and int(d['fetched']) == decl and abs((jobs / decl) / (prev / pdecl) - 1) <= 0.05
        if confirmed: return 'D-484 §2 (chute confirmée par l’éditeur)', 'D-484 §2', None, f'chute {prev}→{jobs}, annoncé {pdecl}→{decl}'
        if prev - jobs < 10: return 'D-491 (moins de 10 offres disparues)', 'D-491', None, f'chute {prev}→{jobs}'
        return None, None, 'ANOMALIE_VOLUME', f'chute non confirmée {prev}→{jobs}'
    return None, None, 'NON_CLASSEE', note[:60]

for r in cat:
    d = det.get((r['run'], r['src']))
    if d is not None:
        # ranAt of this run's SourceRun, for the previous declared total.
        rows = [h for h in hist[r['src']] if h['runId'] == r['run']]
        d['_ran'] = rows[-1]['ranAt'] if rows else '9999'

def d_ran(r):
    return (det.get((r['run'], r['src'])) or {}).get('_ran', r['startedAt'])

def came_back(src, ran_at):
    """Les deux dernières collectes de la source, après celle-ci, sont saines et prouvées : revenue seule (cause non établie)."""
    later = [h for h in hist[src] if h['ranAt'] > ran_at]
    tail = later[-2:]
    if len(tail) < 2: return None
    if all(h['status'] in ('OK', 'DEGRADED') and h['complete'] == 't' and h['truncated'] != 't' and not TO_INSTRUCT.search(h['note'] or '') for h in tail):
        return f"saine et prouvée aux 2 dernières collectes ({tail[-1]['ranAt'][:16]})"
    return None

runs = sorted({(r['jour'], r['run']) for r in cat})
out = collections.defaultdict(lambda: collections.Counter())
remaining = collections.defaultdict(list)
after_class = collections.defaultdict(collections.Counter)
seen = set()
for r in cat:
    key = (r['classe'][:2], r['src'], r['run'])
    if key in seen: continue
    seen.add(key)
    k = r['classe'][:2]
    recorded_blocking = r['connu'] != 't'
    before, after, cls, why = judge(r)
    # Rejugées sur les faits, indépendamment de ce qui a été relevé : une règle peut rendre bloquant ce qui ne l'était pas.
    b_before = before is None
    b_after = after is None
    # Un correctif de lecteur de LISTE ne lève pas une retenue à instruire : elle n'est attribuée à aucun.
    fixed = None if 'RETENTION_TO_INSTRUCT' in why else READER_FIX.get(r['src'])
    c = out[(k, r['jour'])]
    c['occurrences'] += 1
    c['bloquantes relevées'] += recorded_blocking
    c['bloquantes, règles d’avant ce lot'] += b_before
    c['bloquantes, règles de ce lot'] += b_after
    c['dont lecteur corrigé depuis'] += b_after and fixed is not None
    after_class[k][cls or 'non bloquante par règle'] += 1
    back = came_back(r['src'], d_ran(r))
    c['dont revenue seule'] += b_after and fixed is None and back is not None
    if b_after and fixed is None and back is None: remaining[k].append((r['jour'], r['src'], cls, why))
    if b_after and fixed is None and back is not None: remaining[k + '-back'].append((r['jour'], r['src'], cls, back))
    if b_after and fixed is not None: remaining[k + '-fixed'].append((r['jour'], r['src'], fixed[0], fixed[1]))

cols = ['occurrences', 'bloquantes relevées', 'bloquantes, règles d’avant ce lot', 'bloquantes, règles de ce lot', 'dont lecteur corrigé depuis', 'dont revenue seule']
for k in ('D1', 'D2', 'B1'):
    print(f'\n## {CLASS[k]} ({k})')
    print('RUN | ' + ' | '.join(cols) + ' | reste à ce jour')
    tot = collections.Counter()
    for jour, _ in runs:
        c = out[(k, jour)]
        tot.update(c)
        print(f"{jour} | " + ' | '.join(str(c[x]) for x in cols) + f" | {c['bloquantes, règles de ce lot'] - c['dont lecteur corrigé depuis'] - c['dont revenue seule']}")
    print('total | ' + ' | '.join(str(tot[x]) for x in cols) + f" | {tot['bloquantes, règles de ce lot'] - tot['dont lecteur corrigé depuis'] - tot['dont revenue seule']}")
    print('classe de sourceState après ce lot (toutes occurrences) : ' + ', '.join(f'{c} {n}' for c, n in after_class[k].most_common()))
    print('reste, nommé (bloquant, aucun correctif de lecteur, pas revenue seule) :')
    for row in sorted(remaining[k]): print('  ', ' · '.join(row))
    if not remaining[k]: print('   aucun')
    print('revenue seule, cause non établie (collectes suivantes saines et prouvées) :')
    agg2 = collections.defaultdict(list)
    for jour, src, cls, back in remaining[k + '-back']: agg2[(src, cls, back)].append(jour[5:])
    for (src, cls, back), days in sorted(agg2.items()): print(f"   {src} ({len(days)} : {', '.join(days)}) · {cls} · {back}")
    if not agg2: print('   aucune')
    print('bloquant aux règles de ce lot mais lecteur corrigé depuis (commit · preuve) :')
    agg = collections.defaultdict(list)
    for jour, src, fix, proof in remaining[k + '-fixed']: agg[(src, fix, proof)].append(jour[5:])
    for (src, fix, proof), days in sorted(agg.items()): print(f"   {src} ({len(days)} : {', '.join(days)}) · {fix} · {proof}")
