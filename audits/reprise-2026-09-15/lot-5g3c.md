# Lot 5G3C — fin d’ingestion immuable et preuves d’absence liées aux captures admises

**16 septembre 2026. Validé localement, schéma 70. Aucun push, déploiement, changement de production ou activation du CRON.** Le périmètre de ce lot est la preuve d’absence et les chemins de fermeture ; le produit entier n’est pas déclaré prêt à déployer, et aucune source du stock n’est certifiée par ce lot.

## Défaut mesuré avant le lot

Le [relevé en lecture seule du clone](preuves/lot-5g3c-absence-inventory-clone.json), pris avec `default_transaction_read_only=on` et un refus d’écriture prouvé, établit ce que les fermetures lisaient réellement :

| Fait | Valeur |
|---|---:|
| Lignes `SourceRun` sans `runId`, donc non corrélables à une preuve | 7 257 / 7 551 |
| Sources dont le dernier run porte `canAttestAbsence` | 216 / 539 |
| Événements `source.enumeration_observed` avec identifiants canoniques | 81 / 285 |
| Offres actives `pipelineVersion < 7` exposées à la purge de génération | 0 |
| Captures natives, admissions et validations sur le stock | 0 |

Le refresh dérivait l’absence d’un historique de santé élagué à dix jours et d’un journal de diagnostic corrélé par `runId`. La purge de génération fermait en `CLOSED` — sémantique de fermeture employeur — toute offre non réécrite par la génération courante, sur des statistiques en mémoire ; inerte aujourd’hui, elle aurait fermé en masse sans preuve à la première hausse de `PIPELINE_VERSION`. Enfin `bounded-refresh-command.py` exigeait un manifeste version 2 alors que le planificateur produisait la version 3 depuis le lot 1 : la chaîne de refresh borné refusait tout manifeste réel, et son test unitaire validait ce refus.

## Résultat

Chaque collecte admise se termine par `SourceIngestionCompletion` (migration 70) : une ligne immuable liée au batch et à un rapport haché conservé comme bloc RAW, qui nomme le devenir de chaque sortie scellée non publiée — retenue, refus d’écriture (classe d’erreur seulement), écartée par le filtre sectoriel. SQL refuse ce rapport pour une sonde de qualification, une capture sans résultat EXTRACTED et des compteurs qui laissent une sortie sans devenir ; la ligne prend le verrou partagé de la source et ne peut être ni modifiée ni supprimée. Une interruption avant ce rapport laisse une collecte sans preuve d’absence.

Le refresh lit désormais, pour chaque source, sa capture attestante (`pipeline/attestingCapture.ts`) : la dernière tentative d’offres de la révision courante par ordre SQL, admise, scellée avec son manifeste, achevée par sa fin d’ingestion, et qui passe encore la porte de publication `requireCurrentCaptureRevision`. Une source non ACTIVE, une révision changée, un accès révoqué, une identité remplacée, une qualification périmée ou une tentative plus récente retirent le droit d’attester, en prévisualisation comme sous les verrous d’écriture. Les faits d’attestation sont dérivés du manifeste scellé et du rapport de fin d’ingestion ; une première collecte n’a pas de passé et n’atteste rien ; un zéro déclaré et parcouru atteste ; toute disposition doit porter sur un identifiant observé et tout identifiant observé doit avoir un devenir connu. Une preuve scellée illisible, y compris une archive froide indisponible, ne provoque aucun repli.

Le manifeste de refresh passe en version 4 et nomme la capture attestante de chaque preuve ; les versions antérieures restent de l’historique et ne peuvent plus être appliquées. Le journal `DataCorrection` conserve la cause racine d’une omission : une preuve changée n’est plus recouverte par le changement de conséquence qu’elle entraîne. `SourceRun` et `PipelineEvent` ne décident plus rien ; l’événement `source.enumeration_observed` ne porte plus la preuve mais une enveloppe bornée référençant la capture.

L’adaptateur Ashby déclare son contrat d’identifiants canoniques et signale les lignes anonymes ; ses rejets nommés gardent leur identifiant. Trois autres familles seulement le déclaraient (Workday, TalentRecruiter, DigitalRecruiters) ; les 40 autres restent non vérifiables pour l’absence.

## Chemins supprimés

- `pipeline/purge.ts` et son test : la purge de génération et son appel après chaque source dans `ingest.ts`. `PIPELINE_VERSION` reste une provenance d’écriture.
- `deactivateAdministrativeSources` et sa disposition `CLOSED` administrative : `withdrawRetiredSource` ne connaît plus que le retrait `SOURCE_RETIRED`, le périmètre `jobWhere` disparaît avec son seul appelant.
- `test/sourceEvidence.ts`, le témoin qui fabriquait `SourceRun` et `PipelineEvent` : remplacé par `test/ingestionFixture.ts`, qui fait tourner l’ingestion de production sur un flux natif synthétique.
- `scripts/ops/absent-ids.mts` et `h1-contract.mts`, lecteurs du journal remplacé ; `cycle-contracts.mts` est re-fondé sur la capture attestante, `refresh-preview.mts` expose `captureBatchId`.

