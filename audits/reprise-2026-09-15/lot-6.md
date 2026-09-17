# Lot 6 — recherche commune bornée par marché, deux origines

**Ouvert le 16 septembre 2026 sur le commit `7a33772`.** Ce document porte d’abord le contrat du lot (état avant, invariants, chemins, critères de sortie) ; son bilan est ajouté en fin de lot. Tant que la section « Bilan » est absente, rien de ce qui est décrit au futur n’existe.

## État avant, mesuré

Relevé en lecture seule du clone de répétition (`scripts/lot6-etat-avant.py`, `default_transaction_read_only=on`, refus d’écriture prouvé), [preuve](preuves/lot-6-etat-avant-clone.json) :

| Fait | Valeur |
|---|---:|
| Offres publiables (monde) | 83 010 |
| Offres publiables sans pays | 4 811 |
| Codes pays non ISO-2 parmi les offres publiables | 0 |
| `isFrance` et `countryCode = 'FR'` en désaccord | 0 |
| Offres dans le périmètre des douze marchés servis par le site (DE = DE+AT, GB = GB+IE) | 69 294 |
| Offres avec pays hors de ces périmètres (IN 570, JP 548, KR 525, PT 523, MX 459…) | 8 905 |
| Télétravail (`workplaceType = REMOTE`) / dont sans pays | 295 / 2 |
| Villes présentes dans plusieurs pays / villes distinctes avec pays | 288 / 6 698 |
| « Paris » : FR 3 656 · US 9 (Tennessee 7, Texas 2) · BE 1 · ES 1 | |
| Offres avec code postal / avec subdivision (`adminArea1`) | 28 624 / 17 390 |
| Marché FR : contrat non renseigné / rythme non renseigné | 3 380 / 3 949 sur 10 969 |
| Marché US : contrat non renseigné / rythme non renseigné | 31 002 / 5 829 sur 37 409 |
| Table d’offres directes, source `catwalks`, publications `catwalks` | 0 / 0 / 0 |

Ce que le code faisait avant le lot, vérifié en lecture et couvert par le témoin `perimetre-marche` :

- `marche` ne bornait rien : `job-search-query.ts` ne l’ajoutait à aucune condition SQL, `facettes-marche.ts` ne s’en servait que pour retirer des facettes de la réponse, et un témoin (`facettes-marche.test.ts`) affirmait explicitement que « `marche` ne filtre aucune offre ». `GET /api/jobs?marche=US` rendait donc le total mondial : c’est le défaut historique « `marche=US` → 83 431 ».
- Un marché absent, mal formé ou inconnu dégradait en recherche mondiale, côté API comme côté site (« Tous les marchés »).
- Deux chemins SQL décrivaient les mêmes filtres avec deux sémantiques : `whereClause` (Prisma, tolérant aux valeurs inconnues) et `searchSummary` (SQL, égalité stricte). Seul le second servait `/api/jobs` ; le premier n’avait plus que des tests pour appelants.
- Les suggestions d’intitulés et de Maisons étaient mondiales ; seules les villes étaient cloisonnées.
- Le site portait des copies manuelles des facettes et des libellés du registre, gardées par des témoins de parité.
- Aucune offre Catwalks n’entrait dans le moteur : la source `catwalks` n’existait pas, le mode de candidature était déduit d’une clé de source absente, et l’API publique du backend plafonnait sa liste à 500 offres (`take: 500`) sans version, sans pays et sans retrait signalé.

## Contrat du lot

### Règles de périmètre

