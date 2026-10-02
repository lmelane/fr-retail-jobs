"""D-520 §2 — construit le fichier relu du registre explicite (02/10/2026), rejouable hors réseau.

Entrées, toutes dans le dépôt :
  - registre-2026-10-02.json                 photographie de production en lecture seule (mesure-registre.sql)
  - preuves-hors-service-2026-10-02.json     dernière validation, accès, identité des sources non ACTIVE
  - ../../2026-09-23/post-run-source-review.json   revue source par source du 23/09 (153 sources, preuves publiques)
Sorties :
  - registre-explicite-2026-10-02.json       le fichier relu (kind registre-explicite/1), lu par `registry-review`
  - registre-explicite-2026-10-02.csv        le même, à relire dans un tableur

Le motif reprend les mots de la décision ou de la revue qui a produit l'état ; une source sans décision le dit
(`fondement` PREUVE). Les questions d'identité sont tranchées par la méthode de D58 (activité et postes lus) et les précédents ;
REVUE_HUMAINE est réservée à une vraie décision produit (aucune au 02/10).
Usage : python3 construire-registre.py
"""
import csv
import json
import pathlib
import re

HERE = pathlib.Path(__file__).resolve().parent
snapshot = {s['key']: s for s in json.loads((HERE / 'registre-2026-10-02.json').read_text())}
review = {s['sourceKey']: s for s in json.loads((HERE / '../../2026-09-23/post-run-source-review.json').read_text())['sources']}

REVIEW_0923 = 'revue du 23/09 (audits/2026-09-23/post-run-source-review.json)'
PAUSE_REVIEW = '2026-10-09'
QUESTION_REVIEW = '2026-10-09'
entries = []


def add(key, intention, target, trajectory, fondement, decision, reason, next_action, review_at=None, question=None):
    s = snapshot[key]
    entries.append({
        'key': key, 'maison': s['maison'], 'currentStatus': s['status'], 'intention': intention, 'targetStatus': target,
        'trajectory': trajectory, 'basis': fondement, 'decision': decision, 'reason': reason, 'nextAction': next_action,
        'reviewAt': review_at, 'question': question,
    })


def concl(key):
    r = review[key]
    return (r.get('followUp') or {}).get('conclusion') or r['conclusion']


def first_sentence(text):
    return re.split(r'(?<=[.;])\s', text.strip(), maxsplit=1)[0].rstrip(' ;')


# 1. PAUSES — chacune avec sa décision, ou sans (dit), sa trajectoire et sa date de réexamen.
# Masquage (R-143 §2) : l'épargne d'une source en pause ne vaut que pour une pause posée par une décision (fondement
# DECISION) ; une pause sans décision suit le masquage normal (plafond de 72 h).
NO_DECISION = f'Aucune décision CEO : pause de la {REVIEW_0923}'
add('ralph-lauren-avature', 'COLLECTER', 'PAUSED', 'A_REPARER', 'DECISION', 'D-483 · D-516',
    "« Ralph Lauren est en pause jusqu'au lot anti-robot » (D-483) ; la collecte de publication a reçu un 406 après le second amorçage (D-516) : 0 offre publiée sur 1 160 lues.",
    "Livrer la lecture unique (l'ingestion rejoue la capture de qualification) avec r6, puis une collecte ciblée de preuve (D-482 §2) jugée sur les critères D-483 ; si le 406 revient, enquête D-516 §1.",
    '2026-10-05')
add('versace', 'COLLECTER', 'PAUSED', 'A_REPARER', 'DECISION', 'D-506 §1',
    "« Versace : pause seulement. Réversible. Les 49 offres restent en ligne, avec un lien mort, jusqu'à la reprise du site » (D-506 §1). Le 02/10, le site Versace du Workday de Capri redirige vers la page « outage » de Workday alors que le site Michael Kors du même tenant répond, et le portail du groupe Prada (déjà collecté par prada-group) publie des postes Versace (versace-sonde-2026-10-02.txt).",
    "Mesurer la part des postes Versace que publie le portail du groupe Prada (prada-group). Si le site Capri n'est pas revenu à la date de réexamen : carte de décision au CEO, puisque D-506 §1 a écarté le retrait.",
    '2026-10-05')
