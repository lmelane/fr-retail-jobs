# Alerte de couverture et bulletin de la boucle candidat (R-143 §11, D-515 §5, D-516 §2), 02/10/2026

Production lue en **lecture seule** le 02/10/2026 entre 11:03 et 11:57 UTC (`db.py readonly` : psql, et Prisma dans
une transaction `READ ONLY`), hors fenêtre du RUN. Aucune écriture, aucun e-mail.

| Fichier | Ce qu'il fait |
|---|---|
| `historique.sql` → `historique.json.gz` | Reconstruit, à la fin de chaque RUN quotidien depuis le 23/09, les offres servies par société et pays ; les fins d'offre (JobEvent) ; les offres qui ne tenaient qu'à des collectes en échec à ce RUN (SourceRun) ; les fusions de sociétés ; les sources qualifiées qui ne servent rien |
| `a-blanc.sql` → `a-blanc.json.gz` | La première revue de disponibilité (R-143 §2) à blanc, par société et pays, avec sa cause : même règle que `../r143-disponibilite/disponibilite-a-blanc.sql` (bloc D1), mesurée vers 11:12 UTC (9 933 offres masquées ; 9 863 à la mesure de 08:40) |
| `rejeu.mts` → `rejeu.out`, `rejeu-premier-run.json`, `rejeu-masque.json` | Passe chaque RUN, puis quatre scénarios du 02/10, par le code même du RUN (`evaluateCoverage`), hors ligne ; calibrage des seuils |
| `bulletin-exemple.mts` → `bulletin-exemple.html` (non versionné, `.gitignore` : régénéré par la commande), `indicateurs.json` | Le bulletin du premier RUN de r6 (projection : masquage à blanc, table des photographies vide) avec les indicateurs 1 à 6 lus sur la production |
| `mesure-cout.mts` → `mesure-cout.json` | Le coût réel des lectures de la revue sur la production |

Rejouer (checkout qui porte les accès, jamais entre 15:30 et 18:30 UTC) :

```sh
python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -t -q -v ON_ERROR_STOP=1 -f audits/2026-10-02/boucle-couverture/historique.sql' | gzip -9 > audits/2026-10-02/boucle-couverture/historique.json.gz
python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -X -A -t -q -v ON_ERROR_STOP=1 -f audits/2026-10-02/boucle-couverture/a-blanc.sql' | gzip -9 > audits/2026-10-02/boucle-couverture/a-blanc.json.gz
npx tsx audits/2026-10-02/boucle-couverture/rejeu.mts audits/2026-10-02/boucle-couverture/historique.json.gz audits/2026-10-02/boucle-couverture/a-blanc.json.gz audits/2026-10-02/d508-swatch-fermeture/fermetures-a-blanc.csv
python3 apps/aggregator/scripts/ops/db.py readonly npx tsx audits/2026-10-02/boucle-couverture/bulletin-exemple.mts
python3 apps/aggregator/scripts/ops/db.py readonly npx tsx audits/2026-10-02/boucle-couverture/mesure-cout.mts
```

Une fois les migrations `20261002140000` et `20261002180000` appliquées, la commande `coverage` de l'agrégateur rejoue
l'alerte et le bulletin courants sans photographie ni e-mail (seul le journal d'exécution habituel, `PipelineRun`, est
écrit, comme pour `health-report`). Avant r6, `bulletin-exemple`
et `mesure-cout` retirent du texte des requêtes la seule lecture des colonnes de retenue, absentes de la production.

## Comment l'alerte compte

- **Perte de ce RUN** : les offres servies par Maison et par marché sont lues juste avant les étapes qui retirent
  (refresh, revue de disponibilité, sonde), puis après. La différence est ce que ces étapes ont retiré, attribué à leurs
  seules sorties. Le premier RUN de r6 voit donc son masquage sans aucune photographie.
- **Perte d'habitude** : médiane des 7 derniers RUN photographiés (au moins 3), relevée au dernier RUN s'il est plus
  haut ; les sorties comptées depuis l'instant de cette référence. La seule médiane ne voyait plus l'Afrique du Sud (83
  offres le 25/09, 182 le 01/10) ; la seule veille ferait d'un RUN raté une perte le lendemain.
- **Menace** : une offre servie qu'aucune collecte du dernier RUN complet n'a revue (échec, lecture incomplète, source
  absente du RUN), venant d'une source active : le plafond de 72 h la masquera. Signalée dès ce RUN, par source.
  Une passe légère (R-143 §1) qui la revoit la retire des menaces ; l'état affiché de la source est celui du RUN.
- **Source non servie** : dernière qualification d'au moins 10 offres, aucune servie.
- La photographie d'un RUN n'enregistre l'alerte que si le bulletin est parti ; sinon le RUN suivant la redit.

## Seuils retenus et pourquoi (`THRESHOLDS`, `apps/aggregator/src/coverage/coverageAlert.ts`)