1. **Le périmètre est obligatoire.** Toute recherche (résultats, totaux, facettes, suggestions, annuaire) porte un code de périmètre `marche`. Un code absent, mal formé ou inconnu est refusé (`400 MARCHE_REQUIS` / `MARCHE_INCONNU`) ; aucun repli mondial, ni silencieux ni explicite.
2. **Un périmètre est un ensemble de pays.** Un marché mesuré du registre partagé porte son périmètre géographique (`DE` sert DE et AT, `GB` sert GB et IE). Tout autre code ISO 3166-1 connu est accepté comme périmètre d’un seul pays, sans facettes natives : le stock hors des douze marchés reste atteignable, jamais mélangé au monde.
3. **Une offre appartient au périmètre qui contient son `countryCode`.** Une offre sans pays n’appartient à aucun périmètre ; elle reste servie par son identifiant (fiche, statut) et n’est injectée dans aucun marché.
4. **Télétravail.** Une offre en télétravail est bornée par son pays comme toute autre ; « remote » ne prouve aucun droit de recrutement mondial. Le télétravail est un mode de travail demandé dans le champ lieu, jamais une ville ni un pays.
5. **Multi-localisation.** Le catalogue projette une seule localisation par offre (`countryCode`, `city`, `adminArea1`, `postalCode`) ; les localisations natives déclarées restent conservées dans les faits de la publication. Une publication multi-pays n’est servie que dans le pays projeté : la représentation dans plusieurs périmètres exige une localisation par pays, hors de ce lot et documentée comme limite.
6. **Champ lieu.** Il résout, dans le périmètre : une ville (égalité, préfixe, présence dans le libellé), une subdivision (`adminArea1`), un code postal (préfixe, chaîne conservée), ou le télétravail. Un pays nommé dans ce champ n’est accepté que s’il appartient au périmètre ; sinon il est refusé explicitement avec le motif « pays hors marché ».

### Filtres, inconnues et facettes

7. **ET entre dimensions, OU entre les valeurs d’une dimension.** Un filtre dont la dimension n’est pas servie sur le marché, ou dont une valeur est hors périmètre (`pays`), est **refusé explicitement** : la réponse le nomme (`filtresRefuses`) et les résultats sont calculés sans lui ; rien n’est réinterprété en silence.
8. **Inconnues (D-435).** Sur les dimensions contrat, temps, programme et langue, une offre non renseignée reste dans les résultats filtrés sans être comptée comme confirmée : chaque ligne porte `correspondance` (`CONFIRMEE` / `NON_CONFIRMEE` avec les dimensions non précisées), la réponse porte `total` et `totalConfirmes`, et les confirmées précèdent les non confirmées dans chaque origine. Une incompatibilité connue exclut toujours.
9. **Facettes.** Un contrat versionné, servi par l’API depuis le registre partagé : pour le périmètre demandé, la liste ordonnée des facettes avec leur clé d’URL, leur libellé natif et leurs options comptées. Les comptes d’une facette excluent sa propre sélection et incluent toutes les autres. Le site ne maintient aucune liste de marchés, de facettes ni de libellés.

### Deux origines

10. **Offres directes.** Le backend Catwalks publie un contrat public versionné (`CATALOGUE_CONTRAT_VERSION = 1`) limité aux champs publiables — jamais un contact, un mandat interne, un CV ni une candidature — et une outbox alimentée par déclencheur dans la transaction de chaque insertion ou modification d’offre, immuable, consommée par l’agrégateur de façon idempotente (`version` monotone par offre, doublons et désordre neutralisés, jamais de résurrection d’une version ancienne). La reprise initiale est le même flux paginé depuis le début, sans plafond.
11. **Projection commune.** Les offres directes vivent dans un espace d’identifiants distinct (`cw_<id>`), sont unies aux offres agrégées **avant** filtres, tri et pagination, et passent en tête des résultats qui les contiennent (D-419 §1) sans jamais sortir du périmètre ni des filtres.
12. **Action de candidature explicite.** Chaque ligne porte `origine` (`CATWALKS` / `AGREGEE`) et `candidature` : `{ type: 'CATWALKS', offreId, slug, url }` ou `{ type: 'EXTERNE', url }` (http(s) seulement) ou `{ type: 'AUCUNE' }`. Rien n’est déduit d’un domaine ni d’une forme d’identifiant. L’éligibilité est recontrôlée par l’API de candidature du backend (`estOffreCandidatable`, déjà en place et gardé).

### Critères de sortie

- Témoins d’exécution sur base réelle : FR/US/CN et chaque marché, Paris Texas/France, France tapée en contexte US, code postal, BE/FR transfrontalier, télétravail sans pays, code inconnu, changement de marché avec anciens filtres, deux origines sous les mêmes filtres, plus de 500 offres directes, événements dupliqués/désordonnés/rejoués, totaux/facettes/pages identiques en périmètre ; contre-épreuve du défaut `marche=US → total mondial`.
- Contre-épreuves (mutations du code, gardes SQL) détectées et restaurées.
- Un seul chemin SQL, aucun lecteur manuel de registre côté site, aucun code sans appelant laissé derrière.
- Documentation : `docs/architecture/recherche-marche.md` (contrat), contrats backend et website, bilans de sous-lots.
- Aucune production touchée ; migrations rejouées sur base neuve et sur le clone ; push agrégateur seulement après ce bilan.