add('sioux', 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', NO_DECISION,
    "La page annonce explicitement l'absence d'offres ; le lecteur générique ne possède pas de protocole de zéro HTML qualifié : pause distincte d'une panne ou fermeture d'employeur (revue du 23/09) ; validation REJECTED (ENUMERATION_INCOMPLETE, EMPTY_FEED_NOT_NATIVELY_PROVEN). 19 offres servies, non revues depuis le 19/09.",
    "Donner au lecteur générique une preuve de zéro natif (page qui annonce l'absence d'offres), puis requalifier par la campagne. Pause sans décision : ses 19 offres suivent le masquage du plafond de 72 h.",
    PAUSE_REVIEW)
add('ghost', 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', NO_DECISION,
    "La page annonce explicitement l'absence d'offres ; le lecteur générique ne possède pas de protocole de zéro HTML qualifié : pause distincte d'une panne ou fermeture d'employeur (revue du 23/09) ; validation REJECTED (ENUMERATION_INCOMPLETE, EMPTY_FEED_NOT_NATIVELY_PROVEN).",
    "Donner au lecteur générique une preuve de zéro natif (page qui annonce l'absence d'offres), puis requalifier par la campagne.",
    PAUSE_REVIEW)
for key in ('nimble', 'rotate'):
    add(key, 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', NO_DECISION,
        "Offres visibles en HTML sans publication JSON-LD récupérée : limite du lecteur, pas un catalogue vide (revue du 23/09) ; validation REJECTED (ENUMERATION_INCOMPLETE, EMPTY_FEED_NOT_NATIVELY_PROVEN).",
        "Lire les offres inline de la page carrières (lecteur générique), puis requalifier par la campagne.",
        PAUSE_REVIEW)
add('minimalist', 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', NO_DECISION,
    "Rubrique Careers avec candidature spontanée, sans liste structurée identifiée ; pas de zéro natif attesté (revue du 23/09). Une candidature spontanée n'est jamais publiée (D-511).",
    "Chercher une liste publique (formulaire Zoho Recruit) ; sans liste, attester le zéro natif comme pour Ghost et Sioux.",
    PAUSE_REVIEW)
add('cotton-on', 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', NO_DECISION,
    "Validation native REJECTED (CONTENT_MISSING : neuf fiches dont description, responsabilités et qualifications sont réellement vides) ; le portail est servi sous un autre domaine d'employeur (cottonongroup.com.au, registre cottonongroup.com) : relation à instruire.",
    "Qualifier le tenant Oracle HCM (site CX) de la marque, établir la relation de domaine du groupe, puis requalifier par la campagne.",
    PAUSE_REVIEW)
add('de-beers-london', 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', NO_DECISION,
    "Le tenant configuré est Anglo American / De Beers Group : il liste aussi extraction minière et industrie ; pages officielles inaccessibles à la campagne (403/429/5xx) : blocage externe, identité ni prouvée ni contredite.",
    "Renommer le libellé public avant de requalifier. Lire l'employeur natif de chaque poste : un poste qui nomme De Beers publie sous De Beers ; un poste qui ne nomme pas son enseigne publie sous le groupe employeur (R-142 §3) ; les postes miniers et industriels d'Anglo American restent hors périmètre. Puis certifier le portail et requalifier.",
    PAUSE_REVIEW)
add('dim', 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', NO_DECISION,
    "Pages officielles inaccessibles à la campagne (403/429/5xx ou capture impossible) : blocage externe, identité ni prouvée ni contredite ; le board Greenhouse décrit DIM Brands International et ses marques.",
    "Obtenir une page officielle lisible qui lie le board Greenhouse (identité), puis requalifier ; la validation du 23/09 est VALIDATED sur la révision courante.",
    PAUSE_REVIEW)
