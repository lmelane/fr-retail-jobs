"""R-143 §1 — coût par cadence et découverte projetée. Lit les sorties de ce dossier, aucune base.

    python3 audits/2026-10-02/cadence-r143/projection.py

Modèle (rejouable, graine fixe) :
- Délai de découverte = première observation - date de publication à la source (`firstSeenAt - postedAt`), la même
  définition que `comparaison-indeed/fraicheur-metriques.sql` Q2 bis (une date sans heure compte depuis minuit).
- L'offre est apparue à la source à un instant inconnu T entre max(postedAt, dernière collecte achevée de sa source
  avant sa première observation) et sa première observation. Si `postedAt` porte une heure et suit cette collecte,
  T = postedAt ; sinon (date sans heure, y compris minuit de Paris écrit 22:00 ou 23:00 UTC) T est tiré uniformément dans l'intervalle (10 tirages par offre, graine 20261002).
- Une date sans heure (40 % de la population) borne la mesure : publiée à 14:00 et vue à 16:00, l'offre compte 16 h.
  D'où la seconde lecture, sur les seules offres dont l'heure de publication est connue et postérieure à la collecte
  précédente (« heure exacte ») : là, le délai mesuré EST le délai de découverte.
- La borne Z (toutes les sources à chaque passe, coût d'un RUN par passe) n'est pas une option : elle dit ce que la
  cadence seule peut donner, et donc ce qui reste à gagner par une lecture incrémentale des grosses sources.
- Une source de la passe légère est observée à chaque passe, à l'heure de la passe plus le temps cumulé des sources qui
  la précèdent dans la passe (durée médiane mesurée, M1, en série) : projection = min(observation réelle, première
  passe achevée après T). Les autres sources gardent leur observation réelle (RUN quotidien).
"""
import csv, random, statistics
from datetime import datetime, timedelta
from pathlib import Path

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


lines = (HERE / 'mesure-sources.out').read_text().split('\n')
m1 = {r['key']: r for r in section(lines, 'M1')}
m3 = {r['sk']: r for r in section(lines, 'M3')}
days = 7.0
f = lambda v: float(v) if v not in (None, '') else 0.0

# --- La sélection : la règle, appliquée aux mesures (M1, M3). -----------------------------------------------------
# Une collecte complète tient en peu de requêtes (une liste d'API, pas une page par offre), toujours achevée sur les
# 7 RUN, en moins de 10 minutes médianes, et la source publie au moins une nouvelle offre par jour.
MAX_REQUESTS = 200
MAX_REQUEST_SHARE = 0.2        # requêtes / offres lues : au-delà, l'adaptateur lit une page par offre
MAX_MEDIAN_SECONDS = 600
MIN_NEW_PER_DAY = 1.0
EXCLUDED = {
    'marc-o-polo': 'generic-listing, 53 requêtes pour 15 offres (une page par offre)',
}


def eligible(key):
    r = m1[key]
    req, off, dur = f(r['req_med']), f(r['offres_lues_med']), f(r['dur_med_s'])
    new = f(m3.get(key, {}).get('par_jour'))
    return (key not in EXCLUDED and r['runs'] not in ('0', '') and r['toujours_complete'] in ('t', '') and r['lastRunStatus'] == 'OK'
            and 0 < req <= MAX_REQUESTS and off > 0 and req <= MAX_REQUEST_SHARE * off and dur <= MAX_MEDIAN_SECONDS and new >= MIN_NEW_PER_DAY)


rule = sorted((k for k in m1 if eligible(k)), key=lambda k: -f(m3.get(k, {}).get('par_jour')))
SETS = {
    'A  règle (API légères)': rule,
    'B  A + lvmh': rule + ['lvmh'],
    'C  B + ulta-jibe': rule + ['lvmh', 'ulta-jibe'],
    # Borne théorique, PAS une option : chaque source active collectée à chaque passe (coût = un RUN par passe).
    'Z  toutes les sources (borne)': sorted(m1, key=lambda k: f(m1[k]['dur_med_s'])),
}
CADENCES = {  # heures UTC des passes légères ; le RUN complet reste à 16:00 UTC (18:00 Paris), fenêtre 15:30-18:30 libre
    'aucune (RUN seul)': [],
    '2 fois par jour (00, 08)': [0, 8],
    'toutes les 6 h (04, 10, 22)': [4, 10, 22],
    'toutes les 4 h (00, 04, 08, 12, 20)': [0, 4, 8, 12, 20],
}

# --- Données ---------------------------------------------------------------------------------------------------------
P = lambda s: datetime.fromisoformat(s)
collect = {}
for row in csv.DictReader(open(HERE / 'collectes.csv')):
    collect.setdefault(row['sk'], []).append(P(row['started']))