### Découpage

- **6A — agrégateur** : registre partagé étendu (périmètres, langues, libellés, contrat de facettes), périmètre obligatoire dans le SQL, suggestions bornées, refus explicites, inconnues, un seul chemin SQL, `GET /api/marches`.
- **6B — backend et agrégateur** : contrat public, outbox par déclencheur, flux paginé ; consommateur idempotent, projection commune, priorité Catwalks, action de candidature.
- **6C — website** : consommation du contrat, périmètre obligatoire à l’écran, action de candidature, notice des filtres refusés, suppression des listes manuelles et de leurs témoins de parité.

## Bilan 6A — l’API borne la recherche par le périmètre

**Validé localement le 16 septembre 2026. Aucune migration, aucun push, aucune production touchée.**

Ce qui change dans `apps/api` et `packages/db` :

- `packages/db/marches.ts` porte désormais tout ce qu’un marché est pour le produit : nom natif, périmètre géographique (`DE` sert DE et AT, `GB` sert GB et IE), langues de service, facettes du site et leurs libellés natifs, en plus des dimensions mesurées. `perimetreDeRecherche` accepte un marché mesuré ou tout code ISO 3166-1 connu servi seul ; `facettesContrat` sert le contrat ordonné d’un périmètre ; `CONTRAT_RECHERCHE_VERSION = 1`. La facette `pays` est exposée sur BE, CA, et désormais DE et GB, dont le périmètre couvre deux pays.
- `lib/perimetre.ts` exige un périmètre (`400 MARCHE_REQUIS` / `MARCHE_INCONNU`), `lib/search-plan.ts` décide en un seul endroit ce qui est honoré et refusé, `lib/job-search-query.ts` est l’unique chemin SQL : `base` bornée au périmètre, `scoped` par les dimensions (ET/OU), chaque facette comptée sans sa propre sélection, inconnues conservées et marquées (`confirme`), ordre confirmées puis fraîcheur. `lib/lieu.ts` résout ville, subdivision, code postal (chaîne) et télétravail ; un pays du champ lieu n’est honoré que dans le périmètre.
- `lib/suggestions.ts` borne villes, intitulés et Maisons au périmètre ; `lib/companies.ts` borne l’annuaire ; `lib/facettes.ts` libelle les options dans la langue de service ; `lib/marches-catalogue.ts` et `GET /api/marches` servent le registre et le compteur du catalogue.
- Supprimés : `whereClause` (second chemin Prisma aux sémantiques divergentes, sans appelant de production), `countryCondition`, `rawValuesForCode`, `lib/facettes-marche.ts`, la facette `sources`, les filtres `source` et `fonction`, `champs=liste`, `landingStats`, `sitemap*`, `getCompanyBySlug`, `getJob`.

Preuves :

- Suite API complète dans le checkout de vérification, base jetable : 26 fichiers, 254 tests réussis, 2 ignorés (corpus facultatif). Typecheck des trois espaces de travail et build de l’API (8 routes) verts.
- Témoin d’exécution `perimetre-marche.test.ts` (17 cas, dont la contre-épreuve du défaut historique : sur un semis mondial de neuf offres, `marche=US` en rend deux), `suggest-villes-marche.test.ts` (11), `contrat-marches.test.ts` (7), `search-plan.test.ts` (12), `lieu-f1.test.ts`, `filtres-multiples-d426.test.ts`, `jobs-database.test.ts`, `expiry-database.test.ts`.
- [12 contre-épreuves](preuves/lot-6a-counterproofs.json), toutes détectées : périmètre retiré du SQL, repli France sur marché absent et sur code inconnu, inconnues exclues, facette comptée avec sa sélection, pays hors périmètre honoré dans le lieu, facette non servie honorée, intitulés et villes suggérés hors périmètre, registre sans l’Autriche, code postal lu comme une ville, non confirmées non ordonnées. 70 tests repassent après restauration exacte.

Limites : les libellés d’emploi des lignes et des options restent français sur tous les marchés (lot 8) ; une publication multi-pays n’est servie que dans son pays projeté ; le site (6C) appelle encore l’API avec l’ancien contrat tant que 6C n’est pas livré — l’API n’est pas déployée.

## Bilan 6B — deux origines, une recherche : le backend publie, l’agrégateur consomme, l’API unit

