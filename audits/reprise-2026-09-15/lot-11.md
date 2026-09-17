# Lot 11 — Journal : traduction anglaise durable, clos localement

Bilan daté du **16 septembre 2026**. Dépôt M (`catwalksmedia`, `main`, HEAD `086f75c` à l’ouverture), local seulement : **rien n’est déployé, rien n’est écrit en production media** (périmètre protégé, passation §17.1). Le dépôt agrégateur ne porte que ce bilan.

## État avant, mesuré

- **Production media, lecture seule (canal `railway ssh`, requêtes `SELECT`, 16/09 vers 16 h 30)** : 151 articles FR publiés ; 60 traductions EN publiées, toutes du moteur `tr1.0` ; 22 traductions en échec ; 69 articles sans aucune traduction ; 0 périmée. L’équation demandée par la passation se vérifie : **151 = 60 à jour + 69 manquantes + 22 en échec**. Les chiffres du 15 septembre (142 / 60 / 22 / 60) ne sont plus l’état courant : neuf publications de plus, toutes sans anglais, parce que **la console déployée n’appelle pas le moteur** (le code d’appel n’existe que localement).
- **Motifs des 22 échecs (production)** : 16 « nom propre absent » (le nom exigé commençait par un mot de tête de phrase : « Chez Louis V… », « Avant Zaland… », « Outre Neal T… », « Baptisées Co… », « C’est Ja Mor… », « Côté Marquee »…), 4 « citation altérée », 2 « corps toujours en français ».
- **Arbre de travail local de M** : le lot 25 (moteur `translate-article.mjs`, règles pures `translation-rules.mjs`, migration 025 additive, rattrapage `traduire:stock`, garde `verif:parite-traduction`, pages `/en/…` du front, 58 témoins purs) était entièrement non versionné ; migration 025 déjà appliquée en production (constat de la passation, non re-vérifié ici autrement que par les lignes `journal_article_translations` lues).
- **Suite newsroom sur cet arbre, avant toute modification** : 695 témoins, 630 verts, **53 rouges préexistants** (sections 13 signature d’événement et 14 topicing, sans base locale) ; site du Journal : 57 verts, **1 rouge préexistant** (`slugs-remplaces` : l’entrée `…-defiles-900000` du 7 septembre porte une raison sans mesure).

## Ce que le lot ferme, vérifié dans le code puis par l’exécution

| Point de la passation | État trouvé | Fait |
|---|---|---|
| Traduction durable à chaque publication | Appel non bloquant dans `publishArticleV2`, plafond 45 s, échec tracé `FAILED` (témoins 5a-5f) | Conservé ; c’est le chemin contrôlé, absent de la console déployée |
| Modification d’un article publié | Impossible par la console (`PATCH` et visuel refusés hors `DRAFT`/`READY`) ; le seul chemin est dépublier → modifier → republier, qui retraduit | Vérifié dans `console-server.mjs`, rien à changer |
| Retries bornés | `anthropic.mjs` : tentatives bornées (`MAX_ATTEMPTS` + 6 en surcharge, une reprise de troncature) | Conservé |
| Annulation / délais | Le plafond de l’appelant laissait l’appel modèle courir sans limite propre (délai SDK de dix minutes par tentative) | **`DELAI_APPEL_MODELE_MS`** (180 s, `TRADUCTION_APPEL_TIMEOUT_MS`) transmis au client (`{ timeout }` sur `create` et `stream`) ; témoin 9l |
| Empreinte couvrant tous les champs traduits | `empreinteSource` ignorait le visuel (`hero_alt`, `hero_caption`), traduits eux aussi | **Empreinte versionnée** : `tr1.1` inclut le visuel ; `tr1.0` reste lue avec l’ancienne formule, donc les 60 traductions en production restent valides ; séparateur NUL conservé ; témoins 9f-9i |
| Statut d’une ancienne EN périmée | L’API publique servait une traduction `PUBLISHED` quel que soit son FR | **Jointure sur l’empreinte** (`EMPREINTE_SQL_SELON_VERSION`, jumeau SQL prouvé octet pour octet sur une base jetable pour les deux versions, concaténation `bytea` avec octet zéro) : une EN périmée n’est plus servie (liste, détail, hreflang) jusqu’au rattrapage ; témoins 9j-9k |
| Slug et liens réciproques | Slug EN distinct et systématique, hreflang réciproque seulement si la traduction existe (témoins 3, 6g, 6h) | Conservé |
| Absence honnête de traduction | Aucun hreflang EN sans traduction, liste EN restreinte aux traduites (6h, 6k) | Conservé |
| Reprise après interruption | `traduire:stock` idempotent, distingue périmées et manquantes (7b, 8e) | Conservé, rendu version-aware |
| D-319 contre citation littérale | Le filet remplaçait le cadratin **dans** une citation reproduite, la citation devenait « altérée » et la traduction refusée | **La citation prime** : filet et garde D-319 s’arrêtent aux guillemets « » et “ ” ; un cadratin cité reste, un cadratin hors citation reste interdit ; témoins 9a-9e |
| Faux « nom propre absent » | Le candidat gardait le mot de tête de phrase collé au nom (« Chez Louis Vuitton ») | **Les mots de tête de phrase tombent un à un** (liste fermée mesurée sur les 16 échecs) ; témoins 9m-9o |

