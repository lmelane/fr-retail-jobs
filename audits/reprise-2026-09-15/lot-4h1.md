# Lot 4H1 — iCIMS : périmètre régional et identité native

## Problème et décision

Le hub iCIMS et les sites régionaux publient les mêmes fiches sous leurs URLs natives. Le lecteur historique exigeait que la page de détail reste sur le domaine du listing : il refusait 1 511 publications URBN pourtant liées à leur propre page et à leur identifiant. Parmi elles, 932 empêchaient la reconstruction d'un groupe contenant aussi une publication de l'ancien flux régional retiré.

Le périmètre régional est désormais une liste explicite `detailOrigins` dans la configuration de la source. Il n'est jamais déduit du nom de domaine ou du groupe de marques. L'identité d'une offre reste l'origine **régionale exacte** et son identifiant numérique natif ; deux régions partageant un numéro ne deviennent pas le même recrutement. Cette règle ne nécessite aucune modification des identifiants ou des URLs conservés.

## Preuve native

La [capture et son rejeu](preuves/lot-4h1-native.json) comprennent 30 pages de listing, 1 486 liens et une fiche pour chacun des sept sites régionaux. Les 37 réponses, soit 4 500 046 octets, sont rejouées hors réseau à l'identique. Le lecteur courant accepte les sept fiches archivées ; le stockage Railway isolé et les empreintes sont [vérifiés](preuves/lot-4h1-native-archive.json).

Cette capture de qualification n'est pas une réattestation du stock historique. Elle n'autorise aucune fermeture par absence et n'a pas collecté les 1 486 détails. Les URLs des exemples restent des références publiques ; les corps natifs complets sont dans l'archive privée.

## Contrôles partagés

- Source `icims`, page retenue, identifiant de la ligne et de l'URL concordants ; référence native `année-identifiant` concordante lorsqu'elle existe.
- Une seule déclaration `JobPosting`, empreinte HTML structurée et géographie sans conflit.
- HTTPS natif, sans identifiants de connexion, port non standard, fragment, traversée ou séparateur encodé. Les paramètres qualifiés `hub` et `in_iframe` ne changent pas l'identité.
- Pour rapprocher deux flux, le `JobPosting` doit déclarer sa propre URL, sur la même origine, le même chemin et le même identifiant que sa page.
- Pour reconstruire une publication ou collecter un détail, son origine doit appartenir au périmètre exact configuré. Aucune liste de marques ou de domaines URBN n'est codée dans le lecteur.

La collecte met en attente une origine non qualifiée, un détail absent, ambigu ou contradictoire, ainsi qu'une erreur de lecture. Elle conserve la preuve et ne copie pas le contenu ni l'employeur d'une mauvaise page. Ces mises en attente ne prouvent pas une fermeture.

Le test d'interruption iCIMS vérifie désormais le comportement réel : arrêt simulé avant tout accès au premier détail. L'ancienne assertion sur une chaîne du fichier source est supprimée.

## Validation

Les [contrôles](preuves/lot-4h1-validation.json) couvrent 3 180 tests : 2 389 unitaires, 532 d'intégration, 254 API et cinq Python. Deux tests API optionnels restent ignorés. Les 55 migrations sur une base neuve, le typage et le build API passent. Les sept [contre-épreuves](preuves/lot-4h1-counterproofs.json) retirent successivement une liaison d'identité, la garde de périmètre, la séparation de tenant, la référence, la clé de recherche ou le contrôle du détail ; chaque mutation est détectée, puis le code restauré repasse les tests.

Le runtime de travail et celui vérifié correspondent exactement : [empreintes](preuves/lot-4h1-runtime-match.json). Les clés persistées des autres familles restent inchangées.

## Reprise locale

La copie complète est [sauvegardée avant modification](preuves/lot-4h1-backup.json). La [configuration du hub](preuves/lot-4h1-source-config.json) reçoit les sept origines prouvées et passe en pause ; l'ancien volume de certification est invalidé. Cette configuration attend la nouvelle certification du lot sources. L'ancienne revue d'identité, liée à son ancienne empreinte, n'est pas réutilisée comme certification courante. La production et les seeds ne sont pas modifiés.

Les [59 plans d'échéances](preuves/lot-4h1-expiry-apply.json) écrivent 1 511 dates natives, ajoutent leurs observations à l'horloge originale et se répètent sans écriture. Le contenu, les identifiants, les attestations et les projections Job restent inchangés à cette étape.

Les [67 plans de reconstruction](preuves/lot-4h1-stock-apply.json) traitent 1 530 groupes et 2 462 présentations, puis sont rejoués sans écriture. Le contrôle [après application](preuves/lot-4h1-stock-verification.json) compare toutes les présentations, les faits, les projections, le miroir RAW, la lisibilité publique et les champs natifs du journal. Aucun identifiant, déplacement, redirection ou capture n'est créé ; aucune attestation n'est rafraîchie.

Les 23 fermetures sont [prouvées pour tous les membres concernés](preuves/lot-4h1-expiry-review.json). Les 16 changements de publication sélectionnée concernent uniquement ces groupes fermés : le contenu historique retenu vient de sa propre publication, sans réactiver le flux retiré ni exposer un lien actif. Les [cinq pays complétés](preuves/lot-4h1-critical-fields.json) passent de l'absence à `DE` ou `GB`, depuis les valeurs natives `DE` ou `UK`. Les 21 groupes déjà reconstruits ne changent que de clé de recherche et d'empreinte. Aucun rapprochement qualifié ne subsiste sur plusieurs groupes dans ce périmètre.

Le [bilan de la copie](preuves/lot-4h1-stock-balance.json) atteint **54 831 présentations** dans **52 977 groupes intégralement reconstruits** ; 52 772 publications ayant une présentation portent encore leur drapeau actif. Ces compteurs ne mesurent pas la disponibilité actuelle après échéance, retrait et fraîcheur. Les 278 redirections sont conservées. Parmi les 55 125 publications désormais reconstructibles, 294 restent dans un groupe dont un autre membre est insuffisant : les 932 groupes mixtes iCIMS sont traités, deux publications supplémentaires deviennent reconstructibles dans des groupes encore bloqués.

## Limites et suite

L'[examen du périmètre](preuves/lot-4h1-stock-scope.json) ne trouve aucune régression de lecture. Les groupes dont un membre a perdu son RAW ou garde un détail insuffisant restent exclus. L'origine d'une fiche n'est pas une preuve que toute son information est exploitable. La distinction entre absence de contenu et identité vérifiable reste nécessaire ; aucun seuil n'est assoupli pour augmenter artificiellement la couverture.

La certification des sources, la reprise des formats restants, la séparation des groupes incomplets et les lots recherche, produit, sécurité et release restent à terminer. Ce lot n'active aucun CRON et ne constitue pas une mise en production.
