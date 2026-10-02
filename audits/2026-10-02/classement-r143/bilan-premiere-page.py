"""R-143 §7 : bilan de la première page (25 offres), avant (ordre de D-510) et après (classement pertinent), sur les
sorties de `mesure-servie.mts` (MODE=page). Pour chaque cas :
  · requêtes : combien d'intitulés NOMMENT la requête (chaque mot significatif de la requête commence un mot de
    l'intitulé, sans accents ni casse : « conseillère » nomme « conseiller ») ;
  · profils : combien d'offres ont pour MÉTIER PRINCIPAL le premier métier des préférences ; et, comme les pastilles du
    site (`coches.ts`), combien sont en accord, neutres ou en désaccord avec ses contrats ;
  · l'âge (jours depuis la fraîcheur de D-510) : médiane, 90e centile, maximum, offres de plus de 30 jours ;
  · Maisons distinctes, et offres communes aux deux pages.
Puis, après : chaque offre de plus de 30 jours en première page, avec les points qui l'y ont portée.
Usage : python3 bilan-premiere-page.py <avant.json> <apres.json>"""
import json, statistics, sys, unicodedata

LIAISON = {'de', 'du', 'des', 'd', 'of', 'au', 'aux', 'la', 'le', 'les', 'en', 'et', 'and'}
PREFERABLES = {'PERMANENT', 'FIXED_TERM', 'TEMPORARY', 'APPRENTICESHIP', 'INTERNSHIP', 'FREELANCE'}

def mots(t):
    t = unicodedata.normalize('NFKD', t or '').encode('ascii', 'ignore').decode().lower()
    return [m for m in ''.join(c if c.isalnum() else ' ' for c in t).split() if m]

def nomme(titre, q):
    tm = mots(titre)
    return all(any(x.startswith(m) for x in tm) for m in mots(q) if m not in LIAISON)

def contrat(o, voulus):
    if not voulus:
        return None
    choix = [o.get('employmentTerm'), o.get('programType'),
             'FREELANCE' if o.get('engagementType') in ('FREELANCE', 'INDEPENDENT_CONTRACTOR') else None]
    choix = [c for c in choix if c]
    if any(c in voulus for c in choix):
        return 'accord'
    return 'desaccord' if any(c in PREFERABLES for c in choix) else 'neutre'

def p90(x):
    s = sorted(x)
    return s[min(len(s) - 1, round(0.9 * (len(s) - 1)))]

avant, apres = (json.load(open(f)) for f in sys.argv[1:3])
print(f"{'cas':44}{'total':>8}  {'nomme / métier':>15}  {'âge méd.':>10}  {'p90':>9}  {'max':>9}  {'>30 j':>7}  {'Maisons':>8}  communes  contrat accord/neutre/désaccord")
vieilles = []
for a, b in zip(avant, apres):
    assert a['nom'] == b['nom']
    def stats(r):
        page = r['page']
        ages = [o['ageJours'] for o in page if o.get('ageJours') is not None]
        if r['type'] == 'requete':
            n = sum(nomme(o.get('titre'), r['q']) for o in page)
        else:
            n = sum(o.get('occupationCode') == r['profil']['metiers'][0] for o in page)
        c = [contrat(o, set(r['profil']['contrats'])) for o in page] if r['type'] == 'profil' else []
        ctr = f"{c.count('accord')}/{c.count('neutre')}/{c.count('desaccord')}" if c else '-'
        return n, statistics.median(ages) if ages else 0, p90(ages) if ages else 0, max(ages) if ages else 0, \
            sum(x > 30 for x in ages), len({o.get('maison') for o in page}), ctr
    sa, sb = stats(a), stats(b)
    communes = len({o['id'] for o in a['page']} & {o['id'] for o in b['page']})
    print(f"{a['nom'][:44]:44}{a['total']:>8}  {sa[0]:>6} → {sb[0]:<6}  {sa[1]:>4.1f} → {sb[1]:<4.1f}  {sa[2]:>3.0f} → {sb[2]:<3.0f}"
          f"  {sa[3]:>3.0f} → {sb[3]:<3.0f}  {sa[4]:>2} → {sb[4]:<2}  {sa[5]:>2} → {sb[5]:<2}  {communes:>8}  {sa[6]} → {sb[6]}"
          + ('' if a['total'] == b['total'] else f"  TOTAL DIFFÉRENT {b['total']}"))
    for rang, o in enumerate(b['page'], 1):
        if (o.get('ageJours') or 0) > 30:
            vieilles.append(f"  {b['nom'][:40]:40} rang {rang:>2}  {o.get('origine', ''):9} {o['ageJours']:>6.1f} j  points {o.get('points')}  « {(o.get('titre') or '')[:60]} »")
print(f"\nAprès : offres de plus de 30 jours en première page ({len(vieilles)}), points [intitulé, lieu, contrat, télétravail, salaire, âge]")
print('\n'.join(vieilles) or '  aucune')