| Entité | Significatif si | Mesure qui le fonde (`rejeu.out`, calibrage) |
|---|---|---|
| Maison | ≥ 5 offres **et** ≥ 30 %, **ou** ≥ 200 offres | plancher 10 : PICARD (6 sur 6) manqué ; 20 % : pertes « pour information » de 1-6 à 1-11 par jour, 82 alertes au masquage à blanc au lieu de 43 ; 30 % = le seuil de trou de la mesure R-143 §2 ; sans le volume de 200, Ulta (1 220 offres, 10,9 %) n'alerte pas |
| Marché | ≥ 25 offres **et** ≥ 20 %, **ou** ≥ 500 offres | 30 % laisse la Hongrie au ras (30,3 %) ; plancher 50 la manque (40 offres) ; aucune perte de marché sur l'historique, à aucun réglage essayé |
| Source qualifiée | ≥ 10 offres lues, 0 servie | Ralph Lauren 1 160, L'Oréal Professionnel 1 716 |

Limite du calibrage : les cas attendus sont ceux de la mesure R-143 §2 au seuil de 30 %, et l'historique ne contient
aucun masquage. Le bruit des pertes après r6 n'est pas mesurable avant r6.

La gravité vient de la cause, jamais du volume : collecte en échec ou incomplète, ou sans cause trouvée → à réparer ;
masquée (non revue, lien mort) ou retirée sans preuve de fin → à vérifier ; fermeture prouvée, retenue ou pause
décidée, doublons regroupés → pour information. Une perte ne réveille que si sa part due aux causes qui réveillent est
elle-même significative.

## Rejeu sur l'historique réel (`rejeu.out`)

**Cas attendus, tous déclenchés :**

| Cas | Constat | Gravité |
|---|---|---|
| Diptyque, `diptyque-workday` en ERROR au RUN du 01/10 (dernier succès : RUN du 30/09, 16:43) | menace : 186 offres servies (100 %), masquées à partir du 02/10 16:49 UTC (2 offres non revues le 30/09), le 03/10 vers 16:43 pour les 184 autres | à réparer, dès le 01/10 |
| Browns chaussures, `browns-shoes` BROKEN au 01/10 | menace : 58 offres (100 %), masquées à partir du 03/10 16:19 UTC | à réparer |
| Ralph Lauren en pause | source qualifiée, 1 160 lues, 0 servie | pour information (pause décidée) |
| Masquage R-143 §2, premier RUN de r6, table vide | Afrique du Sud 38,7 % (70 sur 181), Hongrie 30,3 % (40 sur 132), PICARD 100 % (6, plafond de 72 h : à réparer), Marni 71,4 %, Primark 39,4 %, H&M 31,8 % ; aussi Ulta 1 220 (10,9 %), Nordstrom 228 (14,8 %) | à vérifier, sauf PICARD |
| 68 fermetures Swatch de D-508 §6 | 2 constats sur les Maisons du groupe (Meco, Blancpain), fermeture prouvée | **aucune alerte qui réveille** |

Le premier RUN de r6 rendrait 44 alertes qui réveillent (3 à réparer : PICARD, Gemmyo, L'Oréal Professionnel ; 41 à
vérifier) sur 9 933 offres masquées, une fois. L'en-tête du bulletin les ramène à 29 sources à traiter et au stock
masqué par Maison (`bulletin-exemple.html`). L'Oréal Professionnel (source active, 1 716 offres qualifiées, aucune
servie, HTTP 406 chaque jour) est un trou réel que rien ne signalait.

**Bruit, 7 derniers RUN quotidiens** (alertes qui réveillent, nouvelles) : 25/09 0, 26/09 0, 27/09 1, 28/09 3,
29/09 15, 30/09 2, 01/10 3. Moyenne 3,4 par jour, médiane 2. Toutes sont des menaces : sans masquage en production,
aucune perte historique ne réveille. Le pic du 29/09 est l'incident réel du périmètre d'accès (15 sources en échec au
même RUN). Une alerte déjà posée, au moins aussi grave, au RUN précédent est « en cours » : elle ne compte plus parmi
les nouvelles. Le rejeu juge les menaces historiques sur le statut du `SourceRun` (ERROR, BROKEN, TIMEOUT) : la
dernière observation de chaque offre à chaque RUN passé n'est pas conservée. La production les juge sur la dernière
observation, qui couvre aussi les lectures incomplètes.

## Coût (`mesure-cout.json`)

Sur la production (86 631 offres servies, 1 067 Maisons, 41 marchés) : avant du RUN 0,3 s, état comparé 3,5 s,
indicateurs 4,4 s.

## Indicateurs de la boucle (lus le 02/10, `indicateurs.json`)

1. Découverte : médiane 17,3 h, p90 42 h (11 121 offres datées des 7 derniers jours, dont 4 413 au jour seul).
2. Doublons servis : 2 732 groupes, 4,1 % des offres en trop (3 592 sur 86 631).
3. Rattachement : métier 63,0 %, contrat 37,3 %, lieu 91,0 %. Maison : non mesurée par le bulletin.
4. Classement par préférences : non mesuré par le bulletin (le classement de R-143 §7 est arrivé sur `development` pendant ce lot, `09c830e`).
5. Alertes : 12,2 h médiane jusqu'au prochain envoi (offres du 01/10 au soir, envoi du vendredi 07:30) ; calendrier
   seulement, à l'heure de Paris pour tous les marchés.
6. Confiance au clic : masquées 0 % (aucune retenue avant r6) ; sonde hors RUN non lue ; non revues depuis 48 h
   8,7 % (7 865 sur 89 893 offres actives, rapport de santé).
7. Couverture : l'alerte ci-dessus.
