# Lot 7 — pertinence multilingue et performance de recherche

**Ouvert le 16 septembre 2026 sur le commit `37ecc7c`.** Ce document porte d’abord l’état avant mesuré, les objectifs fixés avant toute optimisation, le contrat du lot et ses critères de sortie ; le bilan est ajouté en fin de lot. Tant que la section « Bilan » est absente, rien de ce qui est décrit au futur n’existe.

## État avant, mesuré

Latences réelles de l’unique chemin SQL (`searchSummary`, lot 6) sur le clone de répétition (87 607 offres, PostgreSQL 18 en conteneur local, machine partagée avec d’autres serveurs), lecture seule, six exécutions par cas (une froide puis cinq chaudes ; `lot7-mesure-avant.log`) :

| Cas | Offres servies / périmètre | Froid | p50 chaud | Max chaud |
|---|---:|---:|---:|---:|
| FR sans critère | 10 969 / 10 969 | 228 ms | 71 ms | 76 ms |
| FR `q=vendeur` | 4 067 | 364 ms | 232 ms | 1 798 ms |
| FR `q=école` | 1 574 | 611 ms | 278 ms | 561 ms |
| FR `q=ecole` | **400** | 520 ms | 466 ms | 589 ms |
| FR `q=Vendeur Conseil Luxe` (3 termes) | 48 | 402 ms | 273 ms | 279 ms |
| FR `q=l'oréal` | 102 | 9 132 ms | **4 530 ms** | 4 787 ms |
| FR `q=LVMH` (groupe : 52 noms) | 1 408 | 12 481 ms | **12 304 ms** | 12 484 ms |
| FR `lieu=Paris` | 3 690 | 52 ms | 57 ms | 62 ms |
| FR `contrat` + `temps` | 7 557 | 61 ms | 62 ms | 78 ms |
| US sans critère | 37 409 / 37 409 | 855 ms | **732 ms** | 906 ms |
| US `q=store manager` | 19 629 | 12 081 ms | **9 104 ms** | 9 429 ms |
| CN `q=销售` (sans espace) | 577 / 1 222 | 168 ms | 59 ms | 67 ms |
| GB `q=sales assistant` + `lieu=London` | 437 / 3 577 | 594 ms | 299 ms | 311 ms |

Ce que le code faisait, vérifié en lecture :

- **Accents et casse.** `Job.searchText` est maintenu par déclencheur SQL (`catwalks_job_search_text`, migration `20260909030000`) comme la concaténation BRUTE de titre, description, ville, lieu, département, contrat, Maison et groupe ; la recherche fait `ILIKE '%terme%'` dessus. `ILIKE` ignore la casse mais pas les accents : « école » et « ecole » rendent deux ensembles différents (1 574 contre 400 offres FR), et un candidat qui tape sans accent perd les trois quarts des offres. Les offres directes (lot 6B) portent la même concaténation brute.
- **Groupes et alias.** Un terme est développé en noms de Maisons depuis le référentiel des groupes (`expandCompanyTerm` : « LVMH » → 52 noms, « Richemont » → 24), puis CHAQUE nom devient une clause `ILIKE` sur `searchText` dans le préfiltre, plus un `ILIKE` sur le nom de Maison et le groupe avec deux sous-requêtes d’alias par nom dans la condition littérale. C’est ce qui coûte 12 s sur « LVMH » et 4,5 s sur « l’oréal » (alias `L'Oreal`). La même information existe déjà en un seul endroit : `Company.name`, `Company.parentGroup`, `CompanyAlias`, et le `companyId` indexé de chaque offre.
- **Deux passes par terme.** Un préfiltre indexé sur `searchText` puis une re-vérification champ par champ (titre, description, ville, lieu, département, contrat, Maison, groupe) pour chaque terme, jointe à `Job` et `Company` : « store manager » sur le marché américain (37 409 offres) coûte 9 s.
- **Aucune pertinence.** L’ordre est origine, confirmées, pays prioritaire, fraîcheur : une offre dont le titre est « Vendeur » n’est pas classée avant une offre qui ne contient « vendeur » qu’au fond de sa description.
- **Pagination par décalage.** `page` et `OFFSET` (plafond 10 000 côté API, 40 côté site) : une offre insérée en tête entre deux pages décale tout (doublon à la frontière, déjà dédoublonné par le site), une offre retirée fait sauter la suivante.
- **Caches.** Le site met en cache chaque appel amont par URL complète (marché compris) ; l’API ne met en cache que le contrat des marchés (global). Aucun cache ne mélange deux marchés ; aucune langue de requête n’entre encore dans une clé (les libellés sont français, lot 8).
- **Volumes.** 87 607 offres réelles sur le clone ; aucun jeu à 1 million n’existe, et le disque de la machine de vérification (1,6 Gio libres) ne permet pas de le créer localement.

