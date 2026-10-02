# Canonisation du secteur des Maisons (D-519, D-515 §1) — 02/10/2026

Décisions : [[D-519]] (« canoniser suffisamment la donnée pour que les métiers, Maisons, lieux… puissent être réellement
filtrés »), [[D-515]] §1 (une donnée inconnue ne devient jamais négative). Backend, `docs/governance/DECISIONS.md`.

**État** : construit sur `development`. Rien n'est écrit en production. L'écriture (`qualify-sectors --apply`) attend
la release, sur le fichier d'aperçu relu.

## D'où vient le secteur aujourd'hui (code et données)

- **Code** : le secteur d'une offre agrégée est celui de sa société, `Company.sectorCodes` (`apps/api/lib/job-search-query.ts`,
  filtre `secteur` et facette ; `apps/api/lib/search-model.ts`). Une offre directe porte le sien (`DirectOffer.sectorCodes`).
  Aucun secteur n'est lu sur l'offre ni sur la source. `Company.sector` (enum historique, lu par motifs de nom dans
  `normalize/sector.ts`) n'est jamais un filtre. L'écriture passe uniquement par une revue relue immuable
  (`SectorReview`, triggers `validate_company_sectors` et `guard_merged_sector_memberships`).
- **Données** (`resultat-etat-avant.tsv`) : 89 800 offres servies, **35 492 sans secteur (39,5 %)** ; États-Unis 15 382
  sur 40 604 (37,9 %). 254 sociétés qualifiées sur 1 981 : 203 par la liste de référence (REFERENCE_LIST, 09/09), 51 par
  source officielle relue ; 13 revues `SectorReview`, la dernière le 24/09 (6 règles).
- **Concentration** : 868 sociétés portent les offres sans secteur ; les 10 premières 22,4 %, les 20 premières 34,9 %,
  les 50 premières 57,7 %, les 100 premières 75,2 %, les 200 premières 88,1 %.

## Ce qui est construit

`apps/aggregator/src/sectors/recognize.ts`, commande `qualify-sectors` du CLI de l'agrégateur, sur le modèle de
`attach-maisons` : `--output=<fichier>` n'écrit rien ; `--apply --plan=<fichier relu>` recalcule la reconnaissance,
refuse sans rien écrire si elle diffère du fichier (`REVIEWED_PLAN_MISMATCH`), puis écrit par `sectors/review.ts`
(une `SectorReview` immuable). Preuves, sans devinette :

| Preuve | Règle |
|---|---|
| Liste de référence | `maisons.csv`, nom canonique exact, confiance HIGH ou MEDIUM, segments Mode / Beauté / Retail seulement |
| Catégories natives | `industry` (SmartRecruiters, Workable), secteurs WTTJ de l'organisation, `businessGroup` LVMH ; vocabulaire fermé ; ≥ 25 % des publications et ≥ 3 |
| Domaine officiel | page du domaine lue à la main (3 Maisons) ; ou même domaine qu'une seule Maison relue, hors groupe, provenance du domaine connue |
| Registre des sources | rattachement R-143 §5 (`attachAll`) : une Maison et ses entités décident ensemble ; une entité reçoit les secteurs relus de sa Maison |

Abstentions : groupe (kind GROUP, parent d'une société ou nom d'un `parentGroup`), aucune preuve, preuves de produit
disjointes, « Retail » sans aucun secteur de produit (`RETAIL_ONLY`, D-515 §1 : il ferait sortir l'offre des filtres de
produit où, inconnue, elle reste « non précisé »), entité dont la Maison reste à créer (la fusion dans une ligne sans secteur échouerait), erreurs de relecture
(`REFUSED_AT_REVIEW`). Valeurs ambiguës exclues exprès : « Watches & Jewellery », « Fashion & Leather Goods »,
« Perfumes & Cosmetics », « Luxury Goods & Jewelry », « Luxe », « E-commerce », « Art de vivre ».

## Résultats (production en lecture seule, 02/10/2026 13:12-13:19 UTC ; `resultat-mesure.txt`)

| | Couverture | Inconnues |
|---|---|---|
| Avant | 60,5 % | 35 492 |
| Avant, rattachement R-143 §5 seul | 61,0 % | 34 989 |
| Après reconnaissance (et rattachement) | **64,2 %** | **32 145** |