offers = [r for r in csv.DictReader(open(HERE / 'offres.csv')) if r['posted']]


def date_only(o):
    """Une date sans heure : minuit UTC, ou minuit de Paris écrit en UTC (22:00 l'été, 23:00 l'hiver)."""
    return o['jour_seul'] == '1' or o['posted'][11:] in ('22:00:00', '23:00:00')


def pct(values, q):
    v = sorted(values)
    k = (len(v) - 1) * q
    lo, hi = int(k), min(int(k) + 1, len(v) - 1)
    return v[lo] + (v[hi] - v[lo]) * (k - lo)


def project(sources, hours):
    order = {k: i for i, k in enumerate(sources)}
    offset, acc = {}, 0.0
    for k in sources:                      # en série : la passe lit les sources l'une après l'autre
        acc += f(m1[k]['dur_med_s'])
        offset[k] = timedelta(seconds=acc)
    out, exact_out = [], []
    for o in offers:
        posted, seen = P(o['posted']), P(o['first_seen'])
        base = (seen - posted).total_seconds() / 3600
        if base < 0:
            continue
        k = o['sk']
        before = [c for c in collect.get(k, []) if c < seen - timedelta(hours=3)]
        exact = not date_only(o) and posted >= (before[-1] if before else posted)
        if k not in order or not hours:
            out.append([base] * 10)
            if exact:
                exact_out.append(base)
            continue
        # La collecte précédente est celle d'un AUTRE passage : une collecte dure jusqu'à 40 min et un RUN en ouvre
        # parfois deux (qualification, puis offres) ; « plus de 3 h avant la première observation » les écarte.
        lo = max([posted] + before[-1:])
        draws = []
        for _ in range(10):
            t = posted if exact else lo + (seen - lo) * random.random()
            nxt = None
            day = t.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
            for d in range(3):
                for h in hours:
                    done = day + timedelta(days=d, hours=h) + offset[k]
                    if done >= t and (nxt is None or done < nxt):
                        nxt = done
            proj = min(seen, nxt) if nxt else seen
            draws.append((proj - posted).total_seconds() / 3600)
        out.append(draws)
        if exact:
            exact_out.append(draws[0])
    flat = [x for d in out for x in d]
    return (pct(flat, 0.5), pct(flat, 0.9), sum(1 for d in out if statistics.mean(d) <= 24) / len(out),
            pct(exact_out, 0.5), pct(exact_out, 0.9), len(exact_out))


def cost(sources, passes):
    req = sum(f(m1[k]['req_med']) for k in sources)
    off = sum(f(m1[k]['offres_lues_med']) for k in sources)
    dur = sum(f(m1[k]['dur_med_s']) for k in sources)
    ups = sum(f(m1[k]['upsert_med_s']) for k in sources)
    new = sum(f(m3.get(k, {}).get('par_jour')) for k in sources)
    return req, off, dur, ups, new


total_new = sum(f(r['par_jour']) for r in m3.values())
run_offers = sum(f(r['offres_lues_med']) for r in m1.values())
run_req = sum(f(r['req_med']) for r in m1.values())
run_ups = sum(f(r['upsert_med_s']) for r in m1.values())
print(f'Population : {len(offers)} nouvelles offres datées ; {total_new:.0f} nouvelles offres par jour toutes sources.')
print(f'RUN complet (médianes M1 sommées) : {run_req:.0f} requêtes, {run_offers:.0f} offres réécrites, {run_ups/60:.0f} min d’écriture cumulée.')
print(f'\nSources de la règle ({len(rule)}) : {", ".join(rule)}')
for name, sources in SETS.items():
    req, off, dur, ups, new = cost(sources, 1)
    print(f'\n== Lot {name} : {len(sources)} sources, {new:.0f} nouvelles offres/jour ({100*new/total_new:.0f} %)')
    print(f'   une passe : {req:.0f} requêtes, {off:.0f} offres réécrites, {dur/60:.1f} min de collecte en série, {ups/60:.1f} min d’écriture')
    for cname, hours in CADENCES.items():
        med, p90, share24, emed, ep90, en = project(sources, hours)
        n = len(hours)
        print(f'   {cname:38s} médiane {med:5.1f} h  p90 {p90:5.1f} h  ≤24 h {100*share24:4.1f} %  | heure exacte ({en}) : médiane {emed:4.1f} h p90 {ep90:4.1f} h'
              + (f'  | par jour : +{n*req:.0f} requêtes ({100*n*req/run_req:.0f} % du RUN), +{n*off:.0f} offres réécrites ({100*n*off/run_offers:.0f} %), {n*dur/60:.0f} min de worker' if n else ''))
