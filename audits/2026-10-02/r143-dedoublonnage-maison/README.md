# R-143 §4 et §5 — dédoublonnage par preuves natives, Maison avant l'entité juridique (02/10/2026)

Décision : [[D-513]] (backend, `docs/governance/DECISIONS.md`), règle R-143 §4 et §5. Constat de départ :
`audits/2026-10-02/comparaison-indeed/canonique-dedup.sql` (2 734 groupes de doublons visibles, 3 594 offres en trop ;
Nike 40 entités, Puma 42, Uniqlo 33, Hugo Boss 21, Michael Kors 23).

**État** : construit sur `development`. Rien n'a été écrit en production. Les deux commandes n'ont tourné qu'en aperçu
sur la base de test locale. Leur `--apply` attend le GO explicite du CEO et la lecture [[D-492]] insérée sous D-513.

## Ce qui est construit

| | Code | Témoin |
|---|---|---|
| Réquisition SAP publiée par le portail LVMH (`atsId`, lien `career55.sapsf.eu … jobId=N`) et par le site RMK de Sephora (« Job ID: N » dans le texte publié) | `identity/successfactorsRequisition.ts` | `successfactorsRequisition.test.ts`, `pipeline/r143-dedoublonnage.test.ts` |
| Fiche Teamtailor d'une enseigne publiée par le site du groupe (Etam → Maison 123, Undiz) : identité **déléguée** | `identity/teamtailor.ts` (`teamtailorDelegatedIdentity`) | `teamtailor.test.ts` |
| Publication SmartRecruiters citée par WTTJ (`detail.apply_url`) : identité **déléguée** | `identity/smartrecruiters.ts` | `smartrecruiters.test.ts` |
| Une délégation ne prouve qu'en face de la publication que l'émetteur sert lui-même | `dedup/match.ts` | les trois fichiers ci-dessus |
| Rattrapage du stock : `consolidate-publications` | `dedup/consolidate.ts` | `pipeline/r143-dedoublonnage.test.ts` |
| Entité juridique → Maison : `attach-maisons` | `identity/maisonAttachment.ts`, `identity/maisonPlan.ts` | `maisonAttachment.test.ts`, `pipeline/r143-maison.test.ts` |

**Les deux commandes, en deux temps** (`docs/employer-identity.md`) : l'aperçu (`--output=<fichier>`) n'écrit rien ;
`--apply --plan=<fichier relu>` n'applique que ce fichier, recalcule l'aperçu et refuse sans rien écrire s'il en diffère
(`REVIEWED_PLAN_MISMATCH`). `consolidate-publications` traite au plus `--limit` groupes par passage (500 par défaut,
ordre stable) : le stock mesuré (2 139 groupes) demande cinq passages aperçu → relecture → application.

## Ce que fait le RUN au quotidien, et ce que font les commandes

- **Dédoublonnage** : les nouvelles clés sont lues à l'ingestion (`match.ts` → `blockingKey`, puis `upsert.ts` revérifie
  la preuve deux à deux). Une publication NOUVELLE rejoint l'offre jumelle au fil du RUN, dans les deux ordres
  (témoin « joins … in both orders »). Les commandes ne servent qu'au **stock** et aux preuves **tardives** : une
  publication déjà rattachée à sa propre offre n'en change pas à l'ingestion. Au premier RUN après livraison, une
  jumelle dont l'offre porte encore l'ancienne clé est manquée ; la consolidation la rattrape.
- **Maison** : après `attach-maisons`, un libellé déjà observé va à la Maison (alias relu par source, témoin « historical
  key ») ; une entité au **libellé jamais vu** crée une ligne à part, jusqu'au prochain aperçu relu. Le brancher sur la
  résolution contournerait la règle « on n'applique que ce qui a été relu » : défaut connu, plan ci-dessous.

## Rejouer les mesures (jamais entre 15:30 et 18:30 UTC)

```sh
DB='python3 apps/aggregator/scripts/ops/db.py readonly sh -c'
D=audits/2026-10-02/r143-dedoublonnage-maison
$DB 'psql "$DATABASE_URL" -X -A -t -q -f -' < $D/extraction-publications.sql > /tmp/r143/publications.jsonl
$DB 'psql "$DATABASE_URL" -X -A -t -q -f -' < $D/extraction-offres-servies.sql > /tmp/r143/servies.jsonl
$DB 'psql "$DATABASE_URL" -X -A -t -q -f -' < $D/extraction-employeurs.sql > /tmp/r143/employeurs.jsonl
$DB 'psql "$DATABASE_URL" -X -A -t -q -f -' < $D/extraction-echantillon-reparation.sql > /tmp/r143/echantillon.jsonl
$DB 'psql "$DATABASE_URL" -X -A -f -' < $D/mesure-volume-consolidation.sql
npx tsx $D/mesure-dedoublonnage.mts /tmp/r143/publications.jsonl /tmp/r143/servies.jsonl --echantillon=20 --fusions=/tmp/r143/fusions.jsonl
$D/contre-epreuve-job-invite.sh /tmp/r143/fusions.jsonl
python3 $D/mesure-second-etage.py /tmp/r143/publications.jsonl
python3 $D/mesure-offre-conservee.py /tmp/r143/publications.jsonl /tmp/r143/fusions.jsonl
npx tsx $D/mesure-reconstruction.mts /tmp/r143/echantillon.jsonl
npx tsx $D/mesure-maison.mts /tmp/r143/employeurs.jsonl
```