Par marché : US 62,1 → 63,1 % ; FR 70,8 → 80,6 % ; GB 45,8 → 51,2 % ; IT 63,1 → 74,4 % ; NL 44,8 → 53,6 % ;
CH 28,6 → 50,0 % ; CA 44,6 → 48,1 % ; DE 48,1 → 49,6 %. 106 sociétés, 3 347 offres servies (preuves : native 1 863,
domaine lu 763, registre 503, liste de référence 209, héritage de domaine 131) ; abstentions : 651 sans preuve
(27 699 offres), 51 groupes (2 102), 16 « Retail » seul (1 648), 42 entités vers une Maison à créer (635, Puma),
5 refusées à la relecture (71).

Trois secteurs (confirmées / inconnues) : **Lunetterie aux États-Unis 6 / 15 382 → 185 / 14 968** ; Mode aux États-Unis
5 943 / 15 382 → 5 984 / 14 968 ; Vins & Spiritueux en France 0 / 3 946 → 87 / 2 631 ; Beauté en France
2 900 / 3 946 → 3 207 / 2 631.

**Limite honnête** : les grosses Maisons américaines (Coach, Tommy Hilfiger, Calvin Klein, Crocs, Kate Spade, Tiffany,
Nike, Uniqlo…) n'ont aucune preuve dans ces quatre canaux ; leur site refuse la lecture (403) ou ne nomme pas ses produits.
Elles restent inconnues. Relecture : `relecture.md`.

## Rejouer (jamais entre 15:30 et 18:30 UTC)

```sh
DB='python3 apps/aggregator/scripts/ops/db.py readonly sh -c'
D=audits/2026-10-02/canon-secteur
$DB 'psql "$DATABASE_URL" -X -A -F"	" -f -' < $D/etat-secteur.sql > $D/resultat-etat-avant.tsv
$DB 'psql "$DATABASE_URL" -X -A -t -q -f -' < $D/extraction-employeurs.sql > <scratch>/employeurs.jsonl
$DB 'psql "$DATABASE_URL" -X -A -t -q -f -' < $D/extraction-natives.sql > <scratch>/natives.jsonl
npx tsx $D/mesure-secteur.mts <scratch>/employeurs.jsonl <scratch>/natives.jsonl $D/apercu-secteurs.json > $D/resultat-mesure.txt
```

`categories-natives.sql` et `categories-natives-valeurs.sql` sont le recensement qui a fondé le vocabulaire.

## Release (geste de production, sous GO)

1. `qualify-sectors --output=secteurs.json` depuis l'image déployée, relire, puis `qualify-sectors --apply --plan=secteurs.json`.
2. **Ensuite seulement** un nouvel aperçu `attach-maisons` : les secteurs écrits changent ses groupes (motif
   `MAISON_LACKS_SECTORS`), un fichier relu avant l'écriture des secteurs est refusé (`REVIEWED_PLAN_MISMATCH`).
3. Après la création de Puma par `attach-maisons`, un second `qualify-sectors` peut qualifier la nouvelle ligne.

## Écarts connus

- **Filtre secteur strict** (`apps/api/lib/job-search-query.ts`, cas `secteur`) : aujourd'hui une offre sans secteur
  n'apparaît sous un secteur que si l'on coche « non classée ». Défaut du code au regard de D-515 §1, antérieur au lot
  (la colonne « inconnues » des mesures est donc ce que le filtre corrigé montrerait, pas ce qu'il montre).
- **Secteur partiel** : « Retail » seul est refusé, mais un secteur de produit peut rester incomplet (Histoire d'Or sans
  Horlogerie ; secteurs hérités d'une Maison déjà relue, ex. Diptyque, New Balance). Une fois le filtre corrigé, une telle
  offre sortira des secteurs manquants. Le défaut existe déjà pour les 254 sociétés qualifiées.
- **Sens de « Retail »** : les règles relues donnent Mode + Retail à Mango, ce lot donne Mode seul à des entités
  « … Retail » de Canada Goose ou New Balance. Savoir si toute marque qui exploite des boutiques relève du filtre Retail
  est une question de taxonomie, non tranchée.
- Le secteur est lu sur la société : un portail de groupe (LVMH, Richemont, Estée Lauder) ne peut pas recevoir de secteur
  par offre, même quand l'offre porte sa catégorie native (`businessGroup`).
- Une Maison que la relecture refuse n'a pas d'autre recours qu'une preuve officielle relue (`reviewed-rules.ts`).
- Les preuves natives (WTTJ compris, qui est un tiers) portent `basis: OFFICIAL_SOURCE` et `checkedAt` = heure de
  l'aperçu, y compris pour la liste de référence ; aucune n'expire (`validUntil`), contrairement à `qualify.ts`.
