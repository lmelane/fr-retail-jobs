"""D-520 §2 — construit le fichier relu du registre explicite (02/10/2026), rejouable hors réseau.

Entrées, toutes dans le dépôt :
  - registre-2026-10-02.json                 photographie de production en lecture seule (mesure-registre.sql)
  - preuves-hors-service-2026-10-02.json     dernière validation, accès, identité des sources non ACTIVE
  - ../../2026-09-23/post-run-source-review.json   revue source par source du 23/09 (153 sources, preuves publiques)
Sorties :
  - registre-explicite-2026-10-02.json       le fichier relu (kind registre-explicite/1), lu par `registry-review`
  - registre-explicite-2026-10-02.csv        le même, à relire dans un tableur

Le motif reprend les mots de la décision ou de la revue qui a produit l'état ; une source sans décision le dit
(`fondement` PREUVE). Aucune trajectoire d'abandon n'est tranchée ici : un retrait sans décision ni preuve
d'homonymie devient REVUE_HUMAINE avec sa question.
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
add('ralph-lauren-avature', 'COLLECTER', 'PAUSED', 'A_REPARER', 'DECISION', 'D-483 · D-516',
    "« Ralph Lauren est en pause jusqu'au lot anti-robot » (D-483) ; la collecte de publication a reçu un 406 après le second amorçage (D-516) : 0 offre publiée sur 1 160 lues.",
    "Livrer la lecture unique (l'ingestion rejoue la capture de qualification, D-517 lecture) avec r6, puis une collecte ciblée de preuve (D-482 §2) jugée sur les critères D-483 ; si le 406 revient, enquête D-516 §1.",
    '2026-10-05')
add('versace', 'COLLECTER', 'PAUSED', 'REVIENT_SEULE', 'DECISION', 'D-506 §1',
    "« Versace : pause seulement. Réversible. Les 49 offres restent en ligne, avec un lien mort, jusqu'à la reprise du site » (le site Workday de Versace hors service, 49 liens morts sur 49).",
    "Sonder le site Workday de Versace ; dès qu'il répond, collecte ciblée de preuve (D-482 §2) puis réouverture. Les 49 offres servies sans lien vivant relèvent de R-143 §2 (masquage des offres non reconfirmées).",
    '2026-10-05')
for key in ('sioux', 'ghost'):
    add(key, 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', f'Aucune décision CEO : pause de la {REVIEW_0923}',
        "La page annonce explicitement l'absence d'offres ; le lecteur générique ne possède pas de protocole de zéro HTML qualifié : pause distincte d'une panne ou fermeture d'employeur (revue du 23/09) ; validation REJECTED (ENUMERATION_INCOMPLETE, EMPTY_FEED_NOT_NATIVELY_PROVEN).",
        ("Donner au lecteur générique une preuve de zéro natif (page qui annonce l'absence d'offres), corriger careersDomain, requalifier par la campagne."
         + (" Les 19 offres servies, non revues depuis le 19/09, relèvent de R-143 §2." if key == 'sioux' else '')),
        PAUSE_REVIEW)
for key in ('nimble', 'rotate'):
    add(key, 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', f'Aucune décision CEO : pause de la {REVIEW_0923}',
        "Offres visibles en HTML sans publication JSON-LD récupérée : limite du lecteur, pas un catalogue vide (revue du 23/09) ; validation REJECTED (ENUMERATION_INCOMPLETE, EMPTY_FEED_NOT_NATIVELY_PROVEN).",
        "Lire les offres inline de la page carrières (lecteur générique), corriger careersDomain (ancien domaine Recruitee), requalifier par la campagne.",
        PAUSE_REVIEW)
add('minimalist', 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', f'Aucune décision CEO : pause de la {REVIEW_0923}',
    "Rubrique Careers avec candidature spontanée, sans liste structurée identifiée ; pas de zéro natif attesté (revue du 23/09). Une candidature spontanée n'est jamais publiée (D-511).",
    "Chercher une liste publique (formulaire Zoho Recruit) ; sans liste, attester le zéro natif comme pour Ghost et Sioux. Corriger careersDomain (minimalist.recruitee.com est ancien).",
    PAUSE_REVIEW)
add('cotton-on', 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', f'Aucune décision CEO : pause de la {REVIEW_0923}',
    "Validation native REJECTED (CONTENT_MISSING : neuf fiches dont description, responsabilités et qualifications sont réellement vides) ; le portail est servi sous un autre domaine d'employeur (cottonongroup.com.au, registre cottonongroup.com) : relation à instruire.",
    "Qualifier le tenant Oracle HCM (site CX) de la marque, comparer les identifiants à l'ancienne route, établir la relation de domaine du groupe ; requalifier par la campagne.",
    PAUSE_REVIEW)
add('de-beers-london', 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', f'Aucune décision CEO : pause de la {REVIEW_0923}',
    "Le tenant configuré est Anglo American / De Beers Group : il liste aussi extraction minière et industrie ; pages officielles inaccessibles à la campagne (403/429/5xx) : blocage externe, identité ni prouvée ni contredite.",
    "Lire l'employeur natif de chaque poste et ne publier que les postes De Beers (R-142 §3 pour un portail de groupe) ; certifier le portail ; requalifier par la campagne.",
    PAUSE_REVIEW)
add('dim', 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', f'Aucune décision CEO : pause de la {REVIEW_0923}',
    "Pages officielles inaccessibles à la campagne (403/429/5xx ou capture impossible) : blocage externe, identité ni prouvée ni contredite ; le board Greenhouse décrit DIM Brands International et ses marques.",
    "Obtenir une page officielle lisible qui lie le board Greenhouse (identité), puis requalifier ; la validation du 23/09 est VALIDATED sur la révision courante.",
    PAUSE_REVIEW)
add('fastrack', 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', f'Aucune décision CEO : pause de la {REVIEW_0923}',
    "Collecte : HTTP 500 sur https://careers.titan.in/api/jobs ; le portail actuel est celui du groupe Titan, pas uniquement Fastrack (careersDomain encore fastrack.teamtailor.com).",
    "Corriger careersDomain, publier sous le groupe l'offre qui ne nomme pas sa marque (R-142 §3), requalifier par la campagne. Les 15 offres servies, non revues depuis le 18/09, relèvent de R-143 §2.",
    PAUSE_REVIEW)
add('markham', 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', f'Aucune décision CEO : pause de la {REVIEW_0923}',
    "TFG : 181/181 réponses natives sans LegalEmployer, BusinessUnit ni Organization nommés ; les textes décrivent plusieurs marques ; canal remis en PAUSED, aucun employeur déduit du texte libre (23/09).",
    "Le motif est levé par R-142 §3 (D-478, D-479) : une offre de portail de groupe qui ne nomme pas son enseigne publie sous le groupe (TFG). Requalifier sous cette règle et certifier le portail.",
    PAUSE_REVIEW)
add('oniverse', 'COLLECTER', 'PAUSED', 'A_REPARER', 'PREUVE', f'Aucune décision CEO : pause de la {REVIEW_0923}',
    "Validation native REJECTED (CONTENT_MISSING, REJECTED_NATIVE_ROWS, ENUMERATION_INCOMPLETE) : 734 URL, 146 réponses 404, 16 extractions sans contenu ; aucune couverture mondiale unique démontrée.",
    "Cartographier les portails régionaux (dont Paycom et InfoJobs), délimiter la complétude du sitemap, requalifier par la campagne.",
    PAUSE_REVIEW)
add('miu-miu', 'NE_PAS_COLLECTER', 'RETIRED', 'EXCLUE_PAR_DECISION', 'PREUVE',
    "Aucune décision CEO : WRONG_EMPLOYER prouvé le 24/09 (capture native, SourceExtraction fb462ad8) ; même retrait sur preuve que les homonymes de la revue du 23/09 (R-142 §2, retire-source)",
    "« Native capture identifies MIU as a private university founded in Egypt in 1996, not Miu Miu » : 7 offres de cette université sont servies sous Miu Miu depuis le 23/09.",
    "retire-source : les 7 offres sortent du catalogue, données brutes conservées. Miu Miu n'a aucune source active : la Maison reste à couvrir (découverte).")

# 2. RETRAITS
DECIDED = {
    'luxe-talent': ('D-453 §4 · D-477 · R-142', "« Le seul cabinet ou job board qui doit rester, c'est WTTJ » (D-477) ; Luxe Talent retirée le 29/09 par retire-source, 0 offre en ligne."),
    'fashionjobs': ('Décision de Loïc du 08/09/2026 (note du registre) · R-142 §1-§2', "« FashionJobs is only employer-discovery and aggregate-count evidence; stop collecting its job offers » ; un job board tiers n'est pas collecté (R-142 §1)."),
    'michael-page-france': ('R-142 §1-§2 (D-477)', "Michael Page est un cabinet de recrutement multi-employeurs et multisectoriel ; aucun cabinet n'est collecté (R-142 §1)."),
    'egon-zehnder': ('R-142 §1-§2 (D-477)', "Cabinet de conseil et recherche de dirigeants multisectoriel : retiré comme cabinet de recrutement sans canal sectoriel qualifié ni publication (23/09)."),
    'avila': ('R-142 §1-§2 (D-477)', "Le tenant redirige careers.avila.fi et publie des recrutements de cabinet de chasse pour plusieurs entreprises (23/09) ; aucun cabinet n'est collecté."),
    'cal-k-holding': ('Décision de Loïc du 10/09/2026 (note du registre)', "« Owner decision 2026-09-10: qualification by activity and by posting — none is in perimeter; the source is withdrawn » (Çalık Holding, conglomérat ; postes de finance et d'énergie)."),
    'maryruth-s': ('Décision de Loïc du 10/09/2026 (note du registre)', "« Owner decision 2026-09-10: nutrition and supplements only remain out of perimeter; a beauty activity would have to be proven separately — none is »."),
}
QUESTIONS = {
    'agency': "Le board SmartRecruiters « agency » (renvoie privy.net, rédaction/média luxe) est-il le portail d'un employeur du périmètre, et lequel ?",
    'atlantis': "Le tenant Personio atlantis (atlantis-vt.de, logistique et menuiserie) est-il l'« Atlantis » attendue ? Sinon, quel est le portail de cette Maison ?",
    'genesis': "Le tenant Lever « genesis » (Genesis Global, domaine non résolu) est-il la Maison attendue ? Sinon, quel est son portail ?",
    'imi-s': "Le board Greenhouse « imi » (IMI, postes techniques à Topeka) est-il imi's ? Sinon, quel est le portail d'imi's ?",
    'ohme': "Le board Greenhouse « ohme » (HTTP 403 au 23/09) est-il le portail de ōhme ? Une page officielle de la marque doit le lier.",
    'route-one-skin': "Le board Greenhouse de route one skin (timeout au 23/09) est-il le portail de la Maison ? Une page officielle doit le lier.",
    'bright': "Le tenant Recruitee « bright » n'expose plus de portail employeur (redirection commerciale Recruitee) : BRIGHT a-t-elle un autre portail ?",
    'army-logic': "Le tenant Lever configuré est Hypebeast (HBX, média et création), pas Army Logic : Hypebeast/HBX entre-t-il dans le périmètre luxe, mode, beauté, retail ? Si oui, rattacher le tenant à Hypebeast et requalifier.",
    'peloton': "Peloton Interactive (portail mondial : ingénierie, studios, ventes, avec des postes retail en showroom) entre-t-il dans le périmètre ? Si oui, quel sous-périmètre de postes collecter ?",
    'dept': "DEPT (agence numérique multisectorielle, 213 offres) : ses postes relèvent-ils du périmètre, ou l'agence est-elle hors catalogue comme un cabinet (R-142 §1) ?",
}
WTTJ_D39 = 'D39 (Loïc, 06/09/2026 : « WTTJ par balayage sectoriel », journal de l\'agrégateur) · R-142 §1'

for key, s in sorted(snapshot.items()):
    if s['status'] != 'RETIRED' or any(e['key'] == key for e in entries):
        continue
    r = review.get(key)
    action = ((r or {}).get('followUp') or {}).get('decision') or (r or {}).get('action')
    if key in DECIDED:
        decision, reason = DECIDED[key]
        add(key, 'NE_PAS_COLLECTER', 'RETIRED', 'EXCLUE_PAR_DECISION', 'DECISION', decision, reason, 'Aucune.')
    elif key in QUESTIONS:
        add(key, 'A_TRANCHER', 'RETIRED', 'REVUE_HUMAINE', 'PREUVE', f'Aucune décision : retrait maintenu par la {REVIEW_0923}',
            first_sentence(concl(key)) + " ; sa reprise exige une preuve officielle du tenant (23/09).",
            'Revue d\'identité ou de périmètre, puis selon la réponse : qualification par la campagne, ou retrait confirmé.',
            QUESTION_REVIEW, QUESTIONS[key])
    elif action == 'KEEP_RETIRED_COVERED_CHANNEL' and s['kind'] == 'wttj':
        m = re.match(r'(\d+)/(\d+)', concl(key))
        add(key, 'COUVERTE_AILLEURS', 'RETIRED', 'EXCLUE_PAR_DECISION', 'DECISION', WTTJ_D39,
            f"Collecteur WTTJ individuel couvert par le balayage sectoriel wttj-sector : {m.group(1)}/{m.group(2)} offres natives observées dans le flux sectoriel le 23/09.",
            "Aucune ; une perte de couverture de la Maison sur wttj-sector est signalée par l'alerte de couverture (D-518 §2).")
    elif action in ('KEEP_RETIRED_COVERED_CHANNEL', 'KEEP_RETIRED_DUPLICATE', 'KEEP_RETIRED_DUPLICATE_REPAIR_REPLACEMENT'):
        repl = [c['sourceKey'] for c in r['coverage']['candidateReplacements']]
        state = ', '.join(f"{k} {snapshot[k]['status']} ({snapshot[k]['lastRunStatus']}, {snapshot[k]['activeJobs']} offres)" for k in repl)
        add(key, 'COUVERTE_AILLEURS', 'RETIRED', 'EXCLUE_PAR_DECISION', 'REGLE',
            'R-143 §4 (D-513 : une même opportunité n\'apparaît qu\'une fois) ; aucune décision nominative : doublon prouvé le 10/09 et le 23/09',
            first_sentence(concl(key)) + f" Remplacement : {state} au 02/10.",
            "Aucune pour ce canal ; l'état du remplacement relève de l'état opérationnel des sources actives.")
    elif action == 'KEEP_RETIRED_CURRENT_CHANNEL_UNQUALIFIED':
        add(key, 'COLLECTER', 'RETIRED', 'A_REPARER', 'PREUVE', f'Aucune décision : {REVIEW_0923}',
            "Le site officiel renvoie vers son profil WTTJ, absent de la capture sectorielle actuelle ; maintien retiré du canal individuel, sans déclarer zéro poste ni fermeture de l'employeur (23/09).",
            "Faire entrer l'organisation dans le balayage wttj-sector (configuration des organisations) ; R-142 §1 admet les pages employeur WTTJ.",
            '2026-10-16')
    elif action in ('KEEP_RETIRED_WRONG_EMPLOYER', 'KEEP_RETIRED_REBIND_CANDIDATE', 'KEEP_RETIRED_ENDPOINT_UNAVAILABLE',
                    'KEEP_RETIRED_IDENTITY_UNRESOLVED', 'KEEP_RETIRED_SCOPE_REVIEW'):
        add(key, 'NE_PAS_COLLECTER', 'RETIRED', 'EXCLUE_PAR_DECISION', 'PREUVE',
            "Aucune décision CEO : retrait sur preuve d'homonymie (le tenant est un autre employeur, hors du périmètre de D-519 §1) ; R-142 §2 (retire-source)",
            concl(key).rstrip('. ') + '.' + (f" Preuve du 08/09 : {s['note'].split('Evidence: ')[1].split(' ')[0].rstrip('.')}" if 'Evidence: ' in (s['note'] or '') else ''),
            "Aucune pour cette source ; une vraie source de la Maison, si elle existe, relève de la découverte.")
    elif action == 'KEEP_RETIRED_DEMO':
        lindex = key == 'lindex'
        add(key, 'NE_PAS_COLLECTER', 'RETIRED', 'EXCLUE_PAR_DECISION', 'DECISION' if lindex else 'PREUVE',
            'D-481 §1 (« Lindex est requalifiée » : lindex-easycruit)' if lindex else "Aucune décision CEO : retrait sur preuve (contenu de démonstration de l'éditeur) ; R-142 §2",
            concl(key),
            {'ganni': "Aucune ; GANNI est servie par ganni-talentrecruiter (R-142 §7).", 'lindex': 'Aucune ; Lindex est servie par lindex-easycruit.'}.get(key, 'Aucune.'))
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
    cols = ['key', 'maison', 'intention', 'currentStatus', 'targetStatus', 'reason', 'basis', 'decision', 'trajectory', 'nextAction', 'reviewAt', 'question']
    w = csv.DictWriter(f, fieldnames=cols)
    w.writeheader()
    for e in entries:
        w.writerow({c: e.get(c) or '' for c in cols})
from collections import Counter
print(len(entries), Counter((e['intention'], e['trajectory']) for e in entries))
print(Counter(e['basis'] for e in entries))
