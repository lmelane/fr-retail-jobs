# Lot 1 — disponibilité prouvée et maintenance bornée

**Validé localement le 15 septembre 2026. Aucun déploiement ni rattrapage de production effectué.** Cette validation couvre le cycle de vie décrit ici ; elle ne certifie ni toutes les sources ni le produit complet.

## Résultat et décisions

- Une publication expire selon sa propre déclaration RAW. Le champ historique `Job.validThrough` ne sert pas de preuve pour ses représentations. La lecture publique exige une offre active, non fusionnée et au moins une publication active dont le délai n’est pas dépassé.
- Recherche SQL et Prisma, facettes, suggestions, fiches, offres similaires, sitemap, compteurs et snapshots courants partagent ce contrat. Le lien de candidature et la date présentée proviennent d’une publication encore disponible. Le repli public sur une offre sans représentation a été supprimé.
- Une date sans heure expire après la fin du jour dans tous les fuseaux (lendemain à 12:00 UTC). C’est une politique conservatrice explicite, sans fuseau employeur inventé. Une date native hors plage représentable, telle `9999-12-31`, reste conservée avec le statut `BEYOND_STORAGE_RANGE`, sans instant artificiel.
- L’ingestion conserve une échéance prouvée lorsqu’une capture partielle omet le champ. Une nouvelle échéance explicite peut la remplacer. Les retraits administratifs ne sont pas levés par une simple nouvelle lecture ; une publication explicitement redevenue publique peut lever son retrait de publication selon les preuves natives qualifiées.
- Une absence exige la dernière énumération complète, récente, corrélée au même cycle et portant les identifiants de publication. Une source cassée, tronquée, une preuve ancienne, un échec sans identifiant ou une preuve contradictoire n’autorise aucune fermeture pour absence. Une énumération explicitement vide peut faire preuve ; le silence ne le peut pas.
- Prévisualisation et écriture utilisent le même planificateur. Sources et identifiants autorisés se cumulent ; une liste vide n’autorise aucune mutation. La garde de fermeture porte sur le catalogue du périmètre autorisé : au moins 50 retraits/fermetures prévus et plus de 5 % de ce périmètre entraîne un refus.
- Le manifeste fige chaque représentation, la preuve, l’état avant opération, sa conséquence et les limites. Il est archivé en base de manière immuable ; le worker reçoit seulement son empreinte. L’opération figée désactive les représentations nommées et traite leurs conséquences ; elle ne retire ni ne rouvre d’autres offres.
- Sous verrou, toute nouvelle attestation, modification d’état ou preuve différente entraîne un saut motivé. Les mutations et leur journal immuable sont transactionnels. Une reprise ne répète ni changement ni événement.

## Reprise des échéances

La commande maintenue [source-expiry.mts](../../apps/aggregator/scripts/ops/source-expiry.mts) prépare des pages bornées depuis le RAW existant. L’application revérifie empreinte, lecteur, source, identité, employeur, dernière observation et valeurs précédentes avant toute écriture de la page. Elle conserve le RAW dans les observations et écrit le journal avant/après. Une dérive annule la page ; sa répétition après succès écrit zéro ligne.

Le scan hors ligne a porté sur **85 327 représentations du snapshot privé** : **5 259 valeurs d’échéance reconnues**, dont **5 106 instants représentables**, **153 valeurs hors plage** et **257 échéances dépassées** à l’instant de mesure. Ce sont des représentations, pas nécessairement autant d’offres distinctes. Les champs non collectés ou non interprétés ne sont pas comptés comme absence de date chez l’employeur.

Une répétition locale de **42 publications RAW issues de 11 familles de sources** a écrit 42 preuves en deux pages. Deuxième passage : zéro écriture. La projection publique a conservé les 24 publications attendues ; la maintenance a fermé les 18 expirées. Répétition de la maintenance : zéro changement. Le journal retrouve les 18 identifiants attendus, sans manquant ni opération supplémentaire. Les RAW complets restent privés.

## Validation et audit défensif

| Contrôle | Résultat |
|---|---:|
| Migrations sur PostgreSQL 18 neuf, image figée | 46 appliquées |
| Tests unitaires agrégateur | 2 224 réussis |
| Tests d’intégration agrégateur | 436 réussis |
| Tests API | 245 réussis ; 2 tests de corpus séparés |
| Tests Python des outils Railway | 5 réussis |
| Types agrégateur, scripts et API | Valides |
| Build API dans le checkout isolé | Réussi |
| Archivage du RAW pendant le rattrapage | Suite ciblée de 6 tests réussie |
| Contre-épreuves | 4 rouges attendus, puis restauration verte |

Les contre-épreuves réintroduisent séparément : absence de borne de sources, omission du délai dans le SQL public, choix d’un lien expiré pendant ingestion, acceptation d’une nouvelle preuve après gel du manifeste. Elles ont toutes échoué sur le comportement attendu, puis repassé après restauration exacte des fichiers. Les tests de concurrence, réattestation, périmètre vide, dérive de preuve, reprise et immutabilité complètent ces témoins.

[Résultats et empreintes](preuves/lot1-validation.json), [contre-épreuves](preuves/lot1-counterproofs.json), [mesures RAW](preuves/lot1-expiry-corpus.json), [répétition et parité](preuves/lot1-replay.json).

Le run complet précède les derniers contrôles ciblés : l’archivage RAW du rattrapage, le refus d’une limite contradictoire et le compte rendu de prévisualisation ont été revérifiés par leurs suites concernées, le typecheck complet et le build. Le checkout de vérification est séparé du serveur local existant. Aucune base réelle n’a reçu de fixtures de test.

## Chemins remplacés

Suppression de `dedup/canonical.ts` au profit du choix explicite de publication de candidature dans `packages/db/publications.ts`. Suppression de `closureRatioPolicy.ts` et de son test, `freeze-manifest.mts`, `refresh-parity.mts` et `lifecycle-scenarios.mts` : le planificateur, le manifeste immuable, les tests maintenus et l’audit transactionnel les remplacent. Le champ de résultat trompeur `skippedBrokenSources` devient `unverifiableSources` chez tous ses consommateurs actifs. Les archives datées qui citent ces anciens chemins sont signalées comme historiques.

## Limites explicites et suite

- **Pas de nouvelle collecte ni d’écriture de production dans ce lot.** Le rattrapage de production attend la release cohérente et son périmètre de données préparé ; le correctif ne signifie pas que le stock distant a déjà changé.
- Le stock historique reste partiellement privé de réponses natives complètes. Le lot 2 traite la capture avant parsing et la rétention ; le lot 3 traite les autres faits natifs. Une donnée non conservée n’est pas reconstruite par supposition.
- Une source non vérifiable ne produit pas une fermeture employeur. Les offres sans aucune représentation active sont retirées avec `ATTESTATION_MISSING`. Aucune durée universelle de vieillissement du stock encore attesté n’a été ajoutée ; les règles par source et les preuves de renouvellement relèvent du lot 5.
- La comparaison d’identifiants bloque notamment un changement total d’espace d’identifiants ; un chevauchement ne certifie pas à lui seul leur stabilité. La qualification des collecteurs et de leurs versions reste nécessaire.
- Les rapprochements hérités, le cloisonnement complet par pays, les offres directes et la charge à grande échelle restent dans leurs lots respectifs. Les snapshots historiques conservent leurs limites de reconstruction ; seul le snapshot courant applique ce nouveau contrat temporel.
- CRON, matching et nouvelle promesse de `/offres` restent hors de la phase en cours. Website, backend et media n’ont pas été modifiés dans ce lot.
