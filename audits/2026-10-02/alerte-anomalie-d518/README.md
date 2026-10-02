# Alerte de couverture réglée par anomalie (D-518 §2), 02/10/2026

D-518 : aucune distinction entre Maisons ; l'alerte de couverture est un outil interne qui signale une perte
**anormale** d'une source, d'une Maison ou d'un marché, avec la même règle pour tout le catalogue ; le réglage revient
à l'assistant. Ce dossier remplace les seuils fixes de `../boucle-couverture/` (Maison ≥ 5 et ≥ 30 % ou ≥ 200 ;
marché ≥ 25 et ≥ 20 % ou ≥ 500).

| Fichier | Ce qu'il fait |
|---|---|
| `rejeu.mts` → `rejeu.out` | Rejoue, HORS LIGNE et par le code même du RUN (`evaluateCoverage`), les extraits lus en lecture seule le 02/10 (`../boucle-couverture/historique.json.gz`, `a-blanc.json.gz`, `historique-sources.json.gz`) et les 68 fermetures Swatch de D-508 §6 ; puis le calibrage de `k`, du plancher et du seuil de masse |
| `historique-sources.sql` → `historique-sources.json.gz` | La même reconstruction que `../boucle-couverture/historique.sql`, avec la source canonique de chaque offre (lu à 13:46 UTC ; mêmes totaux servis à chacun des 11 RUN) |
| `temoins-sur-f753c04.out` | Les témoins de ce lot passés sur le code d'avant (`f753c04`) : 23 échouent, chacun garde un comportement nouveau |
| `indicateur-5.mts` → `indicateur-5.json` | Indicateur 5 avant/après le correctif D-498, mêmes offres, lecture seule de la production (12:59 UTC) |

```sh
npx tsx audits/2026-10-02/alerte-anomalie-d518/rejeu.mts > audits/2026-10-02/alerte-anomalie-d518/rejeu.out
python3 <checkout qui porte les accès>/apps/aggregator/scripts/ops/db.py readonly npx tsx "$PWD/audits/2026-10-02/alerte-anomalie-d518/indicateur-5.mts"
```

## La règle (`ANOMALY`, `apps/aggregator/src/coverage/coverageAlert.ts`)

- **Entités** : la Maison, le marché, et la source (ses offres servies dont elle est la source canonique).
- **Variation habituelle** d'une entité : la médiane des écarts absolus d'offres servies d'un RUN photographié au
  suivant, sur la fenêtre de 7 RUN (au moins 3).
- **Anormal** : au moins **5 offres** perdues (plancher) **et** plus de **k = 4** fois la variation habituelle. Sans
  habitude mesurée (premiers RUN de r6, table vide), le plancher seul : une habitude inconnue n'est jamais tenue pour
  normale (D-515 §1). La perte se compare, comme avant, à l'avant de ce RUN puis à l'habitude.
- Une perte de source que ses Maisons disent déjà (même cause, cette source nommée pour autant d'offres, ou une Maison
  qui la reflète exactement) n'est pas redite : la source n'est signalée à part que si sa perte se disperse sous le
  niveau d'anomalie de ses Maisons (wttj-sector, 439 offres réparties sur 57 Maisons).
- **Menace** : une collecte en échec est anormale par sa cause ; elle réveille dès que ses offres servies menacées
  atteignent le plancher, comptées sur toute la source (capri-jimmy-choo, 45 offres réparties en sociétés de 14 à 16).
  Une source qualifiée d'au moins 5 offres qui n'en sert aucune réveille aussi.
- **Événement de masse** : au moins **40 Maisons** anormales pour la même cause au même RUN font **une** synthèse en
  tête du bulletin. Elle détaille les 30 plus grosses Maisons, puis cite **toutes** les autres, de la plus forte part
  perdue à la plus faible, et tous les marchés et toutes les sources : rien n'est masqué sans être nommé (D-516 §2).
  Les autres anomalies suivent une par une. Chaque entité reste photographiée avec sa gravité : le RUN suivant
  reconnaît l'événement « en cours ».
- La gravité par cause est inchangée ; une fermeture prouvée par la source reste « pour information ».

## Pourquoi ces valeurs (`rejeu.out`)

- **Plancher 5** : 20 perd quatre collectes réellement en échec le 29/09 (Balmain 17, Chantelle 17, Uniqlo siège 17,
  Patek Philippe 15) ; 10 ne voit plus PICARD, Maison vidée (6 sur 6, plafond de 72 h), ni Gemmyo (5) ; 5 les voit, au
  même bruit que l'ancienne version (3,4 par jour). Seules les Maisons de 1 à 4 offres ne peuvent pas réveiller :
  398 Maisons, 831 offres, 1 % du catalogue servi ; leur collecte en échec reste au bilan de santé du RUN
  (`sendHealthAlert`), leur masquage au stock masqué de l'en-tête du bulletin.