## Validation et audit défensif

La [validation complète](preuves/lot-5g3c-validation.json) sur base neuve compte **3 639 tests réussis** : 2 585 unitaires, 780 d’intégration, 259 API et 15 Python. Deux tests API optionnels restent ignorés. Types et build API passent. Les [70 migrations depuis une base neuve](preuves/lot-5g3c-fresh-migrations.json) sont appliquées.

Les 780 tests d’intégration comprennent 20 nouveaux scénarios sur le chemin réel — ingestion de production, admission SQL, capture, validation, écrivains, fin d’ingestion, planificateur, verrous et journal — avec pour seul élément synthétique le transport HTTP amont : absence prouvée puis fermée avec capture nommée dans le manifeste et le journal ; omission sûre après révocation d’accès, mise en pause, identité remplacée, tentative plus récente et qualification périmée pendant l’attente des verrous ; flux composé uniquement de retenues rejeté par la validation ; refus d’écriture réel (`EmployerIdentityReviewRequired`) retirant le droit d’attester sans confondre l’offre refusée avec une absence ; lecture de la preuve depuis l’archive froide et refus sans archive ; source retirée ; réouverture après fermeture prouvée ; fin d’ingestion refusée pour une sonde, pour des compteurs incomplets, en réécriture et en suppression, idempotente pour un rapport identique.

Les [16 contre-épreuves](preuves/lot-5g3c-counterproofs.json), 13 applicatives et trois SQL, sont toutes détectées : porte de publication sautée, source en pause attestante, fin d’ingestion manquante acceptée, première collecte attestante, échecs d’écriture ignorés, preuve illisible propagée, ancienne version de manifeste acceptée, fin d’ingestion non enregistrée, refus d’écriture caché, devenir étranger accepté, ligne crue au lieu de son rapport, contrat canonique Ashby retiré, omission de preuve recouverte, déclencheur SQL de liaison désactivé deux fois, déclencheur d’immutabilité désactivé. **79 tests repassent après restauration exacte du code et des gardes.**

Les [283 fichiers du runtime](preuves/lot-5g3c-runtime-match.json) sont identiques entre le répertoire de travail et la copie exécutée :

`local-sha256:96f1fb000735f51f68d7262c5e1b7b51f816e4d159925e4bcc3c91788422e388`

Cette empreinte inclut les travaux utilisateur conservés localement ; elle ne certifie pas une image de release construite depuis le seul commit Git.

## Stock et préservation

La [répétition 69 → 70](preuves/lot-5g3c-stock-migration.json) sur le clone isolé conserve exactement comptes et empreintes des sept tables contrôlées : 87 607 offres, 90 764 représentations, 141 933 observations, 536 sources, 536 révisions, 112 revues d’identité et 224 décisions de périmètre. La table de fin d’ingestion est vide et ses deux déclencheurs actifs ; aucune capture, admission, fin d’ingestion ou activation n’est fabriquée. La sauvegarde complète du schéma 60 reste disponible ; sa reprise exige désormais les migrations 61 à 70 et la restauration complète n’est pas répétée dans ce lot.

Le [contrôle des fichiers utilisateur](preuves/lot-5g3c-preservation.json) conserve 82 des 86 fichiers initiaux exactement, les quatre exceptions déjà documentées et les 83 configurations originales. Les trois fichiers utilisateur modifiés et les 25 fichiers non suivis initiaux restent hors commit, inchangés depuis le début du lot ; la passation du 16 septembre reste non suivie. Les autres dépôts ne changent pas.

## Limites et suite

Sur le stock actuel, aucune source n’a de capture attestante : aucune fermeture par absence n’est possible avant la re-qualification et la ré-ingestion admise de chaque source, et les familles sans contrat canonique resteront non vérifiables même ingérées. Le protocole de zéro natif n’est qualifié que pour Ashby. Un flux composé uniquement de retenues reste rejeté par la validation technique (`NO_QUALIFIED_PUBLICATION`) : il ne prouve ni ne ferme rien, ce qui est le comportement sûr mais laisse ces sources sans fermeture possible. La première collecte d’une source n’atteste jamais. La publication d’un flux n’est pas atomique, mais la fin d’ingestion la borne : ce qui n’est pas publié est nommé, et sans ce rapport rien n’est prouvé.

`SourceRun` et ses colonnes `complete`/`canAttestAbsence` restent écrits par la santé et lus par les rapports d’exploitation et plusieurs scripts datés de `scripts/coverage` et `scripts/ops` (`cycle-sets`, `cycle-resources`, `ingest-facts`, `p9-*`, `attestation-replay`, `p6-register`) ; ils décrivent une époque et ne décident rien. Leur retrait appartient au lot 12 avec l’inventaire des scripts sans appelant. Les audits historiques datés sont conservés comme preuves ; les documents de fonctionnement courants renvoient au [contrat d’ingestion](../../docs/architecture/source-ingestion.md).

Prochaine étape exécutée : lot 6, recherche commune bornée par pays.
