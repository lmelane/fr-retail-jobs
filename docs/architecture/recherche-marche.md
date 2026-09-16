# Recherche bornée par marché — contrat de l’API de lecture

Ce document décrit ce que `apps/api` fait depuis le lot 6 (septembre 2026) : un périmètre obligatoire, un seul chemin SQL, un contrat de facettes servi par le registre, des refus explicites et des offres non confirmées nommées. Le code fait foi ; ce document renvoie aux modules qui l’implémentent.

## Le périmètre

- `GET /api/jobs`, `GET /api/suggest` et `GET /api/companies` exigent `marche` (`market` reste lu). Sans code, ou avec un code mal formé ou inconnu, la réponse est `400 { error: 'MARCHE_REQUIS' | 'MARCHE_INCONNU', marches: [...] }`. Il n’existe aucun repli mondial (`lib/perimetre.ts`).
- Un périmètre est un ensemble de pays (`packages/db/marches.ts`, `perimetreDeRecherche`). Un marché mesuré du registre porte son périmètre (`DE` sert DE et AT, `GB` sert GB et IE), ses langues de service, ses facettes natives et leurs libellés. Tout autre code ISO 3166-1 connu (`lib/intelligence/country-ids.ts`) est un périmètre d’un seul pays servi sans facettes natives : le stock hors des douze marchés reste atteignable.
- Le SQL borne tout sur `Job.countryCode IN (périmètre)` (`lib/job-search-query.ts`). Mesuré le 16/09/2026 sur le clone : `countryCode` est ISO-2 sur 100 % des offres publiables et cohérent avec `isFrance` ; le drapeau n’est plus lu par la recherche.
- Une offre sans `countryCode` n’appartient à aucun périmètre. Elle reste servie par son identifiant (`/api/offres/[id]`, `/api/offre-status/[id]`) et comptée dans `catalogue.sansPays` de `GET /api/marches`.
- Le télétravail est un mode de travail (`workplaceType = REMOTE`) demandé dans le champ lieu et borné par le pays de l’offre. Aucun droit de recrutement mondial n’est déduit de « remote ».
- Multi-localisation : le catalogue projette une seule localisation par offre (`countryCode`, `city`, `adminArea1`, `postalCode`) ; les localisations natives déclarées restent dans `JobSource.sourceFacts.locations`. Une publication multi-pays n’est servie que dans le pays projeté. Servir une offre dans plusieurs périmètres exigerait une localisation par pays : hors de ce lot, documenté comme limite.

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
- Ordre : origine, confirmées avant non confirmées, pays prioritaire du visiteur s’il appartient au périmètre (D-419 §2), fraîcheur, identifiant.

## Le contrat de facettes

- `facettes` est une liste ordonnée `{ cle, libelle, options: [{ value, label, count }] }` calculée pour le périmètre (`facettesContrat` du registre, `lib/facettes.ts`). Les dimensions mesurées suivent le seuil et le libellé natif du registre ; les facettes du site (`secteur`, `ville`, `maison`, `groupe`, `langue`, et `pays` sur BE, CA, DE, GB) portent leurs libellés natifs. Hors marché mesuré, les libellés génériques français servent.
- Les comptes d’une facette excluent sa propre sélection et incluent toutes les autres dimensions ; les options à zéro ne sont pas servies.
- Les libellés d’options de pays et de langue suivent la langue de service du marché (`Intl.DisplayNames`). Limite connue, lot 8 : les libellés d’emploi des lignes et des options (« CDI », « Temps plein ») restent français.
- `GET /api/marches` sert le registre complet (`version`, marchés avec périmètre, langues et facettes) et un compteur du catalogue lu en direct (D-429), mémorisé deux minutes : `offresPubliables`, `autresPays` avec leurs volumes, `sansPays`.

## Ce qui a été retiré au lot 6

`whereClause` (second chemin Prisma aux sémantiques divergentes), `countryCondition` et `rawValuesForCode`, la facette `sources` et le filtre `source`, le filtre `fonction`, le paramètre `champs=liste` (la liste est la seule projection), les fonctions sans appelant depuis D-420 (`landingStats`, `sitemap*`, `getCompanyBySlug`, `getJob`), et `lib/facettes-marche.ts` remplacé par le contrat du registre.

## Témoins

`lib/__tests__/perimetre-marche.test.ts` (base réelle : contre-épreuve de `marche=US → total mondial`, FR/US/BE/CN/DE+AT/GB+IE/JP, Paris Texas contre Paris France, France tapée en contexte US, code postal, BE/FR, télétravail, inconnues D-435, facettes excluant leur sélection, refus, cohérence totaux/facettes/pages, annuaire, contrat des marchés), `search-plan.test.ts`, `contrat-marches.test.ts`, `suggest-villes-marche.test.ts`, `lieu-f1.test.ts`, `filtres-multiples-d426.test.ts`, `jobs-database.test.ts`, `expiry-database.test.ts`.
