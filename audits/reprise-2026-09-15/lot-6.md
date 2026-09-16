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