**Validé localement le 16 septembre 2026. Aucune production touchée : ni Neon, ni Railway, ni Vercel. Aucun push. Le dépôt backend n’est pas committé (voir « État des dépôts »).**

**Périmètre.** Backend Catwalks (producteur), agrégateur (consommateur, copie de lecture) et API (union, espace `cw_`, action de candidature). Contrat du lot, règles 10 à 12.

**Problème corrigé.** Avant ce sous-lot, aucune offre publiée sur Catwalks n’existait dans le moteur de recherche : le site servait deux circuits (`/offres` lisait Neon, `/emplois` lisait l’agrégateur), l’export public du backend était plafonné à 500 offres sans versions ni retraits, et le contrat cible `ApplicationAction` de l’architecture n’avait ni producteur ni consommateur. Désormais :

- **Backend (local, non committé, non déployé).** `jobs.country_code` (ISO-2 issu du géocodage, écrit par les deux routes de gestion ; `scripts/rattrapage-pays-offres.mts` pour le stock, en simulation par défaut), `jobs.catalogue_version` (séquence monotone, bump par déclencheur `BEFORE INSERT OR UPDATE` sur tout changement hors quatre colonnes techniques), table `catalogue_outbox` (immuable, une ligne par insertion, modification ou suppression, remplissage initial dans la migration : la reprise complète n’a aucun plafond), `src/lib/catalogue-public.ts` (contrat public version 1 en liste fermée : jamais un contact, un mandat, un CV ni une candidature ; « Internal Catwalks » masqué ; `RETIRE` sur offre absente, hors ligne, supprimée ou inactive), `GET /api/catalogue/flux?depuis=&limite=` (clé partagée en Bearer, comparaison à temps constant, fermé sans clé, 200 par page, 500 au plus, `cache-control: no-store`, 503 avec `retry-after` sur panne).
- **Agrégateur.** `DirectOffer`, `DirectOfferEvent` (immuable en SQL), `DirectFeedCursor` (migration 71, `20260916180000_direct_offers`) ; `src/direct/contrat.ts` (lecture stricte, refus nommé par chemin, grands entiers en `bigint`), `vocabulaire.ts` (correspondance versionnée : un contrat établit la durée OU le programme OU la nature ; « Luxe » n’est pas un secteur), `projection.ts` (colonnes du vocabulaire commun reconstruites à chaque version, contrat conservé et haché), `feed.ts` (`consommerFlux` : une transaction par événement, séquence déjà vue ignorée, version inférieure ou égale ignorée, `RETIRE` sans résurrection, curseur et dernière erreur), commande `direct-sync` (`cli.ts`, `CATALOGUE_FLUX_URL` + `CATALOGUE_FLUX_KEY` obligatoires).
- **API.** `lib/direct-offers.ts` (espace `cw_`, publiable = `eligible` et échéance non passée, `directToRow`), `lib/job-search-query.ts` (`base` = `UNION ALL` des deux origines dans le périmètre avec texte et lieu, avant filtres, facettes, totaux, ordre et pagination ; `ORDER BY origine` place Catwalks en tête), `lib/jobs.ts` (`origine`, `candidature` explicite sur chaque ligne ; fiche, statut, similaires et bloc Maison en `cw_`), `lib/suggestions.ts`, `lib/marches-catalogue.ts` et `lib/companies.ts` comptent les deux origines ; l’annuaire fusionne une Maison directe connue du registre sous sa ligne et donne une ligne `cw_<slug>` à une Maison directe inconnue.

**Preuves.**

