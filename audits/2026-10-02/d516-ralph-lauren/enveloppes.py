"""D-516 §1 : décode la sortie des requêtes « corps-et-enveloppes.sql » et « cadence.sql ». N'imprime jamais une valeur
de cookie ni de jeton : seulement les noms d'en-têtes, leur longueur, la requête (paramètres de pagination) et les
200 premiers octets d'un corps de refus."""
import base64, gzip, json, sys

def scrub(o):
    if isinstance(o, dict):
        return {k: (f'<{len(str(v))} car.>' if k.lower() in ('cookie', 'set-cookie', 'x-aws-waf-token') else scrub(v)) for k, v in o.items()}
    if isinstance(o, list): return [scrub(x) for x in o]
    return o

for line in open(sys.argv[1]):
    p = line.rstrip('\n').split('|')
    if len(p) < 5 or p[3] not in ('resp', 'req'): continue
    raw = gzip.decompress(base64.b64decode(p[4])) if p[4] else b''
    if p[3] == 'resp': print(p[:3], p[5:], raw[:200]); continue
    try: d = json.loads(raw)
    except Exception: print(p[:3], raw[:300]); continue
    print(p[:3], json.dumps(scrub(d))[:1200])
