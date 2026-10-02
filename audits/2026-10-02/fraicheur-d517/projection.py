"""D-517 — sélection par importance, coût d'une lecture incrémentale et découverte projetée. Lit les sorties de ce dossier
et de `../cadence-r143/` (M1 : durées et requêtes médianes des 7 RUN), aucune base.

    python3 audits/2026-10-02/fraicheur-d517/projection.py > audits/2026-10-02/fraicheur-d517/projection.out

Modèle (rejouable, graine fixe), celui de `cadence-r143/projection.py`, appliqué à la sélection et au coût de D-517 :
- Délai de découverte = première observation - date de publication (`firstSeenAt - postedAt`) : la mesure du CEO
  (Indeed). Seconde lecture « heure exacte » : les offres dont l'heure de publication est connue et postérieure à la
  collecte précédente, la seule où le délai mesuré EST le délai de découverte (population biaisée, voir README).
- L'offre apparaît à un instant T entre max(postedAt, collecte précédente) et sa première observation (tiré
  uniformément quand l'heure est inconnue, 10 tirages par offre, graine 20261002). Une source de la passe est lue à
  chaque passe (04, 10, 22 UTC), à l'heure de la passe plus l'instant où elle se termine dans une passe à 4 sources
  en parallèle (ordonnancement simulé, dans l'ordre de la sélection) : projection = min(observation réelle, première
  passe achevée après T). Les autres sources gardent leur observation réelle (RUN quotidien).
- Coût d'une lecture incrémentale, par source : la LISTE entière (requêtes de liste mesurées au dernier RUN, F2), plus
  une requête de détail par publication nouvelle de la fenêtre de 6 h (flux F4 / 4), pour les adaptateurs qui lisent
  le détail à part et savent l'éviter (Workday, SmartRecruiters, SuccessFactors, Eightfold, Phenom CareerConnect,
  iCIMS, Oracle, DigitalRecruiters, WTTJ, generic-listing, Swatch, JobAffinity) ; les autres relisent ce qu'ils lisaient
  (une liste qui porte tout : Teamtailor, Jibe, LVMH, Greenhouse… ; ou un lecteur non adapté : Eqwa, Talentview, Taleo…).
  Le temps d'une requête est celui du RUN (M1 : collecte médiane / requêtes médianes), porte par hôte comprise.
- Écritures : une passe n'écrit que le neuf (une écriture par offre nouvelle), contre une réécriture de chaque offre
  lue par la passe complète de la lecture R-143 §1.
"""
import csv, random, statistics
from datetime import datetime, timedelta
from pathlib import Path
import re

HERE = Path(__file__).resolve().parent
random.seed(20261002)


def section(lines, tag):
    i = next(k for k, l in enumerate(lines) if l.startswith(tag))
    hdr = lines[i + 1].split('|')
    rows = []
    for l in lines[i + 2:]:
        if l.startswith('('):
            break
        rows.append(dict(zip(hdr, l.split('|'))))
    return rows


f = lambda v: float(v) if v not in (None, '') else 0.0
mine = (HERE / 'mesure.out').read_text().split('\n')
F1 = {r['key']: r for r in section(mine, 'F1')}
F2 = section(mine, 'F2')
F4 = {r['key']: r for r in section(mine, 'F4')}
cad = (HERE.parent / 'cadence-r143' / 'mesure-sources.out').read_text().split('\n')
M1 = {r['key']: r for r in section(cad, 'M1')}