- Backend, sur une base jetable neuve (conteneur PostgreSQL éphémère, journal `lot6-backend-migrate.log`) : migrations appliquées ; `scripts/preuve/preuve-outbox-catalogue.mts` vert (insertion → version 1, modification → 2, écriture hors contrat ignorée, flux `PUBLIE` deux fois même version, `RETIRE` sur passage hors ligne, outbox immuable en `UPDATE` et `DELETE`, suppression physique tracée, pagination et `suivant`, 401 sans clé) ; `tsc` vert ; 121 fichiers, 1 190 tests verts (`lot6-backend-tests-2.log`) ; `next build` vert (`lot6-backend-build-2.log`, après un premier échec `ENOSPC` sur disque plein).
- Agrégateur : `src/direct/contrat.test.ts` (9), `vocabulaire.test.ts` (6), `projection.test.ts` (4), `feed.test.ts` sur base réelle (9 : 1 203 événements lus en quatre pages de 500, rejeu depuis zéro sans réécriture, version ancienne après récente ignorée, retrait sans résurrection puis republication, retrait inconnu tracé, contrat étranger refusé et noté sur le curseur sans avancer, événement malformé refusant sa page entière, flux HTTP avec Bearer et séquence puis panne 503 et panne de transport nommées, reprise depuis le curseur).
- API : `lib/__tests__/origines-directes.test.ts` sur base réelle (12 : prémisse, deux origines sous une recherche avec Catwalks d’abord, `candidature` `CATWALKS` / `EXTERNE`, retirée/échue/sans pays exclues de FR et de US, `NON_CONFIRMEE` sur les deux origines, texte et lieu (ville, code postal), facettes et `totalPerimetre` à deux origines, fiche/statut/`offre-status` en `cw_`, similaires et bloc Maison, suggestions bornées, `GET /api/marches`, annuaire fusionné et ligne `cw_`) ; `perimetre-marche.test.ts` (18) inchangé et vert ; typecheck des trois espaces de travail vert ; migration 71 rejouée sur la base jetable et sur le clone de répétition (`lot6b-clone-migrate.log` : 71 migrations, `DirectOffer` vide, déclencheur d’immutabilité présent, 87 607 offres intactes).
- Suites complètes dans le checkout de vérification après restauration (`lot6-full-6b.json`) : API 27 fichiers, 266 tests réussis, 2 ignorés (corpus facultatif) ; agrégateur 169 fichiers et 2 613 tests unitaires, 69 fichiers et 780 tests d’intégration ; build de l’API vert.
- [18 contre-épreuves](preuves/lot-6b-counterproofs.json), toutes détectées puis restaurées à l’octet près : union retirée, Catwalks plus en tête, offre sans pays injectée dans un marché, retirée servie, échue servie, candidature déduite d’un lien, inconnues exclues, statut ignorant l’espace `cw_`, bloc Maison sans les directes, intitulés suggérés sans les directes, `/api/marches` sans les directes, annuaire en double ligne, version ancienne appliquée, retrait ignoré, rejeu non idempotent, refus non noté, version de contrat non vérifiée, « Luxe » devenu secteur. Après restauration : 30 tests API et 28 tests agrégateur repassent.

**État des dépôts et des données.**

- Agrégateur : committé sur la branche du programme (reçu `backups/reprise-20260916-lot6/6b-post-commit.json`). La commande `direct-sync` n’a pas d’alias `npm run` : `apps/aggregator/package.json` porte un travail non committé du propriétaire et n’est pas touché ; l’alias sera ajouté avec la première consolidation de ce fichier.
- Backend : **non committé**, par décision. `prisma/schema.prisma` et `docs/governance/DECISIONS.md` portent le chantier D-425 du propriétaire, non committé ; committer 6B y absorberait son travail. Les douze fichiers du sous-lot et le schéma partagé sont sauvegardés hors Git avec leurs empreintes (`backups/reprise-20260916-lot6/backend-6b/manifest.json`, diffs des fichiers suivis inclus) ; les trois fichiers du propriétaire n’ont pas été modifiés (empreintes relevées dans le même manifeste). Le commit backend revient au propriétaire, après séparation des deux chantiers.
- Neon (production backend) : intacte ; aucune migration, aucune écriture. Le rattrapage `country_code` du stock n’a pas été exécuté (simulation seulement possible sur une copie ; la production est protégée par défaut).
- Copie de lecture `DirectOffer` : vide partout ; aucune production ne l’alimente tant que le flux backend n’est pas déployé.
- **Base catalogue Railway (lue en direct par le serveur de développement local de l’API, port 3010, `apps/api/.env.local`) : 44 migrations appliquées sur 71, dernière `20260915143000_work_schedule` ; ni les tables de capture (lot 2), ni `SourceIngestionCompletion` (5G3C), ni `DirectOffer` n’y existent** (lecture seule, 16/09/2026). Le code de la branche ne peut pas servir cette base : depuis 6B, `/api/jobs`, `/api/offres`, `/api/companies` et `/api/marches` y répondent 503 (base indisponible). Aucune migration n’y a été appliquée (production protégée, go requis) ; le client Prisma du dépôt de travail a été régénéré (`node_modules` seulement). Pour un contrôle local, le serveur de développement peut cibler le clone de répétition (schéma 71, 87 607 offres, 127.0.0.1:32805) ; pour la production, la séquence est migration puis déploiement, sur go explicite (lot 12).

