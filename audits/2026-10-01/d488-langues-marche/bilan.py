"""D-488 : le bilan de la mesure locale (latence.mts) : médianes des deux passes, avant/après, et identité des résultats.
Usage : python3 bilan.py avant-1.json avant-2.json apres-1.json apres-2.json"""
import json, sys
av1, av2, ap1, ap2 = (json.load(open(f))['cas'] for f in sys.argv[1:5])
print(f"{'cas':32} {'total':>6} {'avant ms (p1/p2)':>18} {'après ms (p1/p2)':>18} {'gain':>6}  mêmes offres, même ordre")
for cas in av1:
    a = sorted([av1[cas]['medianeMs'], av2[cas]['medianeMs']]); b = sorted([ap1[cas]['medianeMs'], ap2[cas]['medianeMs']])
    meme = all(x[cas]['total'] == av1[cas]['total'] and x[cas]['premiers'] == av1[cas]['premiers'] for x in (av2, ap1, ap2))
    gain = 1 - (b[0] + b[1]) / max(1, a[0] + a[1])
    print(f"{cas:32} {av1[cas]['total']:>6} {str(av1[cas]['medianeMs']) + '/' + str(av2[cas]['medianeMs']):>18} "
          f"{str(ap1[cas]['medianeMs']) + '/' + str(ap2[cas]['medianeMs']):>18} {gain:>6.0%}  {'oui' if meme else 'NON'}")
