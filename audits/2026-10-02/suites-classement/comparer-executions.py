"""Les réponses du contrat 1 exécutées en lecture seule (psql), avant et après : (total, md5 de la page) par cas.
Usage : python3 comparer-executions.py <sortie-psql-avant> <sortie-psql-apres>"""
import re, sys
def lire(f):
    cas, out, nom = {}, [], None
    for l in open(f):
        l = l.rstrip('\n')
        if l.startswith('Time:') or not l.strip(): continue
        m = re.match(r'^\s*(\d+)\s*\|\s*([0-9a-f]{32}|)\s*$', l)
        if m and nom is not None: cas[nom] = (int(m.group(1)), m.group(2)); nom = None
        else: nom = l.strip()
    return cas
a, b = lire(sys.argv[1]), lire(sys.argv[2])
diff = [k for k in a if a[k] != b.get(k)]
print(f"{len(a)} cas exécutés avant, {len(b)} après ; réponses (total, md5 de la page) identiques : {len(a) - len(diff)} ; différentes : {diff}")
