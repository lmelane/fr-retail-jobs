# Lot 4F2 — Identité des détails Workday

**Validé localement : 1 425 présentations supplémentaires reconstructibles et 159 échéances prouvées reprises sur la copie du catalogue. Aucun changement de production.**

## Relation native vérifiée

Deux portails Workday exposent une URL de détail dont le segment de site diffère par sa casse : `Richemont` → `richemont` et `eu_Theory` → `EU_Theory`. Dix réponses natives, comprenant listes, JSON de détail et pages publiques de quatre offres, ont été capturées. Les pages déclarent respectivement `siteId: "Richemont"` et `siteId: "eu_Theory"`. Le rejeu exact hors réseau retrouve les mêmes réponses interprétées. [Captures de qualification](preuves/lot-4f2-native.json).

La règle retenue est propre à la route Workday : origine identique, identifiant natif identique et chemin d’offre exact. Seul le segment ASCII du site peut changer de casse sur les hôtes `tenant.wdN.myworkdayjobs.com`. Un autre tenant, une autre ville ou casse dans le chemin de l’offre, un autre identifiant, un chemin ambigu, des credentials, un port inhabituel ou des paramètres ajoutés sont refusés. Sur un domaine personnalisé, les URLs doivent être égales. Cette décision n’établit pas une équivalence générale des URLs. Les quatre publications natives sont reconstructibles avec le lecteur corrigé. [Rejeu des publications](preuves/lot-4f2-native-replay.json).

La même qualification a capturé quatre réponses du [hub URBN](https://hub-urbn.icims.com/jobs/search?ss=1&in_iframe=1&pr=0). La première page porte des liens vers cinq origines de détail iCIMS ; trois détails ont été vérifiés. Cette observation prépare une preuve de relation listing/détail. Elle n’autorise pas la reprise automatique des anciennes pages URBN ni tous les hôtes iCIMS.

## Un contrôle partagé avec la collecte

Le lecteur de reprise utilisait une égalité intégrale d’URL trop stricte pour ces deux portails ; la collecte ajoutait au contraire les champs du détail sans en vérifier l’URL. Le même contrôle sert désormais aux deux chemins. Un détail incohérent reste archivé avec une retenue `WORKDAY_DETAIL_IDENTITY_MISMATCH`, sans ajout de ses champs au listing.

Une ancienne fixture Tapestry associait le listing `JR14730` au détail `JR14637`. Elle utilise maintenant le chemin réellement présent dans le détail conservé. Les fixtures synthétiques portent désormais des identifiants et URLs cohérents ; aucun payload natif n’a été réécrit pour faire passer un test.

## Stock complet et reprise bornée

Les **90 764 représentations** ont été relues hors réseau. Le stock passe de **52 189 à 53 614 présentations reconstructibles**, dont **51 553 actives**. Les seuls changements sont les 1 407 lignes Richemont et 18 lignes Theory précédemment refusées pour l’URL. Aucune représentation déjà reconstructible ne perd ce statut. Les groupes dont tous les membres sont reconstructibles passent à 51 661, dont 50 557 actifs ; leur déduplication reste à valider. [Inventaire complet](preuves/lot-4f2-stock-inventory.json).

La prévisualisation d’échéances parcourt 90 323 lignes connues : **159 nouveaux changements et 3 051 examens**. Les nouvelles lignes sont reprises par des plans exacts sans examen, puis rejouées sans réécriture. RAW, identités, contenus `Job` et dates d’attestation sont inchangés. Le cumul local atteint **3 098 échéances prouvées** ; les 3 051 autres restent bloquées. [Preview](preuves/lot-4f2-expiry-preview.json), [application](preuves/lot-4f2-stock-apply.json), [avant](preuves/lot-4f2-before-apply.json), [après](preuves/lot-4f2-after-apply.json), [contrôle final](preuves/lot-4f2-after-expiry-preview.json).

## Validation et conservation

- **3 087 tests passent** : 2 317 unitaires, 511 d’intégration, 254 API et 5 Python ; deux tests API optionnels ignorés. Typage et build API passent.
- **Six contre-épreuves** rendent les tests rouges : contrôle de collecte retiré, casse étendue au chemin entier, casse autorisée sur tout hôte, relation native de casse refusée, identifiant non vérifié et tenant non vérifié. La version restaurée passe. [Contre-épreuves](preuves/lot-4f2-counterproofs.json).
- Les captures sont conservées dans une sauvegarde privée de validation dont le catalogue d’archive est vérifié. Elle ne contient pas la base de production. [Archive](preuves/lot-4f2-native-backup.json).
- Les lectures Prisma d’audit imposent le mode lecture seule dans les options de connexion et vérifient sa valeur effective. La variable `PGOPTIONS` seule n’est pas utilisée comme garantie.

[Validation et empreintes](preuves/lot-4f2-validation.json). [Préservation du travail initial](preuves/lot-4f2-preservation.json).

Le lot 4 reste ouvert. Les présentations et regroupements n’ont pas encore été repris ; iCIMS et les autres formats non qualifiés restent à traiter. Les observations natives de ce lot ne réattestent pas les publications historiques du catalogue.
