# Recherche bornée par marché — contrat de l’API de lecture

Ce document décrit ce que `apps/api` fait depuis le lot 6 (septembre 2026) : un périmètre obligatoire, un seul chemin SQL, deux origines unies avant filtres, tri et pagination, un contrat de facettes servi par le registre, des refus explicites et des offres non confirmées nommées. Le code fait foi ; ce document renvoie aux modules qui l’implémentent.

## Le périmètre

- `GET /api/jobs`, `GET /api/suggest` et `GET /api/companies` exigent `marche` (`market` reste lu). Sans code, ou avec un code mal formé ou inconnu, la réponse est `400 { error: 'MARCHE_REQUIS' | 'MARCHE_INCONNU', marches: [...] }`. Il n’existe aucun repli mondial (`lib/perimetre.ts`).
- Un périmètre est un ensemble de pays (`packages/db/marches.ts`, `perimetreDeRecherche`). Un marché mesuré du registre porte son périmètre (`DE` sert DE et AT, `GB` sert GB et IE), ses langues de service, ses facettes natives et leurs libellés. Tout autre code ISO 3166-1 connu (`lib/intelligence/country-ids.ts`) est un périmètre d’un seul pays servi sans facettes natives : le stock hors des douze marchés reste atteignable.
- Le SQL borne tout sur `Job.countryCode IN (périmètre)` (`lib/job-search-query.ts`). Mesuré le 16/09/2026 sur le clone : `countryCode` est ISO-2 sur 100 % des offres publiables et cohérent avec `isFrance` ; le drapeau n’est plus lu par la recherche.
- Une offre sans `countryCode` n’appartient à aucun périmètre. Elle reste servie par son identifiant (`/api/offres/[id]`, `/api/offre-status/[id]`) et comptée dans `catalogue.sansPays` de `GET /api/marches`.
- Le télétravail est un mode de travail (`workplaceType = REMOTE`) demandé dans le champ lieu et borné par le pays de l’offre. Aucun droit de recrutement mondial n’est déduit de « remote ».
- Multi-localisation : le catalogue projette une seule localisation par offre (`countryCode`, `city`, `adminArea1`, `postalCode`) ; les localisations natives déclarées restent dans `JobSource.sourceFacts.locations`. Une publication multi-pays n’est servie que dans le pays projeté. Servir une offre dans plusieurs périmètres exigerait une localisation par pays : hors de ce lot, documenté comme limite.

## Deux origines, une recherche (D-418, D-419, D-423)