**Legacy et documentation.** Rien de supprimé côté backend : l’export public plafonné à 500 reste en place jusqu’au lot 12 (le site en dépend encore). Documentation : `docs/architecture/recherche-marche.md` (section « Deux origines »), `docs/architecture/production-foundations.md` (tableau §1, « État au lot 6B » en §3), `apps/aggregator/README.md` (commande `direct-sync`), `.env.example` (`CATALOGUE_FLUX_URL`, `CATALOGUE_FLUX_KEY`), `.env.example` du backend (`CATALOGUE_FLUX_KEY`).

**Limites.** Pas de rapprochement de doublons entre une offre directe et sa représentation agrégée (les deux sont servies) ; les offres directes n’ont ni code métier de la taxonomie (facette `metier` : « non classée »), ni groupe, ni domaine de Maison ; la fréquence de consommation du flux — donc le délai entre une publication sur Catwalks et son apparition dans le moteur — est une décision d’exploitation ouverte (D-423), aucun cron n’est posé ; la pagination reste par page bornée (pas de curseur lié à la version du catalogue) ; les libellés d’emploi restent français (lot 8) ; le site (6C) n’expose pas encore `origine`, `candidature`, `filtresRefuses` ni le contrat de facettes.

**Cartes à trancher (CEO).** Le délai de rafraîchissement des offres directes (D-423) ; l’exposition de la facette `pays` sur DE et GB (périmètres à deux pays, décidée en 6A par défaut) ; la présentation des offres non confirmées (D-435, proposition non validée) ; le nettoyage du disque de la machine de vérification (100 % occupé : `backups/lot4-20260909` 64 Go, images Docker 40 Go dont 10 Go orphelines, caches 26 Go).

**Prochaine étape.** 6C — le site consomme `GET /api/marches` et le contrat de facettes, exige un périmètre à l’écran, affiche `filtresRefuses` et `correspondance`, branche `candidature` (Catwalks → `PostulerButton`/`PostulerModal`, externe → lien), supprime `FACETTES_AMONT`, `FACETTES_SITE`, `libelles-marche.ts`, `CLE_AMONT`, `champs=liste` et les témoins de parité.

## Bilan 6C — le site candidat consomme le contrat

**Validé localement le 16 septembre 2026. Aucune production touchée : ni Vercel, ni Neon, ni Railway. Aucun push. Le dépôt du site n’est pas committé (production protégée par défaut ; voir « État des dépôts »).**

**Périmètre.** Site candidat (`catwalks-front-end`, branche `front-f1-sauvegarde`) : `/emplois`, `/emplois/[slug-id]`, `/emplois/maisons`, `/api/emplois/*`, accueil (compteur), header (sélecteur de marché), parcours de candidature (type resserré). Règles du contrat 1 à 12 côté écran ; critères de sortie « aucun lecteur manuel de registre côté site », « contrats website », « témoins d’exécution ».

**Problème corrigé.** Le site portait trois registres recopiés à la main (marchés, facettes par marché, libellés natifs), gardés par des témoins de parité qui rougissaient après coup ; il traduisait les clés de filtre vers d’anciennes clés techniques (`CLE_AMONT`), demandait une projection `champs=liste`, déduisait le mode de candidature d’une clé de source (`sources.includes("catwalks")`), affichait le total mondial comme contexte, servait une recherche mondiale par défaut et perdait le marché choisi au premier « Rechercher » (le formulaire n’émettait que `q` et `lieu`). Désormais :

