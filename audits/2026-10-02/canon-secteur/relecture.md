# Relecture manuelle des propositions (02/10/2026)

Les 60 plus grosses propositions de `apercu-secteurs.json`, relues une à une contre ce que l’on sait de la société et la preuve citée. Verdict : ✓ juste ; ~ juste mais partiel ou à surveiller ; ✗ refusée (inscrite dans `REFUSED_AT_REVIEW`, `apps/aggregator/src/sectors/recognize.ts`).

| Offres | Société | Secteurs | Preuve | Verdict |
|---:|---|---|---|---|
| 494 | Kiabi | FASHION+RETAIL | native:industry ; native:sectors | ✓ |
| 434 | MAC | BEAUTY | official | ✓ |
| 242 | ROLEX SA | WATCHMAKING | registry | ~ secteurs hérités de la Maison relue |
| 214 | Max Mara Fashion Group | FASHION | native:industry | ✓ |
| 179 | Clarkson Eyecare | EYEWEAR | official | ✓ |
| 150 | Moët Hennessy | WINES_SPIRITS | native:businessGroup | ✓ |
| 150 | Hans Anders Nederland | EYEWEAR | official | ✓ |
| 110 | CLARINS | BEAUTY | reference | ✓ |
| 109 | ONIVERSE | FASHION | native:sectors | ~ FASHION juste (Calzedonia, Intimissimi, Falconeri). |
| 95 | Eric Bompard | FASHION | native:industry | ✓ |
| 67 | L'Oréal Groupe | BEAUTY | domain ; native:sectors | ~ Groupe non détecté mais mono-secteur beauté ; deux preuves (domaine relu, WTTJ Cosmétique). |
| 67 | Histoire d'Or | JEWELRY | native:sectors | ~ JEWELRY juste ; vend aussi des montres (WATCHMAKING non prouvé). |
| 60 | Ysé | FASHION | native:sectors | ✓ |
| 55 | Diptyque paris | BEAUTY | domain ; native:sectors | ~ BEAUTY hérité de la Maison relue (domaine) ; FRAGRANCE / HOME_LIFESTYLE manquent : partiel hérité. |
| 51 | Sessùn | FASHION | native:sectors | ✓ |
| 49 | Sisley | BEAUTY | native:industry | ✓ |
| 48 | Caudalie | BEAUTY | reference | ✓ |
| 46 | Canada Goose Inc. | FASHION | registry | ~ secteurs hérités de la Maison relue |
| 41 | Sud Express | FASHION+RETAIL | native:sectors | ✓ |
| 36 | Funky Buddha | FASHION | native:industry | ✓ |
| 36 | La Prairie | BEAUTY | reference | ✓ |
| 32 | New Balance Athletic Shoes (UK) Limited | FASHION | registry | ~ secteurs hérités de la Maison relue |
| 31 | Fusalp | FASHION | native:sectors | ✓ |
| 26 | New Balance Germany GmbH | FASHION | registry | ~ secteurs hérités de la Maison relue |
| 24 | Faguo | FASHION | native:sectors | ✓ |
| 21 | Moët & Chandon | WINES_SPIRITS | native:businessGroup | ✓ |
| 20 | CABAIA | FASHION | native:sectors | ✓ |
| 19 | A.P.C. | FASHION | native:sectors | ✓ |
| 19 | HADDAD BRANDS EUROPE | FASHION+RETAIL | native:sectors | ✓ |
| 19 | NORMAL Spain | RETAIL | registry | ~ secteurs hérités de la Maison relue |
| 17 | Groupe Clarins | BEAUTY | native:sectors | ✓ |
| 16 | Canada Goose, US Inc. | FASHION | registry | ~ secteurs hérités de la Maison relue |
| 14 | Versace USA, Inc. | FASHION | registry | ~ secteurs hérités de la Maison relue |
| 13 | Chantelle | FASHION | reference | ✓ |
| 12 | LUSH | France | BEAUTY+RETAIL | native:sectors | ✓ |
| 12 | Stella McCartney Italia S.r.l | FASHION | registry | ~ secteurs hérités de la Maison relue |
| 11 | Kitsuné | FASHION | native:sectors | ✓ |
| 11 | JUNE STORE | FASHION+RETAIL | native:sectors | ✓ |
| 10 | Veuve Clicquot Ponsardin | WINES_SPIRITS | native:businessGroup | ✓ |
| 10 | FROM FUTURE | FASHION | native:sectors | ✓ |
| 10 | Bleu Libellule | BEAUTY+RETAIL | native:sectors | ✓ |
| 9 | MANUCURIST | BEAUTY | native:sectors | ✓ |
| 9 | New Balance France Retail SARL | FASHION | registry | ~ secteurs hérités de la Maison relue |
| 9 | New Balance Netherlands BV | FASHION | registry | ~ secteurs hérités de la Maison relue |
| 8 | Pied de Biche | FASHION | native:sectors | ✓ |
| 8 | The Bradery | FASHION | native:sectors | ✓ |
| 8 | Ruinart | WINES_SPIRITS | native:businessGroup | ✓ |
| 8 | Gianni Versace S.r.l. | FASHION | domain | ~ secteurs hérités de la Maison relue |
| 7 | Columbia Sportswear Company | FASHION+RETAIL | native:sectors | ✓ |
| 7 | Hindbag | FASHION | native:sectors | ✓ |
| 7 | Versace Canada | FASHION | registry | ~ secteurs hérités de la Maison relue |
| 7 | Stella McCartney Limited | FASHION | registry | ~ secteurs hérités de la Maison relue |
| 7 | New Balance Italy S.R.L. | FASHION | registry | ~ secteurs hérités de la Maison relue |
| 6 | Hennessy | WINES_SPIRITS | native:businessGroup | ✓ |
| 6 | Chandon | WINES_SPIRITS | native:businessGroup | ✓ |
| 6 | PATTERN | FASHION | native:sectors | ✓ |
| 6 | PM Studio Paris | BEAUTY+FASHION | native:sectors | ✓ |
| 6 | Prose | BEAUTY | native:sectors | ✓ |
| 6 | Canada Goose EU B.V. UK Branch | FASHION | registry | ~ secteurs hérités de la Maison relue |
| 6 | Moët Hennessy Wine Estates | WINES_SPIRITS | native:businessGroup | ✓ |