## Objectifs fixés avant optimisation

Mesurés sur le clone local, machine partagée ; ils ne préjugent pas de la capacité de production, qui n’est pas mesurée (carte de décision « SLO et budget » au bilan).

- **Pertinence** : une recherche sans accent trouve les offres accentuées et inversement ; casse indifférente ; une requête chinoise sans espace, un nom de marque ou de groupe, une apostrophe typographique, huit termes, et un joker littéral (`%`, `_`) se comportent comme un candidat s’y attend ; une offre dont le TITRE porte les termes précède une offre qui ne les porte qu’en description, dans chaque origine, avant la fraîcheur.
- **Latence côté API (SQL de recherche, hors réseau)** : p50 chaud ≤ 250 ms sur le marché FR, ≤ 500 ms sur le marché US (le plus grand), aucun cas du tableau ci-dessus au-dessus de 1 000 ms à chaud ; les cas « groupe » et « apostrophe » rentrent dans ces bornes.
- **Pagination** : un curseur de clés ordonnées (keyset), lié aux critères ; aucune page sautée ni doublée par une insertion ou un retrait concurrent ; comportement documenté pour une modification concurrente.
- **Caches** : aucune clé sans marché ; démontré par témoin.
- **Concurrence** : vingt recherches simultanées sur la base jetable sans erreur ni délai d’attente, latence rapportée.

## Contrat du lot

1. **Normalisation en un seul endroit, dans la base.** Une fonction SQL immuable `catwalks_normaliser_texte` (minuscules, accents retirés par `unaccent`, apostrophes typographiques unifiées) maintient `Job.searchText` et `DirectOffer.searchText` par déclencheur, et normalise le terme de chaque requête de la même façon. Le texte original (titre, description, noms) n’est jamais modifié : la normalisation ne vit que dans la colonne d’index.
2. **Un terme, une condition.** *(Remplacé au bilan, § « Ce qui a changé par rapport au contrat » : l’appariement par sous-chaîne `ILIKE` a été mesuré et abandonné pour l’appariement par mots.)* Pour chaque terme : `searchText ILIKE '%terme%'` OU l’offre appartient à une Maison résolue par le terme (nom, groupe, alias, Maisons du groupe du référentiel), résolue UNE fois en identifiants de `Company` ; plus les codes métier de la taxonomie sur la requête entière. ET entre les termes. Plus de re-vérification champ par champ.
3. **Pertinence.** Dans chaque origine et après les confirmées et le pays prioritaire : un score (terme dans le titre > terme porté par la Maison > terme ailleurs), puis la fraîcheur, puis l’identifiant.
4. **Curseur.** `apres` (jeton opaque) remplace `page` : le jeton porte la clé ordonnée de la dernière ligne servie et l’empreinte des critères ; un jeton d’autres critères est refusé (`400 CURSEUR_INVALIDE`) ; la réponse porte `suivant` (ou `null`). Une insertion après le début de la lecture n’apparaît qu’à la prochaine recherche ; un retrait disparaît sans faire sauter la ligne suivante ; une modification qui change la clé d’une offre peut la faire apparaître deux fois ou pas du tout dans une même lecture (limite documentée du keyset sans instantané).
5. **L’annuaire** suit le même contrat (`apres`, `suivant`).
6. **Le site** consomme `apres`/`suivant` ; `page` disparaît de son contrat d’URL.

## Critères de sortie