add('fastrack', 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', NO_DECISION,
    "Collecte : HTTP 500 sur https://careers.titan.in/api/jobs ; le portail est celui du groupe Titan, pas uniquement Fastrack. 15 offres servies, non revues depuis le 18/09.",
    "Renommer le libellé public (le groupe Titan) avant de requalifier ; un poste qui ne nomme pas sa marque publie sous le groupe (R-142 §3). Pause sans décision : ses 15 offres suivent le masquage du plafond de 72 h.",
    PAUSE_REVIEW)
add('markham', 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', NO_DECISION,
    "TFG : 181/181 réponses natives sans LegalEmployer, BusinessUnit ni Organization nommés ; les textes décrivent plusieurs marques ; canal remis en PAUSED, aucun employeur déduit du texte libre (23/09).",
    "Le motif est levé par R-142 §3 (D-478, D-479) : un poste de portail de groupe qui ne nomme pas son enseigne publie sous le groupe. Renommer le libellé public (TFG) avant de requalifier, puis certifier le portail.",
    PAUSE_REVIEW)
add('oniverse', 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', NO_DECISION,
    "Validation native REJECTED (CONTENT_MISSING, REJECTED_NATIVE_ROWS, ENUMERATION_INCOMPLETE) : 734 URL, 146 réponses 404, 16 extractions sans contenu ; aucune couverture mondiale unique démontrée. Le 02/10, 109 offres ONIVERSE sont servies par wttj-sector (oniverse-couverture-2026-10-02.txt).",
    "Cartographier les portails régionaux (dont Paycom et InfoJobs), délimiter la complétude du sitemap, puis requalifier par la campagne.",
    PAUSE_REVIEW)
add('miu-miu', 'COLLECTER', 'RETIRED', 'A_REPARER', 'REGLE',
    "D58 (cadrage de Loïc, 10/09/2026, journal de l'agrégateur) : « une source liée au mauvais tenant est retirée sans clôture d'employeur » ; preuve du 24/09 (capture native, SourceExtraction fb462ad8)",
    "« Native capture identifies MIU as a private university founded in Egypt in 1996, not Miu Miu » : 7 offres de cette université sont servies sous Miu Miu depuis le 23/09. Le gel des données historiques de la note du 24/09 ne s'oppose pas au retrait : retire-source ne détruit aucune donnée (R-142 §2), il corrige une attribution.",
    "Source exclue par retire-source (7 offres retirées, données brutes conservées). La Maison Miu Miu n'a aucune source active : chercher son portail officiel (probablement celui du groupe Prada, prada-group), suivi par l'assistant.",
    '2026-10-09')