Les mesures appellent les fonctions du code (`blockingKey`, `publicationIdentityProof`, `provenPublicationGroup`,
`selectApplySource`, `recoverRetainedPublication`, `maisonPreview`) ; aucune preuve n'est réimplémentée.

## Résultats (base de production, lecture seule, 02/10/2026 entre 08:40 et 10:05 UTC)

### §4 — doublons servis (`resultat-mesure-dedoublonnage.txt`)

| | Avant | Après (à blanc) |
|---|---|---|
| Offres servies | 89 766 | 87 627 |
| Groupes « même Maison, même intitulé, même ville, sources différentes » | 2 734 | 1 011 |
| Offres en trop si ces groupes sont de vrais doublons | 3 594 | 1 137 |

| Motif | Fusions (toutes de 2 offres) |
|---|---|
| Réquisition SAP : portail LVMH ↔ site RMK Sephora | 1 884 |
| SmartRecruiters : publication citée par WTTJ | 148 |
| Teamtailor : fiche de l'enseigne hébergée par le site du groupe Etam | 107 |
| **Total** | **2 139** |

- Aucun groupe refusé, aucune identité prouvée sur deux employeurs.
- **Volume réel de `--apply`** (`resultat-volume-consolidation.txt`) : avec les clés déjà posées en production (Workday
  `requisition`, `application`, Teamtailor natif compris), **0 groupe** scindé aujourd'hui. Après le premier RUN de ce
  code, le volume est celui des nouvelles clés : 2 139 groupes.
- **Reconstruction** (`resultat-reconstruction.txt`) : 48 publications réelles de 24 fusions (8 par motif) sont toutes
  reconstruites par le lecteur de la réparation (`RECOVERABLE` 48/48).
- **Contre-épreuve native, motif SAP** (`resultat-contre-epreuve-job-invite.txt`) : pour chacune des 1 884 fusions, la
  redirection de l'éditeur `jobs.sephora.com/job-invite/<réquisition>/` mène à la publication RMK fusionnée :
  **1 884 OK, 0 KO**. La sonde préalable (`resultat-sonde-job-invite-80.txt`) donnait 80/80.
- **Relecture à la main** de 20 fusions, tirées par empreinte et réparties par motif (fin de
  `resultat-mesure-dedoublonnage.txt`) : même intitulé, même ville, même identifiant natif. **0 fausse fusion.**
- **Restent 1 011 groupes** (même fichier, « Doublons visibles restants ») : **703** LVMH + Sephora (publications RMK
  sans ligne « Job ID », hors États-Unis surtout), **305** WTTJ + employeur (Pandora 118, Groupe Rocher 41, ba&sh 30,
  Lacoste 25, Yse 23, American Vintage 21, Kiabi 14, …), 3 autres.

### Second étage déterministe : écarté (`resultat-second-etage.txt`)

Sur les 1 919 publications RMK qui déclarent leur réquisition, même Maison, même intitulé exact, même ville, même date
et même empreinte de description réunissent **3 paires de réquisitions différentes** (« Seasonal Associate » Boston
29/09 et Dallas 30/09, « Equipment Operator 1 » Las Vegas 20/09). Il fusionnerait de vrais recrutements.

### §5 — la Maison avant l'entité (`resultat-mesure-maison.md`)

282 entités rattachées à 41 Maisons (4 669 offres servies) ; une ligne Maison à créer (Puma, `kind = MAISON`, domaine
`puma.com` que portent ses entités). Aucune perte de secteur, de domaine ni de groupe pour les offres déplacées
(garde `MAISON_LACKS_*` : 0 entité). 35 des 282 entités sont sous une clé historique : leurs libellés deviennent des
alias relus. Plus grosse transaction : NIKE, 1 137 offres (fermées comprises).