- Témoins d’exécution sur base réelle : école/ecole, casse, intitulés locaux, requête chinoise sans espace, marque et groupe, huit termes, joker littéral, apostrophe typographique, filtres ET/OU, pertinence titre avant description, pagination par curseur avec insertion et retrait concurrents, curseur d’autres critères refusé, offres directes normalisées ; contre-épreuves ; mesures après sur les treize cas du tableau ; concurrence.
- Objectifs ci-dessus atteints sur le clone ; plans SQL des cas critiques documentés.
- Documentation : `recherche-marche.md` (normalisation, pertinence, curseur), ce dossier.
- Aucune production touchée ; migration rejouée sur base neuve et sur le clone.

## Bilan

**Lot 7 — commit A : le premier commit qui suit `37ecc7c` sur la branche (reçu privé `backups/reprise-20260916-lot7/7-post-commit.json`) ; périmètre : `apps/api` (recherche, annuaire, suggestions, curseur), `packages/db` (quatre migrations, schéma), site candidat en local (contrat d’URL et chargement continu par curseur), documentation et preuves.** Livré le 16 septembre 2026 sur le clone du stock et la base jetable ; aucune production touchée ; le site reste non committé (dépôt protégé, sauvegarde privée `backups/reprise-20260916-lot7/website-7/`).

### Problème corrigé

- **Accents et casse.** Le texte indexé (`Job.searchText`, `DirectOffer.searchText`) est normalisé dans la base par `catwalks_normaliser_texte` (minuscules, `unaccent`, apostrophes unifiées ; migrations `20260916200000` et `20260916200100`) ; « école », « ecole » et « ÉCOLE » rendent les mêmes 1 890 offres FR (avant : 1 574 contre 400).
- **Des mots, pas des sous-chaînes.** Après la normalisation seule, « store manager » sur le marché US coûtait encore 5,3 s (l’index trigramme de 479 Mo n’était jamais choisi, chaque terme rebalayait 206 Mo de descriptions, `ILIKE` coûtait 2,9 fois `LIKE` sur un texte déjà en minuscules) et les cas FR se dégradaient (« vendeur » 232 → 649 ms). Chaque offre porte désormais deux vecteurs de mots maintenus par les déclencheurs (`searchVector`, index GIN partiel ; `titleVector`, titre A et Maison B ; migrations `20260916210000`, `210100`, `210200`) ; un terme s’apparie au début d’un mot ; les écritures sans espaces (chinois…) et les termes sans lettre gardent l’appariement littéral. Les identités de la Maison résolue et du code métier sont des mots du vecteur : toute la condition (texte OU Maison par terme, ET entre termes, OU métiers de la taxonomie) est une seule requête plein texte servie par l’index — un `OR` SQL entre le vecteur et `companyId` faisait choisir au planificateur un balayage de `Job` avec `@@` par ligne (635 à 828 ms).
- **Groupes et alias.** Un terme résout ses Maisons une fois en identifiants (`maisons_i` : nom, groupe, alias revu, ancienne Maison fusionnée, Maisons du groupe du référentiel) ; « LVMH » : 12,3 s → 29 ms, « l’oréal » : 4,5 s → 37 ms.
- **Pertinence.** Score par terme (titre 2, Maison 1, ailleurs 0) après l’origine, les confirmées et le pays prioritaire, avant la fraîcheur.
- **Curseur.** `apres`/`suivant` remplacent `page`/`pageCount` sur `/api/jobs` et `/api/companies` (jeton opaque : version, empreinte des critères, clé ordonnée ; `400 CURSEUR_INVALIDE` avant toute requête) ; le site consomme le curseur (`urlSuite`, sentinelle et vrai lien « Voir plus », redirection vers le début de la même recherche sur jeton refusé ou page vide derrière un curseur).
- **Plan générique.** Prisma réutilise ses instructions préparées ; à partir de la sixième exécution PostgreSQL basculait sur un plan générique : « école » 24 → 298 ms, « store manager » 610 → 4 796 ms (reproduit par `PREPARE`/`EXECUTE` ×7). La migration `20260916210300` fixe `plan_cache_mode = force_custom_plan` sur le rôle de l’API ; septième exécution après correction : 24 ms et 216 ms.
- **Total du périmètre.** Mémorisé 60 s par instance et par ensemble de pays (240 ms par recherche US sans lui) ; jamais partagé entre deux périmètres.