- **Aucun registre local.** `lireMarches()` lit `GET /api/marches` ; `marche.ts` raisonne sur le contrat reçu (`marcheParCode`, `marcheSuggere`, `resoudreMarche`, `localeDuMarche`) ; `FACETTES_AMONT`, `FACETTES_SITE`, `libelles-marche.ts`, `CLE_AMONT`, `champs=liste`, la clé `statut`, « Tous les marchés » et les trois témoins de parité sont supprimés.
- **Périmètre obligatoire à l’écran.** URL → suggestion du pays du visiteur → invite `ChoixMarche` (douze marchés, comptes réels) ; code inconnu → invite ; contrat indisponible → état d’erreur ; jamais une recherche mondiale. Les liens ne portent que le marché choisi ; la barre le porte en champ caché ; la suggestion n’est jamais écrite (D-433). Même résolution dans les routes du chargement continu et des suggestions (400 `MARCHE_REQUIS` sans périmètre).
- **Contrat de facettes servi.** `FiltresFacettes` rend les facettes dans l’ordre et la langue de l’API ; `FiltresRefuses` nomme chaque refus avec le geste pour le retirer ; le titre ne nomme pas un lieu refusé ; le contexte est `totalPerimetre` · nom du périmètre ; une ligne discrète compte les non confirmées (D-435).
- **Deux origines et candidature explicite.** Étiquette « Candidature sur Catwalks » sur la carte et les similaires ; `candidature.type` pilote la fiche : `CATWALKS` → `PostulerButton`/`PostulerModal` avec le type `OffreCandidature` (identifiant backend, slug, titre, lieu, Maison), `EXTERNE` → lien http(s) en nouvel onglet, `AUCUNE` → note ; identifiants `cw_` traversant les pages et le proxy de fiche.
- **Suggestions et annuaire dans le périmètre.** Sans marché, aucune suggestion ; les noms de pays proposés sont bornés au périmètre (règle 4 ; l’« arbitrage ouvert » du Pakistan tombe avec elle) ; `type=company` accepté ; l’annuaire lit `facettes`, porte le marché dans ses liens, montre une Maison directe seule (`cw_`) ; le compteur d’accueil vient du contrat.

**Preuves.**

- `npx tsc --noEmit` : 0 erreur. `npx vitest run` : 63 fichiers, 726 tests verts (témoins réécrits sur un contrat témoin partagé : `api-d417`, `suggest-villes-marche`, `marche-d433`, `selecteur-marche-d433`, `libelles-natifs-rendu`, `fiche-emploi-d418`, `filtres-d418`, `emploi-card-d417`, `page-retrait`, `langue`). `NEXT_DIST_DIR=.next-verif npm run build` vert (93 pages), reconstruit après la dernière retouche du titre.
- **Chaîne réelle, de bout en bout, sur des bases jetables** (journaux `lot6c-*.log`) : backend jetable démarré sur sa base de test avec quatre offres semées (trois en ligne FR/FR/US, une hors ligne) → `GET /api/catalogue/flux` sert huit événements (401 sans clé) → `direct-sync` de l’agrégateur : 8 événements, 3 appliqués, 5 inconnus (retraits d’offres jamais vues), curseur 8 ; rejeu depuis 0 : 8 déjà vus, 0 réécrit → API de vérification : `/api/marches` compte les directes, `/api/jobs?marche=FR&maison=…` rend les deux offres Catwalks en tête avec `candidature CATWALKS`, la fiche `cw_` est active, `/api/suggest?type=company` propose la Maison directe. La même consommation a été rejouée sur le clone de répétition (3 offres directes appliquées, tables remises à zéro ensuite).
- [30 constats en navigateur réel](preuves/lot-6c-navigateur.json) (Playwright, Chromium, 1440 px puis 375 px, captures privées dans `backups/reprise-20260916-lot6/6c-captures/`), tous verts : invite sans marché (douze marchés), marché inconnu, filtres FR libellés, contexte du périmètre, sélecteur, deux offres Catwalks étiquetées et fiche avec bouton Postuler sans lien externe, lien `cw_` gardant le marché, deux refus nommés sur US (contrat, lieu France) et titre sans le lieu refusé, « Dienstverband » sur NL, ligne des non confirmées, annuaire avec la Maison directe, compteur d’accueil, suggestions FR / vides sans marché, page 2 du chargement continu, 400 sans périmètre, aucune erreur JavaScript, visiteur autrichien servi sur DE sans marché écrit dans les liens, mobile 375 px sans débordement horizontal, retour vers la liste, bouton Postuler visible et ≥ 44 px.
- Vu et corrigé pendant la campagne : le titre nommait un lieu refusé (« 3 offres · France » sur le marché américain) ; témoin unitaire et constat navigateur ajoutés.

**État des dépôts et des données.**