| Maison | Entités | Offres sous le nom de la Maison, avant → après |
|---|---|---|
| NIKE | 40 | 390 → 875 |
| HUGO BOSS | 21 | 0 → 766 |
| Puma (à créer) | 43 | 0 → 635 |
| UNIQLO | 32 | 377 → 571 |
| Michael Kors | 21 | 326 → 510 |

**Écart avec le constat de D-513** (303 entités / 6 268 offres) : ce chiffre compte les entités servies dont le NOM porte
une forme juridique, quelle que soit leur Maison. Sur ces 303 : 209 rattachées (3 570 offres), 1 à part (9), et
**93 hors règle (2 689 offres)**, listées dans le même fichier : leur nom ne prolonge pas celui de la Maison du registre
(« VF Corporation » 882, « Reitmans (Canada) Ltée » 429 sous Penningtons, « United States of Aritzia Inc. » 314,
Swarovski préfixé d'un code, Movado, Condé Nast…). À l'inverse, 70 entités rattachées n'ont pas de forme juridique dans
le nom (« Ephemera Group », « Hans Anders Nederland »).

**Entités à part** : L'Occitane en Provence (17 offres ; la Maison du registre est un groupe) et Michael Kors (Italy)
(9 ; publiée aussi par la source Jimmy Choo). Il n'existe **pas** de file de revue : elles sont listées, avec leur motif,
dans le fichier d'aperçu de `attach-maisons` et dans `resultat-mesure-maison.md`.

## Défauts connus et suites

1. **703 LVMH + Sephora sans « Job ID »** : la redirection `job-invite` est une preuve native sûre, mais l'exploiter à
   l'ingestion demande ~2 900 requêtes par RUN et un périmètre d'accès relu pour la source `lvmh`. À instruire en lot.
2. **305 WTTJ + employeur** : aucun identifiant natif commun lu (Pandora, Rocher, Lacoste…) ; Teamtailor cité par WTTJ
   (Yse, Faguo, Cabaia) n'a pas l'UUID du flux : non rapproché.
3. **2 identifiants Blackstore / Intersport** (`09o0lmw2mvx4qmn3fa`, `9tbyegtsmmsdmgr9sl`) : même lien JobAffinity,
   preuve native présente, mais les deux publications sont attribuées à deux employeurs (Blackstore, Intersport) ; la
   fusion n'a lieu que sous un même employeur. Question d'identité d'employeur, hors de ce lot.
4. **93 entités hors règle** (2 689 offres, ci-dessus) : une seconde forme de preuve (code en tête de nom, raison
   sociale d'un groupe) relève d'une carte de décision.
5. **Entité au libellé jamais vu** : ligne à part jusqu'au prochain `attach-maisons` relu. Plan : aperçu après chaque
   RUN dans le rapport de santé, application hebdomadaire après relecture.
6. **Preuve lue dans un texte libre** : si une page RMK perd sa ligne « Job ID » après fusion, l'écriture de la paire
   échoue en nommant l'offre (`PUBLICATION_GROUP_REVIEW_REQUIRED job=…`), comme pour toute preuve native. La partition
   relue existante (`scripts/ops/publication-groups.mts`) la sépare ; témoin « loses its Job ID ».
7. **Offre conservée** : `selectApplySource` départage deux sources de même rang par la clé (`lvmh` avant
   `sephora-france`, `etam` avant `undiz`). Les 1 884 offres Sephora gardent le lien SAP du flux LVMH (deux redirections
   vers la page Sephora) et sa date : sur les 2 139 fusions, 581 portent une date d'au moins 7 jours plus ancienne que
   l'autre publication, 114 d'au moins 30 jours (`resultat-offre-conservee.txt`). Règle d'autorité inchangée ici (un
   autre lot tient `publications.ts`) : à arbitrer.
8. **Ville** : la fiche est reconstruite depuis la publication conservée ; 8 fusions perdent leur ville, 18 en changent
   (`resultat-offre-conservee.txt`).
9. **Noms affichés** : la Maison garde le nom de sa ligne (« NIKE », « UNIQLO », « Puma », « Laverana GmbH & Co. KG »,
   « alpha industries ») ; « Fast Retailing » (groupe non typé `GROUP`) reçoit une entité.
10. **Ligne Maison créée hors transaction** : si la fusion échoue ensuite, la ligne Puma reste, vide.

## Ordre de release (après GO du CEO)

1. Déployer le code ; laisser passer un RUN (les clés natives se posent à l'ingestion).
2. `consolidate-publications --output=…`, relire, `--apply --plan=…` ; cinq passages de 500, hors RUN.
3. `attach-maisons --output=…`, relire, `--apply --plan=…` depuis l'image déployée (son commit signe chaque correction),
   hors RUN : chaque Maison prend le verrou du catalogue des employeurs.
4. Remesurer avec les extractions de ce dossier.