## Erreurs trouvées à la relecture (refusées, restent inconnues)

| Offres | Société | Proposé | Motif |
|---:|---|---|---|
| 10 | Passage du Desir | BEAUTY (liste de référence) | boutiques de lingerie et objets intimes, pas une Maison de beauté : la ligne de `maisons.csv` est fausse |
| 37 | Tissus des Ursules - TDU Group | FASHION+RETAIL (WTTJ) | tissus au mètre et mercerie, pas des collections de mode |
| 4 | IZIPIZI | FASHION+RETAIL (WTTJ) | lunettes : « Mode » seul la retirerait du filtre Lunetterie (D-515 §1) |
| 3 | Collector Square | FASHION (WTTJ) | revente de maroquinerie, montres et bijoux : « Mode » seul serait partiel |
| 17 | VEJA | FASHION (WTTJ) | baskets : « Mode » seul la retirerait du filtre Chaussures (ajoutée après l'audit de réconciliation) |

**Retail seul (audit de réconciliation)** : 16 sociétés, 1 648 offres (Kids Foot Locker, Reitmans, Groupe Courir, ASOS, ASICS, Eram, Galeries Lafayette…) recevaient « Retail » sans secteur de produit ; elles sortiraient des filtres Mode, Chaussures ou Beauté où, inconnues, elles resteraient « non précisé » (D-515 §1). Elles s'abstiennent désormais (`RETAIL_ONLY`).

Défaut de code trouvé pendant la relecture, corrigé avant mesure : deux champs natifs en désaccord (« Cosmetics » et WTTJ « Mode ») étaient comptés comme une seule preuve, le désaccord n’était pas vu (témoin `recognize.test.ts`).

## Abstentions relues

Les 40 plus grosses abstentions (`resultat-mesure.txt`) ne portent aucune preuve des quatre canaux : Coach, Tommy Hilfiger, Calvin Klein, Crocs, Kate Spade, Tiffany (« Watches & Jewellery », ambigu), Nike, Uniqlo… Leur site officiel a été tenté pour les plus grosses : 403 (Coach, Crocs, Tiffany, Lush, PVH), page sans produit nommé (Tapestry « lifestyle brand », about.nike.com), domaine introuvable (douglas.group). Trois pages lisibles ont donné une preuve (MAC, Clarkson Eyecare, Hans Anders). Les groupes (Richemont, Estée Lauder Companies, Kering, LVMH, SMCP, Beiersdorf…) restent inconnus par règle.