### Mesures après (clone, p50 chaud sur cinq exécutions ; [preuve](preuves/lot-7-mesures.json))

| Cas | Offres | Avant | Intermédiaire (normalisation seule) | Après | Objectif |
|---|---:|---:|---:|---:|---|
| FR sans critère | 10 967 | 71 ms | 219 ms | 86 ms | ≤ 250 |
| FR `q=vendeur` | 4 054 | 232 ms | 649 ms | 52 ms | ≤ 250 |
| FR `q=école` | 1 890 | 278 ms | 658 ms | 26 ms | ≤ 250 |
| FR `q=ecole` | 1 890 | 466 ms | 513 ms | 28 ms | ≤ 250 |
| FR `q=Vendeur Conseil Luxe` | 47 | 273 ms | 652 ms | 36 ms | ≤ 250 |
| FR `q=l'oréal` | 102 | 4 530 ms | 583 ms | 37 ms | ≤ 250 |
| FR `q=LVMH` | 1 406 | 12 304 ms | 659 ms | 29 ms | ≤ 250 |
| FR `lieu=Paris` | 3 688 | 57 ms | 96 ms | 63 ms | ≤ 250 |
| FR `contrat` + `temps` | 7 555 | 62 ms | 235 ms | 87 ms | ≤ 250 |
| US sans critère | 37 404 | 732 ms | 451 ms | 322 ms | ≤ 500 |
| US `q=store manager` | 19 617 | 9 104 ms | 5 293 ms | 208 ms | ≤ 500 |
| CN `q=销售` | 577 | 59 ms | 60 ms | 36 ms | ≤ 250 |
| GB `q=sales assistant` + `lieu=London` | 437 | 299 ms | 275 ms | 66 ms | ≤ 250 |

Aucun cas au-dessus de 342 ms à chaud (objectif : 1 000 ms) ; à froid, 478 ms au plus (US sans critère). Vingt recherches simultanées (mélange des treize cas) : 1,13 s en tout, p50 633 ms, p95 1,10 s, aucune erreur (intermédiaire : 15,4 s, p50 5,6 s). Curseur : trois pages consécutives, 75 identifiants distincts. Les totaux d’une même colonne diffèrent de quelques unités entre les mesures : des publications expirent entre-temps. « FR sans critère », « lieu » et « contrat » sont à ±25 ms de l’état avant (variance de la machine partagée, score et mémo ajoutés).

### Preuves

