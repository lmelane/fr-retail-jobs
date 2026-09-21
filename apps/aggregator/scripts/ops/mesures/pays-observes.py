"""Tous les pays observés dans le catalogue publiable — le registre ne borne pas la mesure."""
import json, sys, pathlib, collections

c = pathlib.Path(sys.argv[1])
with (c / 'offres.jsonl').open(encoding='utf8') as f:
    offres = [json.loads(l) for l in f if l.strip()]

pub = [o for o in offres if o['publiable']]
pays = collections.Counter(o['countryCode'] or 'INCONNU' for o in pub)

codes = {k: v for k, v in pays.items() if k != 'INCONNU'}
print("═══ PAYS OBSERVÉS — population : offres PUBLIABLES ═══")
print(f"  offres publiables : {len(pub)}")
print(f"  codes pays distincts : {len(codes)}   (+ INCONNU, catégorie de diagnostic)")
print(f"  sans countryCode : {pays.get('INCONNU', 0)}\n")

cum = 0
print(f"  {'#':>3} {'pays':6} {'offres':>7} {'part':>7} {'cumul':>7}")
for i, (k, v) in enumerate(sorted(codes.items(), key=lambda kv: -kv[1]), 1):
    cum += v
    if i <= 25:
        print(f"  {i:>3} {k:6} {v:>7} {v/len(pub)*100:>6.1f}% {cum/len(pub)*100:>6.1f}%")
print(f"\n  queue ({len(codes)-25} pays restants) : {sum(sorted(codes.values(), reverse=True)[25:])} offres")