# 2. RETRAITS
D58 = "D58 (cadrage de Loïc, 10/09/2026, journal de l'agrégateur) : « une source liée au mauvais tenant est retirée sans clôture d'employeur »"
D58_METHOD = "Méthode de Loïc du 10/09/2026 (D58 : qualification par activité et par poste, jamais par le nom)"
D38 = "D38 (audit du 06/09/2026 demandé par Loïc) : « Onze sources hors secteur retirées » (Stripe Inc., Toast, Infuse, Bentley Systems, Tulip, Efore, Ohme, Towa, Dept, Wing, Peloton)"
D37 = "D37 (audit du 06/09/2026) : « Mosaic, Make, Stone by Stone retirés (hors secteur, accord Loïc) »"
DECIDED = {
    'luxe-talent': ('DECISION', 'D-453 §4 · D-477 · R-142', "« Le seul cabinet ou job board qui doit rester, c'est WTTJ » (D-477) ; Luxe Talent retirée le 29/09 par retire-source, 0 offre en ligne."),
    'fashionjobs': ('DECISION', 'Décision de Loïc du 08/09/2026 (note du registre) · R-142 §1-§2', "« FashionJobs is only employer-discovery and aggregate-count evidence; stop collecting its job offers » ; un job board tiers n'est pas collecté (R-142 §1)."),
    'michael-page-france': ('REGLE', 'R-142 §1-§2 (D-477) ; retrait d\'origine D37 (décision par délégation, lot 3 confié par Loïc)', "Michael Page est un cabinet de recrutement multi-employeurs et multisectoriel ; aucun cabinet n'est collecté (R-142 §1)."),
    'egon-zehnder': ('REGLE', 'R-142 §1-§2 (D-477)', "Cabinet de conseil et recherche de dirigeants multisectoriel : retiré comme cabinet de recrutement sans canal sectoriel qualifié ni publication (23/09)."),
    'avila': ('REGLE', 'R-142 §1-§2 (D-477)', "Le tenant redirige careers.avila.fi et publie des recrutements de cabinet de chasse pour plusieurs entreprises (23/09) ; aucun cabinet n'est collecté."),
    'cal-k-holding': ('DECISION', 'Décision de Loïc du 10/09/2026 (note du registre)', "« Owner decision 2026-09-10: qualification by activity and by posting — none is in perimeter; the source is withdrawn » (Çalık Holding, conglomérat ; postes de finance et d'énergie)."),
    'maryruth-s': ('DECISION', 'Décision de Loïc du 10/09/2026 (note du registre)', "« Owner decision 2026-09-10: nutrition and supplements only remain out of perimeter; a beauty activity would have to be proven separately — none is »."),
}
D38_KEYS = {'stripe-stare', 'toast', 'infuse', 'bentley', 'tulip', 'ohme', 'towa', 'dept', 'wing', 'peloton'}
D37_KEYS = {'mosaic', 'make', 'stone-by-stone'}
# Identités non prouvées : tranchées par la méthode de D58 (activité et postes lus), jamais par le nom.
IDENTITY = {
    'agency': "Le board générique Agency renvoie privy.net et affiche rédaction/média ; aucun employeur nommé « Agency » n'est prouvé par une page officielle (revue du 23/09). Aucune Maison n'est exclue : la source n'est rattachée à aucun employeur prouvé.",
    'atlantis': "Le tenant lie atlantis-vt.de et affiche logistique, menuiserie et projet (revue du 23/09) : activité hors périmètre.",
    'genesis': "Le tenant s'intitule Genesis Global (logiciel financier) et lie un domaine de carrière non résolu (revue du 23/09) : activité hors périmètre.",
    'imi-s': "Le board affiche IMI et des postes techniques à Topeka (revue du 23/09) : activité industrielle, pas la marque imi's.",
    'route-one-skin': "Timeout sur le board « route » ; aucune page officielle de route one skin ne lie ce tenant (revue du 23/09) : identité non prouvée, la source n'est rattachée à aucun employeur prouvé.",
    'bright': "Le tenant bright.recruitee.com redirige vers la page commerciale générique Recruitee : aucun portail d'employeur (revue du 23/09).",
}
WTTJ_RULE = "R-143 §4 (D-513 : une même opportunité n'apparaît qu'une fois) : doublon du balayage wttj-sector (D39, 06/09/2026)"
small = {r['maison']: r for r in json.loads((HERE / 'wttj-petites-maisons-2026-10-02.json').read_text())}
SMALL_KEYS = {'figaret': 'figaret', 'jerome-dreyfuss': 'dreyfuss', 'moea': 'moea', 'payot': 'payot', 'embryolisse': 'embryolisse',
              'louise-misha': 'louise misha', 'lunettes-pour-tous': 'lunettes pour tous', 'monsieur-tshirt': 'monsieur',
              'simone-perele': 'simone p', 'wolf-lingerie': 'wolf lingerie'}
EXACT = {'gate', 'yes', 'dna'}