- **Origine directe.** Les offres publiées sur Catwalks par une Maison sont lues depuis `DirectOffer` (`packages/db/prisma/schema.prisma`), une copie de lecture alimentée par le flux d’outbox du backend Catwalks ; Neon reste la vérité. Chaque ligne conserve le contrat reçu entier (`payload`, haché) et projette les colonnes du vocabulaire commun (`countryCode`, `city`, `postalCode`, `employmentTerm`, `workTime`, `programType`, `engagementType`, `workplaceType`, `sectorCodes`, `language`, `searchText`…) reconstruites à chaque version (`apps/aggregator/src/direct/projection.ts`, vocabulaire versionné dans `vocabulaire.ts`).
- **Espace d’identifiants distinct.** Une offre directe est publique sous `cw_<id backend>` (`lib/direct-offers.ts`). `/api/offres/[param]` et `/api/offre-status/[param]` la résolvent dans cet espace ; une offre retirée par le backend ou échue est « fermée » (410), jamais « retirée » au sens d’un retrait de catalogue.
- **Publiable.** Une offre directe entre dans la population servie quand le backend la dit publiée (`eligible`) et que son échéance (`validThrough`) n’est pas passée ; elle appartient au périmètre de son `countryCode`, comme une offre agrégée. Sans pays, elle n’entre dans aucun marché et reste servie par identifiant.
- **Union avant tout.** La CTE `base` de `lib/job-search-query.ts` est l’`UNION ALL` des deux origines dans le périmètre, avec le texte et le lieu ; les filtres, les facettes, les totaux, l’ordre et la pagination s’appliquent ensuite à cette population unique. `totalPerimetre`, les facettes, `GET /api/marches`, les suggestions (`lib/suggestions.ts`) et l’annuaire (`lib/companies.ts`) comptent les deux origines ; dans l’annuaire, une Maison directe que le registre connaît par son nom rejoint sa ligne agrégée, une Maison directe inconnue du registre a sa ligne `cw_<slug>`.
- **Ordre.** Les offres Catwalks passent en tête des résultats qui les contiennent (D-419 §1) ; la priorité ne sort jamais une offre du périmètre ni des filtres.
- **Chaque ligne dit son origine et son action.** `origine: 'CATWALKS' | 'AGREGEE'` ; `candidature: { type: 'CATWALKS', offreId, slug, url } | { type: 'EXTERNE', url } | { type: 'AUCUNE' }` (`lib/jobs.ts`). Rien ne se déduit d’un domaine ni d’une forme d’identifiant. Les similaires d’une offre placent les offres Catwalks de la même Maison, dans le même pays, avant les agrégées ; le bloc Maison d’une fiche compte les deux origines.
- **Le flux et son consommateur.** Le backend écrit `catalogue_outbox` par déclencheurs SQL sur toute écriture de `jobs` (version monotone par offre, retrait tracé, suppression tracée) et le sert par `GET /api/catalogue/flux?depuis=&limite=` sous clé partagée. L’agrégateur le consomme par `tsx src/cli.ts direct-sync` (`apps/aggregator/src/direct/feed.ts`) : lecture stricte du contrat version 1 (`contrat.ts`, refus nommé par chemin), une transaction par événement, séquence déjà vue ignorée, version inférieure ou égale ignorée (aucune résurrection), `RETIRE` conservant la dernière projection, trace immuable `DirectOfferEvent`, curseur `DirectFeedCursor` avec la dernière erreur. `CATALOGUE_FLUX_URL` et `CATALOGUE_FLUX_KEY` viennent de l’environnement.
- **Limites connues.** Les offres directes ne portent ni code métier de la taxonomie (facette `metier` : « non classée ») ni groupe ni domaine de Maison ; aucun rapprochement de doublon entre une offre directe et une représentation agrégée n’est tenté (les deux restent servies) ; la fréquence de consommation du flux (délai de rafraîchissement) est une décision d’exploitation ouverte (D-423) ; la copie n’est alimentée par aucune production tant que le backend n’a pas déployé sa migration et son flux.

## Le champ lieu

`lib/lieu.ts` résout ce que la personne tape, sans connaître le périmètre ; `lib/search-plan.ts` applique le périmètre :

| Saisie | Résolution | Dans le SQL |
|---|---|---|
| `télétravail`, `remote`, `home office`… | télétravail | `workplaceType = 'REMOTE'` |
| `75008`, `SW1A 1AA`, `H2Y 1C6`, `1012 AB` | code postal, chaîne conservée | préfixe sur `postalCode` sans espaces |
| code ISO-2 ou nom de pays | pays | honoré seulement s’il appartient au périmètre ; sinon refusé (`LIEU_HORS_MARCHE`) |
| tout le reste (`Paris`, `Texas`, `Paris 8`) | lieu large | ville en égalité ou préfixe, libellé contenant, ou `adminArea1` en égalité |

`lieu` dans la réponse dit ce que le moteur a compris (type et libellé), même refusé.

## Filtres, refus, inconnues