- Témoins sur base réelle (`lot6-target`, base jetable) : `lib/__tests__/pertinence-lot7.test.ts` (15 cas : vecteurs maintenus par la base, plan personnalisé lu depuis une session du client, appariement au début d’un mot, école/ecole/ÉCOLE, score titre avant description, groupe du référentiel, apostrophe typographique, chinois sans espace, jokers littéraux, huit termes, ET/OU avec inconnues, curseur avec insertion et retrait concurrents, jeton refusé, suggestions), `annuaire-curseur-lot7.test.ts` (deux pages sans doublon, jeton refusé), `bornes-recherche-audit.test.ts` (structure du SQL, plus aucun `ILIKE`), suites `origines-directes`, `perimetre-marche`, `jobs-database`, `parse-filters`, `expiry-database`, `search-plan`, `projection-f1` adaptées ; suite API complète : voir la validation finale ci-dessous.
- Contre-épreuves ([preuve](preuves/lot-7-counterproofs.json)) : onze mutations, chacune fait passer son témoin au rouge, fichiers restaurés à l’octet près, témoins verts après restauration — terme non normalisé, score retiré, poids du titre ignoré, groupe non résolu, terme lexical redevenu sous-chaîne, écriture sans espaces traitée en mots, curseur ignoré, ligne de trop retirée, empreinte non vérifiée, curseur d’annuaire ignoré, joker non échappé.
- Plans SQL des cas critiques et hypothèses mesurées ([preuve](preuves/lot-7-mesures.json)) : `ILIKE` contre `LIKE` (5 539 contre 1 929 ms), 206 Mo de texte US balayés, index trigramme jamais choisi, vecteur seul par l’index (28 ms), `OR` SQL vecteur/Maison (635 à 828 ms), plan générique avant et après correction.
- Site : `curseur-lot7.test.tsx` (URL amont, `suivant` relu, enveloppe d’avant refusée, `CURSEUR_INVALIDE` distingué, lien « Voir plus » avec `rel=next`), `page-curseur-lot7.test.tsx` (redirection sur jeton refusé ou page vide derrière un curseur, aucune redirection d’une page servie), témoins d’URL et de page adaptés ; 65 fichiers, 733 tests ; `tsc` 0 erreur ; build : voir la validation finale.
- Migrations rejouées sur base neuve (base jetable, `lot6-check`) et sur le clone (`lot7-clone-migrate-*.log`) ; sur le clone la reprise `210100` a d’abord échoué (`cannot CREATE INDEX "Job" because it has pending trigger events` : le déclencheur différé de redirection après la réécriture de `Job`), corrigée par `SET CONSTRAINTS ALL IMMEDIATE`, marquée annulée puis rejouée (168 s, index GIN de 97 Mo) ; `210200` : 81 s ; `210300` : 1 s. Reprise de la normalisation `200100` : 221 s.

### Validation finale (copie de vérification synchronisée, base jetable, `lot6-full.py 7`)

- API : 29 fichiers, 279 tests verts, 2 ignorés (témoins de base réelle sans base) ; build Next de l’API compilé.
- Agrégateur : unitaires 169 fichiers, 2 613 tests verts ; intégration 69 fichiers, 780 tests verts.
- Typecheck des trois espaces de travail : 0 erreur (`lot6-check`).
- Site : `tsc` 0 erreur ; 65 fichiers, 733 tests verts ; build de production compilé, 93 pages générées (`NEXT_DIST_DIR=.next-verif`, dossier retiré après le build, `tsconfig.json` intact).

### État des données et de la production

- Clone du stock : 77 migrations, 87 607 offres vectorisées, `Job` 2 178 → 1 985 Mo (index trigramme retiré), base 7,6 → 7,4 Go. Base jetable : mêmes migrations.
- **Production : rien.** L’API déployée (Railway) lit une base à 44 migrations sur 77 (constat du lot 6B, inchangé) ; le site déployé ne connaît pas `apres` ; le backend n’est pas concerné par ce lot. La bascule exige, dans l’ordre : migrations sur la base Railway hors heures de capture (trois réécritures de `Job` : 221 + 168 + 81 s sur 87 607 offres, à extrapoler ; le déclencheur différé se joue ligne à ligne), déploiement de l’API, puis du site (ses liens `?apres=` n’ont de sens que pour la nouvelle API ; l’ancienne ignorerait `apres` et servirait la première page). Un « go » explicite reste requis pour chacun.

### Legacy supprimé et documentation

- Supprimés : index trigrammes `Job_searchText_trgm_idx` (479 Mo) et `DirectOffer_searchText_trgm_idx`, `page`/`pageCount`/`MAX_PAGE`/`normalizedPage` (API), `page`/`pageMax`/`lirePage`/`urlPage` et la redirection de page (site), tout `ILIKE` sur des colonnes normalisées (recherche, suggestions), la re-vérification champ par champ et les clauses par nom développé, la fonction `catwalks_vecteur_texte(text)` remplacée par sa forme à trois arguments.
- Documentation : [recherche-marche.md](../../docs/architecture/recherche-marche.md) (§ « Texte, pertinence, curseur », site), [production-foundations.md](../../docs/architecture/production-foundations.md) (tableau et § 3), ce dossier, commentaires de tête des quatre migrations et de `job-search-query.ts`.

### Ce qui a changé par rapport au contrat