- **k = 4** : sans masquage dans l'historique, `k` ne change pas le bruit qui réveille (les menaces) ; il règle les
  pertes jugées anormales, surtout des fermetures prouvées pour information : 34,3 par RUN à k = 1, 14,3 à k = 4,
  6,1 à k = 8. Le cas réel le plus serré est Hermès (variation 32,5, perte 215) : rattrapé jusqu'à k = 6, perdu à
  k = 7. k = 4 lui laisse une marge de 1,6 (seuil 131).
- **Masse 40** : les jours ordinaires comptent jusqu'à 25 Maisons anormales d'une même cause (fermetures, 01/10) ; 20
  en ferait déjà un « événement » ; le premier masquage de r6 en compte 188.

Variation habituelle mesurée au 01/10 : Maisons de 100 à 999 offres p50 2, p90 9,5 ; de plus de 1 000 offres p50 30 ;
États-Unis 609,5, France 208, Hongrie 3,5. Seuils d'anomalie qui en découlent : Hermès 131, Louis Vuitton 41,
Christian Dior Couture 13, H&M 427, Ulta 319.

## Rejeu

| Cas | Ancienne version | Règle d'anomalie |
|---|---|---|
| Diptyque, 01/10 (menace 186) | à réparer | à réparer |
| Browns chaussures, 01/10 (menace 58) | à réparer | à réparer |
| L'Oréal Professionnel (1 716 lues, 0 servie) | à réparer | à réparer |
| Ralph Lauren en pause | pour information | pour information |
| Premier RUN de r6, table vide (9 933 masquées) | 44 alertes qui réveillent | **8** : la synthèse (188 Maisons, 9 193 offres ; Hermès 8e, Louis Vuitton 9e, Christian Dior Couture 16e ; wttj-sector 439 parmi les sources), six collectes à réparer (plafond de 72 h : Coach 129, Kate Spade 50 et Tapestry 7 par tapestry, Nocibé 22, PICARD 6, Gemmyo 5), L'Oréal Professionnel |
| Louis Vuitton 160 sur 800, Dior Couture 89 sur 546 | aucune alerte | dans la synthèse ; avec habitude, anormales (seuils 41 et 13) |
| 68 fermetures Swatch | rien ne réveille | rien ne réveille |

Le même masquage jugé avec 7 RUN d'habitude rend une synthèse de 163 Maisons et 8 alertes à part.

**Correction d'une prémisse** : sous les seuils fixes, Hermès alertait déjà au premier RUN de r6 (215 ≥ 200) ; la perte
est de 215 sur **889** (24,2 %), 674 étant ce qui reste. Passaient sans alerte : Louis Vuitton (160 sur 800, 20 %),
Christian Dior Couture (89 sur 546, 16,3 %), Parfums Christian Dior (39 sur 296).

**Bruit, 7 derniers RUN** (nouvelles alertes qui réveillent) : 0, 0, 1, 3, 15, 2, 3, soit **3,4 par jour**, identique à
l'ancienne version alerte par alerte. Toutes sont des menaces ; le pic du 29/09 reste l'incident réel du périmètre
d'accès. Les pertes de source n'ajoutent aucune nouvelle alerte sur ces 7 RUN ; elles ajoutent des lignes « pour
information » (jusqu'à 36 le 01/10, dont 15 détaillées, le reste en une ligne compacte).

## Indicateur 5 (`indicateur-5.json`)

Calculé à l'heure locale du marché de l'offre (07:30, mardi et vendredi ; mardi et jeudi en Arabie saoudite ; table
recopiée de `catwalks-backend/src/lib/alertes/marches.ts`, vérifiée identique sur les 41 marchés). Sur les 2 384 offres
servies vues dans les 24 h : médiane 12,2 h → **13,2 h**, p90 13,2 h → **18,8 h** (États-Unis et Canada +6 h, Japon
et Corée −7 h, Australie −8 h).

## Limites

- Le bruit après r6 (masquage quotidien) n'est pas mesurable avant r6 : l'historique ne contient aucun masquage.
- Les photographies hors RUN (`availability`, `probe-apply-links` sans `--dry-run`) entrent dans la fenêtre : deux
  photographies rapprochées font baisser la variation habituelle.
- Une entité qui grossit ou fond régulièrement voit sa tendance comptée dans sa variation habituelle.
- Un changement de source canonique d'une offre fait paraître sa perte « sans cause » à l'ancienne source ; non mesuré
  (l'extrait porte la source actuelle).
- Les scènes du 02/10 tirées de la mesure de 11:00 (mesure du jour, Swatch) se jugent sans les photographies de source.