- Clés d’URL : `pays`, `metier`, `secteur`, `contrat`, `temps`, `programme`, `ville`, `maison`, `groupe`, `langue`, toutes multi-valeurs (D-426). Les clés techniques `employmentTerm`, `workTime`, `programType` restent lues.
- ET entre dimensions, OU entre les valeurs d’une dimension (`planifierRecherche`, `restriction`).
- Un filtre sur une facette que le périmètre ne sert pas, ou une valeur de `pays` hors périmètre, est refusé : il figure dans `filtresRefuses` (`{ cle, valeurs, motif }`) et les résultats sont calculés sans lui. Rien n’est réinterprété en silence.
- Dimensions tolérantes (`contrat`, `temps`, `programme`, `langue`, D-435) : une offre non renseignée reste servie et marquée `correspondance: { statut: 'NON_CONFIRMEE', dimensions }` ; `total` compte toutes les offres servies, `totalConfirmes` celles dont chaque dimension tolérante filtrée est renseignée. Une valeur renseignée hors sélection exclut toujours.
- Ordre : origine (Catwalks d’abord), confirmées avant non confirmées, pays prioritaire du visiteur s’il appartient au périmètre (D-419 §2), fraîcheur, identifiant.

## Le contrat de facettes

- `facettes` est une liste ordonnée `{ cle, libelle, options: [{ value, label, count }] }` calculée pour le périmètre (`facettesContrat` du registre, `lib/facettes.ts`). Les dimensions mesurées suivent le seuil et le libellé natif du registre ; les facettes du site (`secteur`, `ville`, `maison`, `groupe`, `langue`, et `pays` sur BE, CA, DE, GB) portent leurs libellés natifs. Hors marché mesuré, les libellés génériques français servent.
- Les comptes d’une facette excluent sa propre sélection et incluent toutes les autres dimensions ; les options à zéro ne sont pas servies.
- Les libellés d’options de pays et de langue suivent la langue de service du marché (`Intl.DisplayNames`). Limite connue, lot 8 : les libellés d’emploi des lignes et des options (« CDI », « Temps plein ») restent français.
- `GET /api/marches` sert le registre complet (`version`, marchés avec périmètre, langues et facettes) et un compteur du catalogue lu en direct (D-429), mémorisé deux minutes : `offresPubliables`, `autresPays` avec leurs volumes, `sansPays`.

## Ce qui a été retiré au lot 6

`whereClause` (second chemin Prisma aux sémantiques divergentes), `countryCondition` et `rawValuesForCode`, la facette `sources` et le filtre `source`, le filtre `fonction`, le paramètre `champs=liste` (la liste est la seule projection), les fonctions sans appelant depuis D-420 (`landingStats`, `sitemap*`, `getCompanyBySlug`, `getJob`), et `lib/facettes-marche.ts` remplacé par le contrat du registre.

## Témoins

`lib/__tests__/perimetre-marche.test.ts` (base réelle : contre-épreuve de `marche=US → total mondial`, FR/US/BE/CN/DE+AT/GB+IE/JP, Paris Texas contre Paris France, France tapée en contexte US, code postal, BE/FR, télétravail, inconnues D-435, facettes excluant leur sélection, refus, cohérence totaux/facettes/pages, annuaire, contrat des marchés), `lib/__tests__/origines-directes.test.ts` (base réelle : deux origines sous les mêmes filtres, Catwalks d’abord, retirée/échue/sans pays exclues, `NON_CONFIRMEE` sur les deux origines, texte et lieu, facettes, fiche/statut/similaires/bloc Maison en `cw_`, suggestions, contrat des marchés, annuaire fusionné), `search-plan.test.ts`, `contrat-marches.test.ts`, `suggest-villes-marche.test.ts`, `lieu-f1.test.ts`, `filtres-multiples-d426.test.ts`, `jobs-database.test.ts`, `expiry-database.test.ts`. Côté agrégateur : `src/direct/contrat.test.ts`, `vocabulaire.test.ts`, `projection.test.ts` et `feed.test.ts` (base réelle : 1 203 événements sur quatre lectures, rejeu, désordre de versions, retrait sans résurrection, retrait inconnu, refus de contrat par page, panne HTTP nommée, reprise depuis le curseur).