Le contrat 2 fixait `ILIKE '%terme%'`. Mesuré après l’avoir implémenté (étape intermédiaire ci-dessus), il ne pouvait pas atteindre les objectifs (5,3 s sur « store manager », cas FR dégradés), et il ne mène à rien à un million de documents. L’appariement par mots (préfixe) l’a remplacé ; c’est un changement de comportement visible : « ente » ne trouve plus « vente », « sales » ne trouve plus « wholesales », un terme sans lettre reste littéral. Carte de décision ci-dessous.

### Limites

- **La désignation d’une Maison par un terme reste par sous-chaîne sur son nom** (`Madewell Stores` est désignée par « store ») : cohérent avec l’annuaire, plus large que l’appariement par mots du texte. Non tranché.
- **Aucun témoin n’exerce les codes métier de la taxonomie dans la recherche** (`OR métiers`) : la base jetable ne porte pas de révision de taxonomie applicable (déclencheur `validate_job_occupation`). Le mécanisme existait avant le lot ; il est porté par le vecteur (`metier<code>`) et lu dans les plans du clone (`metierstoremanager`), pas prouvé par témoin.
- **`DirectOffer.searchVector` n’a pas d’index** : la table est petite (copie de lecture) ; un index GIN devient utile au-delà de quelques milliers d’offres directes.
- **Volume à un million de documents : NON FAIT** (disque de la machine de vérification : 1,1 Gio libres). Projection, non mesurée : l’index GIN répond en temps quasi constant ; le reste de la requête (facettes, totaux, clé de tri) est linéaire dans le nombre d’offres qui répondent — un cas qui répond 200 000 offres coûterait de l’ordre de dix fois le cas US.
- **Capacité de production non mesurée** : les chiffres sont ceux d’un conteneur local sur une machine partagée. Le script `lot7-mesure.py` rejoue les treize cas contre n’importe quelle base.
- **Mémo du total** : jusqu’à 60 s de retard par instance sur `totalPerimetre` (le compteur d’accueil vient déjà d’un contrat mémorisé deux minutes).
- **`plan_cache_mode` est un réglage de rôle** posé par migration : il s’applique aussi aux sessions de l’agrégateur (même rôle) ; coût de planification mesuré 10 à 35 ms sur la recherche, négligeable sur les requêtes simples.
- Le keyset sans instantané : une offre dont la clé change pendant une lecture peut apparaître deux fois ou pas du tout (documenté).

### Cartes de décision

🔷 **DÉCISION — Recherche par mots (préfixe) plutôt que par sous-chaîne** · Contexte : la sous-chaîne sur 5,6 Ko de description par offre coûte 5,3 s sur le plus grand marché et ne s’indexe pas ; l’appariement par mots coûte 26 à 208 ms et s’indexe. Enjeu : « ente » ne trouve plus « vente », « sales » ne trouve plus « wholesales » ; « vente » trouve « ventes », les accents et la casse sont indifférents. Options : A) mots-préfixe, appliqué (recommandé) ; B) revenir à la sous-chaîne (objectifs inatteignables, +250 Mo de stockage non compressé pour approcher 700 ms) ; C) mots-préfixe plus tolérance d’orthographe (trigrammes sur les mots, lot ultérieur). Reco : A. Si non tranché : A reste en place, non déployé.

🔷 **DÉCISION — SLO et budget de la recherche en production** · Contexte : objectifs atteints sur un conteneur local ; rien n’est mesuré sur Railway. Options : A) mesurer après migration de la base Railway avec `lot7-mesure.py` et fixer p95 ≤ 500 ms (recommandé) ; B) dimensionner d’abord (plan Railway, mémoire) ; C) ne rien fixer. Reco : A, avant tout cutover.

🔷 **DÉCISION — Fenêtre de migration du stock** · Contexte : trois réécritures complètes de `Job` (≈ 8 min sur 87 607 offres en local), verrous de lignes pendant la reprise. Options : A) jouer hors heures de capture, captures suspendues (recommandé) ; B) jouer à chaud (captures en attente sur verrous, risque de `lock_timeout`) . Reco : A.

### Prochaine étape

Lot 8 (pays, langues, domaines, traduction des libellés) sur la base de ce contrat ; le site reste local ; aucune activation de CRON, aucun déploiement.