# --- La sélection : la règle exacte de la passe (F4, significantSources) -----------------------------------------------
selected = [k for k, r in sorted(F4.items(), key=lambda kv: -f(kv[1]['par_jour'])) if r['retenue'] == 't']
flux = {k: f(r['par_jour']) for k, r in F4.items()}
flux_total = sum(f(r['n']) for r in F4.values())
flux_sel = sum(f(F4[k]['n']) for k in selected)
OLD_LIGHT = ['ami-paris', 'figs', 'jojo-maman-bebe', 'gymshark', 'merkal', 'ephemera', 'monica-vinader', 'soeur', 'kiko-milano',
             'singularu', 'browns', 'kult-olymp-hades', 'eram-3', 'jeans-centre', 'ms-mode', 'my-jewellery', 'boggi-milano',
             'white-stuff', 'brilliant-earth', 'reformation', 'suitsupply', 'adopt-parfums', 'armand-thiery-flatchr', 'chalhoub',
             'space-nk', 'hans-anders', 'akira', 'clarkson-eyecare', 'etam', 'aroma-zone', 'lush', 'arcteryx', 'mejuri', 'normal',
             'element-6', 'galeries-lafayette', 'la-casa-de-las-carcasas', 'rituals', 'lovisa', 'lvmh']
flux_old = sum(f(F4[k]['n']) for k in OLD_LIGHT if k in F4)

# --- Le coût d'une lecture incrémentale -------------------------------------------------------------------------------
LIST_SHAPE = {
    'WORKDAY': lambda m, p: m == 'POST' and p.endswith('/jobs'),
    'SMARTRECRUITERS': lambda m, p: p.endswith('/postings'),
    'SUCCESSFACTORS': lambda m, p: p.startswith('/search') or '/services/recruiting/' in p,
    'EIGHTFOLD': lambda m, p: p.endswith('/api/pcsx/search'),
    'ORACLE_HCM': lambda m, p: p.endswith('recruitingCEJobRequisitions'),
    'DIGITALRECRUITERS': lambda m, p: m == 'POST',
    'ICIMS': lambda m, p: p.endswith('/jobs/search'),
    'PHENOM': lambda m, p: p.endswith('/widgets') or p.endswith('/api/jobs'),
    'WTTJ': lambda m, p: '/indexes/' in p,
    'SWATCHGROUP': lambda m, p: 'job-finder' in p,
    # generic-listing : la page de liste (pagination, recherche, appel ajax), jamais l'adresse d'une offre.
    'GENERIC_JSONLD': lambda m, p: bool(re.search(r'page|search|ajax', p, re.I)) or p == '/#' or '#' not in p,
}
SKIPS_DETAIL = set(LIST_SHAPE) | {'JOBAFFINITY_WORDPRESS'}
KIND_OF = {'workday': 'WORKDAY', 'successfactors': 'SUCCESSFACTORS', 'smartrecruiters-whitelabel': 'SMARTRECRUITERS', 'eightfold': 'EIGHTFOLD',
           'oraclehcm': 'ORACLE_HCM', 'digitalrecruiters': 'DIGITALRECRUITERS', 'icims': 'ICIMS', 'phenom': 'PHENOM', 'wttj-sector': 'WTTJ',
           'wttj': 'WTTJ', 'swatchgroup': 'SWATCHGROUP', 'generic-listing': 'GENERIC_JSONLD', 'jobaffinity-wordpress': 'JOBAFFINITY_WORDPRESS'}
listreq, ats = {}, {}
for r in F2:
    ats[r['sk']] = r['kind']
    test = LIST_SHAPE.get(r['kind'])
    if test and test(r['method'], r['forme']):
        listreq[r['sk']] = listreq.get(r['sk'], 0) + int(r['requetes'])


def incremental_requests(k):
    """Requêtes d'une passe : la liste, plus le détail du neuf de 6 h ; une source sans détail évitable relit tout."""
    m = M1.get(k, {})
    total, read = f(m.get('req_med')), f(m.get('offres_lues_med'))
    new = flux.get(k, 0) / 4
    kind = ats.get(k) or KIND_OF.get(F4.get(k, {}).get('kind', ''))
    if kind == 'JOBAFFINITY_WORDPRESS':
        return 2 + 2 * new          # la grille, puis article, géographie et page de candidature du seul neuf
    if kind not in SKIPS_DETAIL:
        return total
    # Liste mesurée au dernier RUN (F2) ; à défaut (source en échec ce jour-là), tout ce qui n'est pas une fiche.
    listing = listreq.get(k) or max(1.0, total - read)
    return min(total, listing + new) if total else listing + new


