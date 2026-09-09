# Harri, Ashby et séparation d’un homonyme — validation du 9 septembre 2026

## État avant et causes prouvées

- Saltrock : le catalogue associait `saltrock.jobs.personio.de` à l’entreprise `SALTROCK`, domaine `saltrock.com`. Cinq offres historiques, dont trois actives, portaient cette attribution.
- Le [site allemand SaltRock](https://www.saltrock.de/karriere) renvoie explicitement vers ce Personio. Les offres natives nomment SaltRock GmbH. Le [site britannique Saltrock](https://www.saltrock.com/pages/careers) renvoie explicitement vers [Harri Saltrock-Careers](https://harri.com/Saltrock-Careers). Il s’agit de deux employeurs distincts.
- La simplification historique `SaltRock GmbH → SALTROCK` ne constitue pas une preuve d’identité. Le plan de correction ne disposait pas d’un espace d’identité distinct permettant de représenter ce cas.
- Harri n’avait pas d’adaptateur. Son client public utilise `start`, et non `from`, pour paginer. L’essai réel avec `from` répétait les mêmes dix identifiants. `start=0,10,20` restitue les 30 identifiants distincts, identiques à la réponse native complète.
- Ashby était une liste sans preuve d’énumération et excluait silencieusement `isListed=false`. Selon la [documentation native Ashby](https://developers.ashbyhq.com/docs/public-job-posting-api), ces offres sont accessibles par lien direct mais ne doivent pas être affichées sur un job board. Cela ne prouve pas leur clôture chez l’employeur.

## Correction universelle

- Adaptateur Harri : identité du portail vérifiée par son API native, pagination sans restriction géographique, comparaison des compteurs et identifiants, détails publics, dates natives, conservation du magasin dans RAW. Les anomalies rendent l’énumération explicitement incomplète.
- Le rattachement des magasins au propriétaire du portail est une configuration revue (`PORTAL_OWNER`), pas une règle sur les mots Saltrock ou Exeter. Le mode par défaut conserve l’employeur natif de l’offre.
- Ashby : contrat de réponse vérifié, lignes invalides documentées, preuve d’énumération, retrait de catalogue explicite pour les annonces non listées. Aucun faux événement CLOSED/REOPENED.
- Une ligne rejetée interdit désormais à tout adaptateur d’annoncer une exécution complète.
- Plan d’identité : espace `OFFICIAL_DOMAIN` explicitement revu, utilisant domaine officiel et libellé complet ; aucun rapprochement automatique par domaine seul. Les alias revus et propres à la source alimentent le résolveur existant.
- Une source découverte est enregistrée DRAFT par une fonction commune. Un rejeu ne modifie pas sa configuration ni ne réactive une source retirée. L’identité et la validation native restent exigées avant promotion.

## Preuves locales sur données réelles

- Harri Saltrock : 30/30 offres ; description, titre, URL, localisation, pays, employeur et date native renseignés pour les 30. Le contrôle de deux pages artificielles reste un test de protocole ; les métriques ici proviennent du portail réel, sans test de charge.
- Identifiants natifs, SHA-256 trié : `67e6830ef35e4e5ed244d14fb72d3273b153543f389cfd555bf61264d7b101f2`.
- Copie de production : cinq attributions corrigées, trois retraits administratifs, deux états inactifs antérieurs conservés. Aucun identifiant ni RAW supprimé. Rejeu : zéro écriture.
- Ingestion Harri sur copie : 30 créations, zéro fusion, zéro erreur, zéro offre perdue. Rejeu : zéro nouvelle offre et zéro perte. Métier : 24 CLASSIFIED et 6 FAMILY_ONLY ; les six restent visibles.
- Ashby Polène : 79/79 offres natives, toutes listées et datées. Les quatre annonces stockées absentes du relevé ne sont pas automatiquement qualifiées de clôturées.
- Tests avant livraison : 1 563 unitaires ; 246 d’intégration, typecheck réussi. Les tests d’intégration utilisent une base dédiée, jamais la production.

## Limites et statut

Ce document décrit d’abord le correctif et sa validation locale. Il ne constitue pas une preuve de déploiement ou de réparation de production ; celles-ci sont consignées séparément après exécution.

KENT : le portail Personio est explicitement lié par [KENT Europe](https://www.kenteurope.com/karriere/bewerben/). [Kent Brushes](https://kentbrushes.com/pages/careers) dispose d’une page distincte. Le dossier n’établit pas encore quelle entité le libellé historique KENT était censé représenter : ses 13 offres ne sont donc pas comptées comme 13 erreurs prouvées ni corrigées par analogie.

Le parcours d’énumération complet d’un portail ne prouve ni tous les portails mondiaux du groupe ni toute la couverture sectorielle. Les localisations secondaires et la qualification des autres sources restent au chantier LOT 4.

## Preuve de production — 14 h 22 UTC

[PR 51](https://github.com/lmelane/fr-retail-jobs/pull/51), code `9fac7d1`, fusion `aa2d819`. Les quatre services Railway sont SUCCESS sur cette fusion. Le service agrégateur est revenu à sa commande normale ; les trois traitements planifiés restent en pause pendant la qualification globale.

- Plan d’identité de production : `24841f7ca4a879834583f8f62cfe09f1d8cb185caf6f7d0b663e29a89be46bc7`. Douze corrections documentées couvrent une identité distincte, une source, cinq représentations et cinq offres. Rejeu : zéro écriture.
- Cinq offres réattribuées, dont trois retirées ; les deux clôtures historiques sont conservées. Tous les identifiants, RAW et événements antérieurs sont conservés.
- Harri : 30 offres créées par le run Railway `99470610-1006-4315-ad3d-37cf7c2809c8`, zéro erreur. Une nouvelle source activée après preuve officielle et alias revu ; Saltrock existait déjà, ce n’est pas une nouvelle marque découverte.
- Production : **77 390 offres historiques, 74 159 actives, 10 952 actives en France**. Delta de ce sous-lot : +30 créations et −3 retraits ; aucune suppression.
- [Filtre Saltrock](https://modecareers.com/emplois?maison=Saltrock) : **30 en base = 30 à l’API = 30 au compteur front**. Les deux pages API (25 + 5) exposent exactement les identifiants attendus. Royaume-Uni : 30 ; France : 0 ; secteur Mode : 30.
- Page retirée : HTTP 410, noindex, bannière de retrait et aucun JobPosting Google.
- Journal Railway : 13 lignes, maximum 6/seconde, zéro avertissement de messages supprimés ; 11 événements durables et zéro échec de persistance.

Preuves structurées : [harri-production-proof.json](harri-production-proof.json). Ashby est déployé et sa lecture native est prouvée ; aucun rejeu applicatif de Polène en production n’est revendiqué dans ce sous-lot.