for key, s in sorted(snapshot.items()):
    if s['status'] != 'RETIRED' or any(e['key'] == key for e in entries):
        continue
    r = review.get(key)
    action = ((r or {}).get('followUp') or {}).get('decision') or (r or {}).get('action')
    if key in DECIDED:
        basis, decision, reason = DECIDED[key]
        add(key, 'NE_PAS_COLLECTER', 'RETIRED', 'DECISION', basis, decision, reason, 'Aucune : source exclue.')
    elif key in D38_KEYS or key in D37_KEYS:
        add(key, 'NE_PAS_COLLECTER', 'RETIRED', 'DECISION', 'DECISION', D38 if key in D38_KEYS else D37,
            concl(key).rstrip('. ') + '.', "Aucune : source exclue (hors secteur). Une vraie source de la Maison homonyme, si elle existe, relève de la découverte.")
    elif key in IDENTITY:
        add(key, 'NE_PAS_COLLECTER', 'RETIRED', 'DECISION', 'REGLE', D58_METHOD, IDENTITY[key],
            "Aucune : source exclue. Une vraie source de la Maison attendue, si elle existe, relève de la découverte.")
    elif key == 'army-logic':
        add(key, 'COLLECTER', 'RETIRED', 'A_REPARER', 'REGLE',
            "Précédent madame-figaro (média de mode collecté sur preuve d'employeur, ACTIVE) ; D58 (rattacher le tenant à son employeur réel)",
            "Le tenant Lever configuré est Hypebeast, avec HBX (boutique), média et création ; le label Army Logic n'est pas l'employeur natif (revue du 23/09).",
            "Rattacher la source à Hypebeast (libellé, identité prouvée par hypebeast.com), puis la requalifier par la campagne.",
            '2026-10-16')
    elif key == 'f-a-e':
        add(key, 'NE_PAS_COLLECTER', 'RETIRED', 'DECISION', 'REGLE',
            D58_METHOD + " ; précédent MaryRuth's (décision de Loïc du 10/09 : nutrition hors périmètre)",
            "Le board thrivemarket renvoie Thrive Market, détaillant alimentaire en ligne (revue du 23/09) : activité alimentaire, hors du périmètre mode, luxe, beauté et retail de mode.",
            "Aucune : source exclue. f.a.e. reste à couvrir par sa vraie source, si elle existe (découverte).")
    elif action == 'KEEP_RETIRED_COVERED_CHANNEL' and s['kind'] == 'wttj':
        m = re.match(r'(\d+)/(\d+)', concl(key))
        extra = ''
        if key in SMALL_KEYS:
            w = small[SMALL_KEYS[key]]
            extra = f" Maison de 3 offres ou moins au 23/09, sous le plancher de l'alerte de couverture : {w['servies']} offre(s) servie(s) par wttj-sector au 02/10, dernière vue le {w['derniereVue'][:10]}."
        add(key, 'COUVERTE_AILLEURS', 'RETIRED', 'DECISION', 'REGLE', WTTJ_RULE,
            f"Collecteur WTTJ individuel en doublon du balayage sectoriel wttj-sector : {m.group(1)}/{m.group(2)} offres natives observées dans le flux sectoriel le 23/09.{extra}",
            "Aucune pour ce canal. Une perte de la Maison sur wttj-sector relèvera de l'alerte de couverture de D-518 §2, construite sur development, non livrée."
            + (" Plancher de 5 offres : la vérifier à la main au réexamen." if key in SMALL_KEYS else ''),
            '2026-10-16' if key in SMALL_KEYS else None)
    elif action in ('KEEP_RETIRED_COVERED_CHANNEL', 'KEEP_RETIRED_DUPLICATE', 'KEEP_RETIRED_DUPLICATE_REPAIR_REPLACEMENT'):
        repl = [c['sourceKey'] for c in r['coverage']['candidateReplacements']]
        state = ', '.join(f"{k} {snapshot[k]['status']} ({snapshot[k]['lastRunStatus']}, {snapshot[k]['activeJobs']} offres)" for k in repl)
        decision = "R-143 §4 (D-513 : une même opportunité n'apparaît qu'une fois) ; doublon prouvé le 10/09 et le 23/09"
        if key == 'b2':
            decision = D58 + " ; « un doublon de route aussi (b2 = browns-shoes) »"
        add(key, 'COUVERTE_AILLEURS', 'RETIRED', 'DECISION', 'REGLE', decision,
            first_sentence(concl(key)) + f" Remplacement : {state} au 02/10.",
            "Aucune pour ce canal ; l'état du remplacement relève de l'état opérationnel des sources actives (sourceState.ts).")
    elif action == 'KEEP_RETIRED_CURRENT_CHANNEL_UNQUALIFIED':
        add(key, 'COLLECTER', 'RETIRED', 'A_REPARER', 'PREUVE', f'Aucune décision : {REVIEW_0923}',
            "Le site officiel renvoie vers son profil WTTJ, absent de la capture sectorielle actuelle ; maintien retiré du canal individuel, sans déclarer zéro poste ni fermeture de l'employeur (23/09).",
            "Faire entrer l'organisation dans le balayage wttj-sector (configuration des organisations) ; R-142 §1 admet les pages employeur WTTJ.",
            '2026-10-16')
    elif action == 'KEEP_RETIRED_DEMO':
        lindex = key == 'lindex'
        add(key, 'NE_PAS_COLLECTER', 'RETIRED', 'DECISION', 'PREUVE',
            "Aucune décision pour ce retrait : contenu de démonstration de l'éditeur prouvé le 09/09 ; R-142 §2 (retire-source)"
            + (" ; Lindex est requalifiée sur EasyCruit (D-481 §1)" if lindex else ''),
            concl(key),
            {'ganni': "Aucune : source exclue ; GANNI est servie par ganni-talentrecruiter (R-142 §7).", 'lindex': 'Aucune : source exclue ; Lindex est servie par lindex-easycruit.'}.get(key, 'Aucune : source exclue.'))
    elif action in ('KEEP_RETIRED_WRONG_EMPLOYER', 'KEEP_RETIRED_ENDPOINT_UNAVAILABLE', 'KEEP_RETIRED_IDENTITY_UNRESOLVED', 'KEEP_RETIRED_SCOPE_REVIEW'):
        reason = (r['conclusion'].rstrip('. ') + '. ' + (r.get('followUp') or {}).get('conclusion', '')).strip() if key in EXACT else concl(key).rstrip('. ') + '.'
        if 'Evidence: ' in (s['note'] or ''):
            reason += f" Preuve du 08/09 : {s['note'].split('Evidence: ')[1].split(' ')[0].rstrip('.')}"
        add(key, 'NE_PAS_COLLECTER', 'RETIRED', 'DECISION', 'REGLE', D58, reason,
            "Aucune : source exclue. Une vraie source de la Maison homonyme, si elle existe, relève de la découverte.")
    else:
        raise SystemExit(f'non classée : {key} ({action})')