- Site : **non committé** (production Vercel protégée par défaut, aucun `go`). Trente-trois fichiers modifiés, quatre ajoutés, quatre supprimés, sauvegardés hors Git avec empreintes et diffs (`backups/reprise-20260916-lot6/website-6c/manifest.json`). Les fichiers non committés du propriétaire (`next.config.mjs`, trois pages légales, `src/components/legal/`, `src/lib/langue/legal/`, `legal.test.ts`) sont intacts (empreintes dans le même manifeste et dans `website-6c-before/`). Deux témoins portaient une retouche non committée du propriétaire (un commentaire chacun) : `marches-parite-amont.test.ts` est supprimé avec le registre qu’il gardait, `suggest-villes-marche.test.ts` est réécrit pour le contrat du lot 6 ; leurs versions du propriétaire et leurs diffs sont dans `website-6c-before/`. `tsconfig.json`, modifié automatiquement par le serveur de développement de vérification (répertoire de build dédié), a été restauré à l’identique.
- Agrégateur : documentation et preuves committées (reçu `6c-post-commit.json`).
- Bases : les semis du contrôle (base jetable A, base jetable backend) sont retirés ; les tables `DirectOffer`, `DirectOfferEvent`, `DirectFeedCursor` du clone de répétition sont revenues à zéro (87 607 offres, 71 migrations, intact). Mesuré au passage, en lecture seule : **32 131 publications vivantes sur 84 966 (38 %) du clone n’ont pas de présentation reconstruite** ; l’API refuse par conception une ligne sans présentation (`PUBLICATION_PRESENTATION_REBUILD_REQUIRED`), donc une recherche pleine sur ce clone répond 503 — c’est la reprise du stock « avant bascule » déjà prévue, pas un défaut du lot 6, et une condition bloquante de la mise en production.

**Legacy supprimé et documentation.** Voir « Problème corrigé » (registres, traduction de clés, projection, déduction de candidature, témoins de parité). Documentation : `docs/architecture/recherche-marche.md` (section « Le site candidat »), `docs/architecture/production-foundations.md` (tableau §1, « État au lot 6C » en §4).

**Limites.** Le site n’est ni committé ni déployé ; `/offres` (lecture directe de Neon) reste le second circuit jusqu’au lot 12 ; libellés d’interface français hors des libellés de facettes (lot 8) ; l’invite ne liste que les marchés mesurés (les autres pays servis restent atteignables par l’URL ou la suggestion) ; un pays servi seul est nommé en français ; pas d’adresses `{pays}.catwalks.io` ni de mémorisation du choix (§4 des fondations) ; la présentation des non confirmées (ligne discrète, étiquette sur la carte) reste une proposition.

**Cartes à trancher (CEO).** Graver ou non le marché SUGGÉRÉ dans l’URL à la première recherche soumise (aujourd’hui : seul le marché choisi voyage ; un lien copié depuis une page suggérée reste « neutre ») ; présentation des non confirmées (D-435) ; facette `pays` sur DE et GB ; délai de rafraîchissement des offres directes (D-423) ; adresses nationales et mémorisation du choix (§4) ; nettoyage du disque de la machine de vérification.

**Prochaine étape.** Lot 7 (pertinence et performance), après ce bilan.

## Conclusion du lot 6

| Critère de sortie | État |
|---|---|
| Témoins d’exécution sur base réelle (marchés, Paris Texas/France, France en contexte US, code postal, BE/FR, télétravail, code inconnu, changement de marché, deux origines sous les mêmes filtres, plus de 500 offres directes, événements dupliqués/désordonnés/rejoués, cohérence totaux/facettes/pages) | Faits : `perimetre-marche` (18), `origines-directes` (12), `feed` (9, 1 203 événements), contrôle navigateur (30) |
| Contre-épreuves détectées et restaurées | 12 (6A) + 18 (6B), restauration à l’octet près |
| Un seul chemin SQL, aucun lecteur manuel de registre côté site, aucun code sans appelant | Fait (`whereClause` et les registres du site supprimés ; chaque module nouveau a son appelant) |
| Documentation : contrat, contrats backend et website, bilans | Faite (`recherche-marche.md`, `production-foundations.md`, ce dossier) |
| Aucune production touchée ; migrations rejouées sur base neuve et sur le clone ; push agrégateur seulement après ce bilan | Aucune production touchée ; migration 71 rejouée sur la base jetable et sur le clone ; migration backend rejouée sur une base neuve seulement (pas de clone Neon) ; **aucun push** (aucun `go`) |

**Ce que le lot 6 ne dit pas.** Aucune source n’est certifiée ni autorisée en production par ce lot ; le backend et le site restent non committés ; la reprise du stock (présentations) conditionne toute bascule ; la base catalogue Railway est 27 migrations derrière la branche ; le déploiement suit l’ordre backend → agrégateur → site, sur `go` explicite, hors de ce lot.
