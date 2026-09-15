# Lot 4H2 — publications indépendantes et quarantaine des preuves

**16 septembre 2026 — validation et répétition locales. Aucune écriture de production.**

## Décision et périmètre

Une publication native existe indépendamment de sa présentation publique. L'obligation historique `JobSource.jobId NOT NULL` imposait de conserver une association non prouvée, de copier un autre contenu ou d'inventer une Job pour séparer un membre incomplet. Le lien devient facultatif ; une publication détachée conserve un motif et une date de quarantaine. Son identité native, son RAW, ses captures et ses observations ne sont pas supprimés.

Le contrôle porte sur les **294 groupes mixtes** restants après 4H1, chacun composé de deux publications. Les historiques retenus sont examinés avant de décider : les 27 JSON-LD FashionJobs encore complets restent lisibles comme preuves historiques, mais leur lecteur n'est pas qualifié et la source reste retirée ; les hits WTTJ conservés ne sont pas présentés comme des descriptions complètes. Les résumés, profils, annotations d'erreur et RAW absents ne sont pas remplacés par le texte de leur voisin.

La réparation s'applique à **293 groupes**. Le dernier groupe, `cmtt7waed07ppmy01bwifnt2z`, conserve son état et reste en revue : son ancienne URL publique dépend de l'entrée SuccessFactors `1367552955`, alors que le membre LVMH utilise `295261`. Le RAW conservé ne prouve pas leur équivalence. Le même titre ne suffit pas. Ce cas demande le traitement explicite d'une ancienne fiche dont le propriétaire n'est plus qualifiable ; il n'est ni supprimé ni réaffecté silencieusement.

## Contrats implémentés

- Migration 56 : groupe facultatif, état de quarantaine cohérent, suppression en cascade d'une publication interdite lors de la suppression d'une Job.
- Plan de répartition version 4 : partition exhaustive entre présentations et `quarantineSourceIds`, bornes inchangées, motif calculé par le lecteur courant, refus de mettre en quarantaine une publication reconstructible.
- L'ancien ID public garde une publication qualifiée correspondant à son identité sélectionnée ou à son URL de candidature. Sans cet ancrage, le plan refuse la modification.
- Décisions immuables `QUARANTINED` / `RELEASED`, liées à la transaction ; modification isolée des métadonnées de quarantaine interdite. Aucune fausse fermeture employeur.
- Réintégration : capture native postérieure à la quarantaine, configuration/type/lecteur concordants, aucune retenue, RAW reconstructible et employeur résolu. L'ID de publication et la première observation restent conservés. Le regroupement est recalculé sur preuve native.
- Faits et échéances : relecture possible sans Job, aucune projection vers un faux parent.
- Refresh version 3 : preuves d'absence ou d'échéance et journal de publication pour les membres détachés. Une réintégration invalide un ancien manifeste. Le retrait d'une source couvre aussi ses publications en quarantaine.

Les consommateurs nullable et les nettoyages de bases de test sont adaptés. Les scripts `p9-repair-locale-urls.mts`, `p9-repair-descriptions.mts` et `p9-idempotence.mts` sont supprimés : écritures directes non capturées ou déduction de fermeture à partir de l'état courant. Leur audit historique indique les parcours qui les remplacent.

## Validation défensive

**3 195 tests réussis** : 2 389 unitaires, 547 d'intégration, 254 API, 5 Python. Deux tests API optionnels de corpus réel restent séparés. Les 56 migrations depuis une base vierge, les types et le build API passent.

Les 15 tests ciblés de quarantaine couvrent conservation native, partition complète, motif, refus de réaffectation d'URL publique, rollback sur état changé, contraintes SQL, réintégration dans un groupe prouvé ou une fiche distincte, captures anciennes/incomplètes/retenues, faits, échéances, absence prouvée, nouvelle preuve après prévisualisation, retrait et manifeste devenu périmé après réintégration.

Sept contre-épreuves retirent les protections relatives à l'ancien ID public, au contenu reconstructible, à l'âge de la capture, à une retenue capturée, à la conservation de l'activité native, à l'état prévisualisé et au refresh après réintégration. Toutes font échouer les assertions ; après restauration, les tests repassent.

## Répétition sur le stock complet

Sauvegarde préalable : **1 130 791 782 octets**, catalogue d'archive vérifié, SHA-256 `92ec0fd39d4c0bc157054d4e261de8ad67f6eeea4ca2390a3975b67cbacb10d3`. La migration est appliquée uniquement au clone local. Les plans détaillés et RAW restent dans les sauvegardes privées hors Git.

| Résultat | Mesure |
|---|---:|
| Plans appliqués et rejoués sans réécriture | 293 |
| Groupes reconstruits / présentations propres | 293 / 293 |
| Publications conservées en quarantaine | 293 |
| Motifs : lecteur non qualifié / RAW absent / détail inutilisable | 152 / 140 / 1 |
| Nouvelles Job / redirections / fermetures / retraits | 0 / 0 / 0 / 0 |
| Décisions de détachement immuables | 293 |
| Groupe restant en revue d'ancrage public | 1 |

Les empreintes SQL confirment : RAW et champs natifs inchangés ; observations, captures, premières/dernières observations et activité source conservées ; identité, état de disponibilité et redirections de toutes les Job conservés ; toutes les Job et publications hors périmètre inchangées. Les plans, caches, faits, miroirs RAW et décisions sont relus après application.

Neuf anciennes projections `FR` deviennent absentes : les neuf `addressCountry` de la publication native sélectionnée sont effectivement vides. Le pays de l'autre publication n'est pas emprunté. Neuf propriétaires auparavant non désignés sont explicités sans changement d'URL de candidature. Aucun employeur n'est changé.

Le clone compte **87 606 Job, 90 764 publications, 55 124 présentations reconstruites, 53 270 groupes entièrement reconstruits, 293 publications en quarantaine et 278 redirections**. Les 53 063 publications portant à la fois le flag actif et une présentation ne constituent pas un nombre d'offres actuellement disponibles.

## Limites et suite

La quarantaine n'est ni une certification du collecteur ni une preuve de fermeture. Elle conserve les preuves et rend l'absence de qualification explicite. Une source retirée n'est pas réactivée. Les formats encore non qualifiés, le dernier ancrage public, le pipeline unique de certification et les lots produit restent à terminer. Le schéma et les plans anciens restent dans les migrations et journaux ; aucune compatibilité silencieuse avec les anciens manifests n'est ajoutée.

Ce lot ne constitue pas une autorisation de release : agrégateur, API et autres projets restent non déployés, et les crons restent gelés.

## Preuves

- [Validation et révisions](preuves/lot-4h2-validation.json)
- [Contre-épreuves](preuves/lot-4h2-counterproofs.json)
- [Périmètre initial](preuves/lot-4h2-pending-scope.json) et [historiques](preuves/lot-4h2-observations.json)
- [Prévisualisation](preuves/lot-4h2-preview.json) et [pays natifs](preuves/lot-4h2-geography-proof.json)
- [Application et répétition](preuves/lot-4h2-stock-apply.json), [vérification](preuves/lot-4h2-stock-verification.json), [bilan](preuves/lot-4h2-stock-balance.json)
- [Sauvegarde](preuves/lot-4h2-backup.json), [migration du clone](preuves/lot-4h2-migrate-clone.json), [préservation des travaux existants](preuves/lot-4h2-preservation.json)
