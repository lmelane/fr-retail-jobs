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