# 3. Contrôle de complétude : toute source non ACTIVE de la photographie a exactement une entrée.
non_active = sorted(k for k, s in snapshot.items() if s['status'] != 'ACTIVE')
keys = [e['key'] for e in entries]
assert sorted(keys) == non_active and len(set(keys)) == len(keys), (set(non_active) ^ set(keys))
assert all(e['reviewAt'] for e in entries if e['targetStatus'] == 'PAUSED'), 'pause sans date de réexamen'
assert all(e['question'] for e in entries if e['trajectory'] == 'REVUE_HUMAINE'), 'revue humaine sans question'

entries.sort(key=lambda e: e['key'])
plan = {'kind': 'registre-explicite/1', 'reviewer': 'D-520 §2 — registre explicite des sources, lecture D-492, 02/10/2026',
        'observedAt': '2026-10-02T14:12:36Z', 'entries': entries}
(HERE / 'registre-explicite-2026-10-02.json').write_text(json.dumps(plan, ensure_ascii=False, indent=2) + '\n')
with open(HERE / 'registre-explicite-2026-10-02.csv', 'w', newline='') as f:
    cols = ['key', 'maison', 'intention', 'currentStatus', 'targetStatus', 'reason', 'basis', 'decision', 'trajectory', 'nextAction', 'reviewAt', 'question']  # basis = fondement
    w = csv.DictWriter(f, fieldnames=cols)
    w.writerow({c: {'basis': 'fondement', 'reason': 'motif', 'decision': 'décision', 'trajectory': 'trajectoire', 'nextAction': 'prochaine action',
                    'reviewAt': 'réexamen', 'currentStatus': 'état actuel', 'targetStatus': 'état cible'}.get(c, c) for c in cols})
    for e in entries:
        w.writerow({c: e.get(c) or '' for c in cols})
from collections import Counter
print(len(entries), Counter((e['intention'], e['trajectory']) for e in entries))
print(Counter(e['basis'] for e in entries))
