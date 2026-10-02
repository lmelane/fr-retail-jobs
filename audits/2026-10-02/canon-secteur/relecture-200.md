# Relecture documentée des 200 premières sociétés sans secteur (02/10/2026)

Les 200 sociétés sans secteur qui portaient le plus d'offres servies (`top200-sans-secteur.tsv`, 31 256 offres, 88,1 %
des offres sans secteur) : 23 étaient déjà qualifiées par la reconnaissance automatique ; les 177 autres forment 152
Maisons (les entités d'une même marque partagent son domaine officiel). Chacune est inscrite dans
`apps/aggregator/data/reference/secteurs-relus.tsv` avec sa source (Wikipédia, site officiel, Wikidata ou presse),
l'extrait exact qui fonde le secteur et la date : **118 Maisons qualifiées, 34 laissées `INCONNU`** avec leur motif.

Règles appliquées : secteurs que la source nomme comme activité principale (les licences ne comptent pas : parfums de
Coach, chaussures de Tommy Hilfiger) ; jamais « Retail » seul ; « Mode » seul seulement si l'habillement est le seul
secteur (Nike, ASICS, On : Mode + Chaussures ; Crocs, UGG, Deckers, Camper : Chaussures) ; un grand magasin reçoit Retail
et les secteurs que la source dit qu'il vend ; un groupe multisectoriel, une activité hors vocabulaire ou un doute
restent inconnus. Les recherches ont été menées par quatre lectures parallèles ; chaque ligne retenue l'a été sur son
extrait, et l'échantillon ci-dessous a été revérifié à la source.

## INCONNU (34) et pourquoi

Groupes multisectoriels : VF Corporation, Richemont, Prada Group, LVMH, Kering, Beiersdorf, Saks Global, Chalhoub Group.
Groupes que le registre classe déjà en groupe (le code s'abstient de toute façon) : Estée Lauder Companies, Swatch Group,
SMCP, L'Occitane. Hors vocabulaire : La casa de las Carcasas (coques de téléphone), Avolta (duty free), Aptar
(emballage), PGA TOUR Superstore (golf), Salomon (équipement sportif), FIGS et MASCOT, Jonsson (vêtements de travail),
Condé Nast (média), Lectra (logiciel), Clog (logistique), Ephemera et Menus & Venues (restauration), Naturalia
(épicerie), Pepco (discount généraliste). Doute : Quince et The RealReal (aucune activité principale), Montblanc
(stylos d'abord), KULT (aucune phrase ne nomme le produit), Skin Laundry (cliniques esthétiques), B&S International
(identité non établie), Tissus des Ursules (tissus et mercerie).

## Échantillon de 40 affectations revérifiées à la source

Tirage aléatoire (graine 20261002) parmi les 118 nouvelles affectations ; chaque page a été relue et l'extrait cherché
mot pour mot. **40 extraits trouvés sur 40 ; 0 secteur contredit par la source.**

| # | Maison | Secteurs | Source | Extrait retrouvé |
|---:|---|---|---|---|
| 1 | Swarovski | JEWELRY | Wikipédia | oui |
| 2 | Breitling | WATCHMAKING | Wikipédia | oui |
| 3 | Douglas | BEAUTY, FRAGRANCE, RETAIL | Wikipédia | oui |
| 4 | Magasin du Nord | BEAUTY, FASHION, HOME_LIFESTYLE, RETAIL | VisitCopenhagen | oui |
| 5 | Veronica Beard | FASHION | CBS News | oui |
| 6 | Groupe Galeries Lafayette | FASHION, RETAIL | Wikipédia fr | oui |
| 7 | Bobbi Brown Cosmetics | BEAUTY | Wikipédia | oui |
| 8 | Camper | FOOTWEAR | Wikipédia | oui |
| 9 | MECCA | BEAUTY, RETAIL | Wikipédia | oui (« Mecca is an Australian beauty retailer. ») |
| 10 | LOFT | FASHION, RETAIL | Wikipédia (Ann Inc.) | oui, Loft nommée parmi ses divisions |
| 11 | Omega | WATCHMAKING | Wikipédia | oui |
| 12 | Boardriders | FASHION, FOOTWEAR | Wikipédia (Quiksilver) | oui, renommage en Boardriders cité |
| 13 | APM Monaco | JEWELRY, RETAIL | Wikipédia | oui, 500 boutiques |
| 14 | Cheval Blanc | HOSPITALITY | One Mile at a Time | oui |
| 15 | My Jewellery | FASHION, JEWELRY, RETAIL | site officiel | oui, boutiques |
| 16 | MS Mode | FASHION, RETAIL | Wikipédia | oui |
| 17 | Monica Vinader | JEWELRY | Wikipédia | oui |
| 18 | Everything But Water | FASHION, RETAIL | Waterside Shops | oui |
| 19 | ASICS | FASHION, FOOTWEAR | Wikipédia | oui |
| 20 | LAGER 157 | FASHION, RETAIL | Wikidata | oui |
| 21 | Tommy Hilfiger | FASHION | Wikipédia | oui |
| 22 | Singularu | JEWELRY | El Español | oui |
| 23 | Swatch | WATCHMAKING | Wikipédia | oui |
| 24 | Mulberry | FASHION, LEATHER_GOODS | Wikipédia | oui |
| 25 | Lane Bryant | FASHION, RETAIL | Wikipédia | oui |
| 26 | Suitsupply | FASHION, RETAIL | Wikipédia | oui, magasins |
| 27 | Psycho Bunny | FASHION | Wikipédia | oui |
| 28 | Orchestra | FASHION, RETAIL | Wikipédia fr | oui |
| 29 | Reitmans | FASHION, RETAIL | Wikipédia | oui |
| 30 | Deckers | FOOTWEAR | Wikipédia | oui |
| 31 | Shiseido | BEAUTY, FRAGRANCE | Wikipédia | oui |
| 32 | Uniqlo | FASHION, RETAIL | Wikipédia | oui |
| 33 | Crocs | FOOTWEAR | Wikipédia | oui |
| 34 | Soma | FASHION, RETAIL | Wikipédia (Chico's FAS) | oui |
| 35 | ETA | WATCHMAKING | Wikipédia | oui |
| 36 | Damiani | JEWELRY, WATCHMAKING | Wikipédia | oui |
| 37 | Hugo Boss | FASHION, FOOTWEAR, LEATHER_GOODS | Wikipédia | oui |
| 38 | Gorjana | JEWELRY, RETAIL | Wikipédia (fondatrice) | oui, « jewelry line » et 125 magasins |
| 39 | Foot Locker | FASHION, FOOTWEAR, RETAIL | Wikipédia | oui |
| 40 | Tiffany & Co. | JEWELRY | Wikipédia | oui |

Réserves de relecture, non bloquantes : Douglas est RETAIL au titre de « perfumery » (la phrase lue ne dit pas
« magasins ») ; Michael Kors et Dolce & Gabbana, partiels, ont été complétés après l'audit de réconciliation ; quelques sources sont secondaires (CB Insights, Shopify, annuaire de marques, blog de voyage) faute de page
Wikipédia ou de site lisible.