Preuves : `tests/54-traduction-en.test.mjs` 73 témoins verts (58 + 15) ; suite newsroom 710 témoins, 645 verts, les **mêmes 53 rouges** qu’avant (aucune régression, diff des échecs vide) ; site du Journal inchangé par ce lot.

## Rattrapage prêt, non exécuté

`npm run traduire:stock` (estimation seule, lecture seule) : **91 articles à traiter, ~1,73 USD**. L’exécution (`-- --executer`) écrit en production media et appelle le modèle : **périmètre protégé, non lancé**. Ordre de livraison qui reste à autoriser : déployer newsroom (console + journal) et le front du Journal depuis le commit local, puis lancer le rattrapage, puis `npm run verif:parite-traduction` doit rendre vert (151 = 151 + 0).

## Versionné localement

Commit local `a916ac2` sur `main` de M (25 fichiers, aucun push) : les fichiers du lot 25 et de ce lot (moteur, règles, client, serveurs, migration 025, scripts de rattrapage et de parité, témoins, pages `/en/`, composants et types du front). Laissés hors commit parce qu’étrangers au lot : `scripts/shadow-search-intent-radar.mjs` (taxonomie du radar), `PATRON-ARTICLE-EVENEMENTIEL.md`, `redactions/`, `scripts/temoin-pfw-publication-anticipee-2026-09-07.mjs`.

## Limites et écarts ouverts

- La production media n’a **ni le moteur ni le filtre de péremption** : les 60 EN servies le sont sans vérification d’empreinte, et chaque nouvelle publication FR reste sans anglais tant que la console n’est pas redéployée.
- Les 53 rouges préexistants de la suite newsroom (sections 13 et 14) et le rouge du site (`slugs-remplaces`, entrée du 7 septembre) sont **hors lot**, non corrigés, à traiter par leur propriétaire : question d’environnement pour les premiers (base locale absente), donnée éditoriale sans mesure pour le second.
- « Absolue Longévité », « Paris Fashion Week Printemps », « Win Care » : des refus de production que la liste de mots de tête ne concerne pas ; leur cause exacte se lira sur la sortie du modèle au rattrapage, pas ici.
- Le FR lui-même n’a pas de garde D-319 dans `publish-gates.mjs` : un cadratin cité en français passe, et l’anglais le reproduit désormais tel quel — c’est la résolution retenue (citation littérale), à confirmer par le CEO si D-319 devait aussi s’appliquer aux citations.