def seconds(k, requests):
    m = M1.get(k, {})
    per_request = f(m.get('fetch_med_s')) / f(m.get('req_med')) if f(m.get('req_med')) else 0.3
    per_write = f(m.get('upsert_med_s')) / f(m.get('offres_lues_med')) if f(m.get('offres_lues_med')) else 0.1
    return requests * per_request + flux.get(k, 0) / 4 * per_write + 5   # + admission, scellement, validation


def schedule(order, durations, workers=4):
    """Les instants où chaque source se termine dans une passe à `workers` sources en parallèle (pLimit, dans l'ordre)."""
    free = [0.0] * workers
    done = {}
    for k in order:
        i = min(range(workers), key=lambda j: free[j])
        free[i] += durations[k]
        done[k] = free[i]
    return done, max(free)


inc = {k: incremental_requests(k) for k in selected}
dur = {k: seconds(k, inc[k]) for k in selected}
done, makespan = schedule(selected, dur)
full_req = {k: f(M1.get(k, {}).get('req_med')) for k in selected}
run_req = sum(f(r['req_med']) for r in M1.values())
run_writes = sum(f(r['offres_lues_med']) for r in M1.values())

# --- Découverte projetée -------------------------------------------------------------------------------------------
P = lambda s: datetime.fromisoformat(s)
collect = {}
for row in csv.DictReader(open(HERE / 'collectes.csv')):
    collect.setdefault(row['sk'], []).append(P(row['started']))
offers = [r for r in csv.DictReader(open(HERE / 'offres.csv')) if r['posted']]


def date_only(o):
    return o['jour_seul'] == '1' or o['posted'][11:] in ('22:00:00', '23:00:00')


