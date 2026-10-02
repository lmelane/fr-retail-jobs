"""D-520 critère 3 — agrège `catalogue.csv` (export en lecture seule de `catalogue.sql`) en catalogue des causes.
Rejouable : python3 catalogue.py > catalogue.out  (lit catalogue.csv dans le même dossier)."""
import csv, pathlib, collections
rows = list(csv.DictReader(open(pathlib.Path(__file__).with_name('catalogue.csv'))))
runs = sorted({(r['startedAt'], r['run']) for r in rows})
order = [r for _, r in runs]
nxt = {order[i]: order[i + 1] if i + 1 < len(order) else None for i in range(len(order))}
occ = collections.defaultdict(set)  # (classe, src) -> runs
off = {}
msgs = collections.defaultdict(collections.Counter)
for r in rows:
    occ[(r['classe'], r['src'])].add(r['run'])
    off[r['src']] = int(r['offres'] or 0)
    if r['msg']: msgs[r['classe']][r['msg'][:110]] += 1
print(f"Fenêtre : {len(order)} RUN ingest-all avec issues classées ({runs[0][0][:10]} → {runs[-1][0][:10]}), {len({r['src'] for r in rows})} sources\n")
print('RUN | sources en issue | sources bloquantes (hors retenue prouvée et D-480)')
for t, run in runs:
    rr = [r for r in rows if r['run'] == run]
    print(t[:16], '|', len({r['src'] for r in rr}), '|', len({r['src'] for r in rr if not r['classe'].startswith('A0') and r['connu'] != 't'}))
by = collections.defaultdict(list)
for (c, s), rs in occ.items(): by[c].append((s, rs))
print('\nclasse | occurrences (source×RUN) | sources | offres en jeu | disparue au RUN suivant | persiste | dernier RUN | sources ≥3 RUN')
stats = []
for c, lst in by.items():
    o = sum(len(rs) for _, rs in lst); gone = keep = last = 0
    for s, rs in lst:
        for run in rs:
            n = nxt[run]
            if n is None: last += 1
            elif n in rs: keep += 1
            else: gone += 1
    stats.append((o, c, len(lst), sum(off.get(s, 0) for s, _ in lst), gone, keep, last, sum(1 for _, rs in lst if len(rs) >= 3)))
for o, c, ns, of, g, k, l, p in sorted(stats, reverse=True):
    print(f'{c} | {o} | {ns} | {of} | {g} | {k} | {l} | {p}')
print('\nDétail par classe (hors A0) : source (RUN, offres) et messages types')
for o, c, *_ in sorted(stats, reverse=True):
    if c.startswith('A0'): continue
    lst = sorted(by[c], key=lambda x: -off.get(x[0], 0))
    print(f'\n## {c}')
    print('  ' + ', '.join(f"{s} ({len(rs)}, {off.get(s, 0)})" for s, rs in lst[:40]) + (' …' if len(lst) > 40 else ''))
    for m, n in msgs[c].most_common(4): print(f'  · {n}× {m}')

print('\nMatrice classe × RUN (sources ; * = dont non bloquantes D-480)')
cls = sorted({r['classe'] for r in rows})
print('classe | ' + ' | '.join(t[5:10] for t, _ in runs))
for c in cls:
    cells = []
    for _, run in runs:
        rr = [r for r in rows if r['run'] == run and r['classe'] == c]
        n = len({r['src'] for r in rr}); k = len({r['src'] for r in rr if r['connu'] == 't'})
        cells.append(f"{n}{'*' + str(k) if k else ''}" if n else '·')
    print(c[:60] + ' | ' + ' | '.join(cells))
last = runs[-1][1]
print('\nAu dernier RUN, sources bloquantes et leur classe :')
for r in sorted([r for r in rows if r['run'] == last and not r['classe'].startswith('A0') and r['connu'] != 't'], key=lambda r: -int(r['offres'] or 0)):
    print(f"  {r['src']} ({r['offres']}) — {r['classe']} — {r['code']}{'/' + r['detail'] if r['detail'] else ''}")