def pct(values, q):
    v = sorted(values)
    k = (len(v) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def project(sources, hours, offset):
    chosen = set(sources)
    out, exact_out, covered = [], [], 0
    for o in offers:
        posted, seen = P(o['posted']), P(o['first_seen'])
        base = (seen - posted).total_seconds() / 3600
        if base < 0:
            continue
        k = o['sk']
        before = [c for c in collect.get(k, []) if c < seen - timedelta(hours=3)]
        exact = not date_only(o) and posted >= (before[-1] if before else posted)
        if k not in chosen or not hours:
            out.append([base] * 10)
            if exact:
                exact_out.append(base)
            continue
        covered += 1
        lo = max([posted] + before[-1:])
        draws = []
        for _ in range(10):
            t = posted if exact else lo + (seen - lo) * random.random()
            nxt = None
            day = t.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
            for d in range(3):
                for h in hours:
                    end = day + timedelta(days=d, hours=h) + timedelta(seconds=offset[k])
                    if end >= t and (nxt is None or end < nxt):
                        nxt = end
            proj = min(seen, nxt) if nxt else seen
            draws.append((proj - posted).total_seconds() / 3600)
        out.append(draws)
        if exact:
            exact_out.append(draws[0])
    flat = [x for d in out for x in d]
    return dict(med=pct(flat, 0.5), p90=pct(flat, 0.9), le24=sum(1 for d in out if statistics.mean(d) <= 24) / len(out),
                emed=pct(exact_out, 0.5), ep90=pct(exact_out, 0.9), n=len(out), en=len(exact_out), covered=covered)


print('== Sélection D-517 (règle exacte de la passe, F4)')
print(f'   {len(selected)} sources retenues sur {len(F4)} ACTIVE avec un flux ; {100 * flux_sel / flux_total:.1f} % des nouvelles publications'
      f' ({flux_sel:.0f} sur {flux_total:.0f} en 7 jours) ; avant (40 sources par coût) : {100 * flux_old / flux_total:.1f} %')
for name in ['prada-group', 'rolex', 'burberry', 'valentino', 'clarins', 'swatch-group', 'hm-group', 'ulta-jibe', 'knitwell-us-retail',
             'nordstrom', 'wttj-sector', 'tapestry', 'estee-lauder-companies', 'kering', 'pvh', 'lvmh', 'parfums-chanel', 'richemont-workday']:
    print(f'   {name:24s} {"retenue" if name in selected else "NON retenue"} {flux.get(name, 0):6.1f} / jour')
excluded = sorted(((k, flux[k]) for k in F4 if k not in selected), key=lambda kv: -kv[1])[:12]
print('   premières sources non retenues :', ', '.join(f'{k} {v:.1f}' for k, v in excluded))
for th in (0.5, 1, 2):
    s = [k for k, r in F4.items() if f(r['par_jour']) >= th and f(r['jours']) >= 1]
    print(f'   seuil {th} / jour : {len(s)} sources, {100 * sum(f(F4[k]["n"]) for k in s) / flux_total:.1f} % du flux')

print('\n== Coût d’une passe (lecture incrémentale de la sélection)')
by_kind = {}
for k in selected:
    kind = ats.get(k) or KIND_OF.get(F4.get(k, {}).get('kind', ''), F4.get(k, {}).get('kind', '?'))
    agg = by_kind.setdefault(kind, [0, 0.0, 0.0])
    agg[0] += 1; agg[1] += full_req[k]; agg[2] += inc[k]
for kind, (n, full, incr) in sorted(by_kind.items(), key=lambda kv: -kv[1][1]):
    print(f'   {kind:22s} {n:3d} sources : lecture complète {full:7.0f} requêtes, incrémentale {incr:7.0f}')
tot_inc, tot_full = sum(inc.values()), sum(full_req.values())
new_day = sum(flux[k] for k in selected)
print(f'   une passe : {tot_inc:.0f} requêtes (lecture complète des mêmes sources : {tot_full:.0f}) ; {makespan / 60:.0f} min à 4 sources en parallèle'
      f' (série : {sum(dur.values()) / 60:.0f} min) ; plus longue source : {max(dur, key=dur.get)} {max(dur.values()) / 60:.0f} min')
print(f'   toutes les 4 h (5 passes) : +{5 * tot_inc:.0f} requêtes par jour ({100 * 5 * tot_inc / run_req:.0f} % du RUN)')
print(f'   par jour, 3 passes : +{3 * tot_inc:.0f} requêtes ({100 * 3 * tot_inc / run_req:.0f} % du RUN, {run_req:.0f}) ;'
      f' écritures : le neuf seul, ~{new_day * 0.75:.0f} offres écrites par jour (+{100 * new_day * 0.75 / run_writes:.1f} % des {run_writes:.0f} réécritures du RUN),'
      f' contre +{3 * sum(f(M1.get(k, {}).get("offres_lues_med")) for k in selected):.0f} si la passe relisait tout')

print('\n== Découverte projetée (RUN à 16:00 UTC, passes à 04, 10, 22 UTC)')
base = project([], [], {})
light = project([k for k in OLD_LIGHT if k in M1], [4, 10, 22], {k: 0 for k in OLD_LIGHT})
d517 = project(selected, [4, 10, 22], done)
d517_4h = project(selected, [0, 4, 8, 12, 20], done)
for name, r in [('RUN seul (aujourd’hui)', base), ('lecture R-143 §1 : 40 sources par coût, toutes les 6 h', light),
                ('D-517 : sélection par importance, incrémentale, toutes les 6 h', d517),
                ('D-517, toutes les 4 h (00, 04, 08, 12, 20)', d517_4h)]:
    print(f'   {name:62s} mesure du CEO médiane {r["med"]:5.1f} h p90 {r["p90"]:5.1f} h, ≤24 h {100 * r["le24"]:4.1f} %'
          f' | heure exacte ({r["en"]}) médiane {r["emed"]:4.1f} h p90 {r["ep90"]:4.1f} h | offres couvertes {100 * r["covered"] / r["n"]:4.1f} %')
