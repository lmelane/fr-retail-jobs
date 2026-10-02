# Swatch Group : fermeture automatique des offres disparues (D-508 §6), passage à blanc

**Rien de ce dossier n'a écrit en production.** Lectures de la base par `db.py readonly` (psql), lecture du site par le
code de l'adaptateur, le 02/10/2026 vers 06:05 UTC. `swatch-group` reste en pause (D-493) jusqu'à sa réouverture, sous
GO de Loïc.

## La cause

Le lecteur D-493 prouvait son énumération (`PARTITIONS_RECONCILED`, 331/331) sans déclarer `canonicalIds` sur ses
pages de preuve. `refreshPlan.sourceEligibility` refuse alors toute absence (« l'adaptateur ne déclare pas le contrat
canonique ») : les offres retirées du site restaient en ligne.

## Le correctif (`apps/aggregator/src/ats/adapters/swatchgroup.ts`, commit `df53b95`)

- Chaque page de preuve porte `canonicalIds` (les identifiants de ses liens `/job/<id>`, le chemin même de
  `externalId`) **seulement si l'énumération est prouvée** ; une lecture non prouvée ne déclare rien.
- Une fiche rejetée garde son `canonicalId` : vue et nommée, jamais une absence.
- La fermeture exige en plus tout ce que le refresh exige déjà : collecte admise, scellée et achevée, `complete = true`
  (toutes les fiches lues), terminaison probante, un passé (`previous`, la première collecte d'une source n'atteste
  rien), pas d'effondrement de plus de moitié, représentation non revue depuis 48 h.
- Témoins (`swatchgroup.enumeration.test.ts`, bloc « D-508 §6 ») sur les deux lectures réelles du 02/10, par la chaîne
  de décision du refresh : l'offre absente des deux est fermée, la présente reste ; une lecture non prouvée (filtre
  absent, page d'un autre état du cache Akamai) ne déclare rien et ne ferme rien ; une fiche illisible retire le droit
  d'attester ; une première lecture sans passé n'atteste rien. Chacun rouge sur le défaut réintroduit.

## La liste à blanc : 68 offres, pas 49

| | |
|---|---|
| Représentations actives au catalogue (`catalogue-swatch-20261002.csv`) | 380 |
| Offres en ligne sur le site (`lecture-site.json`, énumération prouvée, 71 pages, 200) | 331 |
| Présentes des deux côtés | 312 |
| **Au catalogue, absentes du site : fermées à la réouverture** (`fermetures-a-blanc.csv`) | **68** |
| En ligne, absentes du catalogue : créées à la réouverture | 19 |

« Environ 49 » (D-508 §6) était la différence 380 − 331. L'absence réelle est de 68 : 19 offres nouvelles comblent
une partie de l'écart. Aucune des 68 n'est portée par une autre source (68 `JOB_CANDIDATE_FOR_CLOSURE`).
- Dernière vue : 38 le 30/09 (retirées depuis la pause), 30 entre le 23/09 et le 29/09 (déjà absentes avant la pause,
  restées en ligne faute de preuve d'absence).
- Pays : CH 31, FR 10, US 8, CA 6, AU 5, IT 2, TH 2, AT 1, DE 1, sans pays 2.
- **10 des 68 sont des republications** : le même intitulé, dans la même ville, est en ligne et au catalogue sous un
  autre identifiant (`republications.csv`, par exemple 32313 → 33259, 32940 → 33247). Le catalogue les montre aujourd'hui
  en double ; les fermer retire le doublon.
- Les 58 autres n'ont pas été rouvertes une à une sur swatchgroup.com (une lecture des fiches par `urllib` a expiré
  sur les 19 fiches tentées, Akamai) : leur absence repose sur l'énumération prouvée. Loïc relit la liste avant le RUN
  (§ suivant).

## La garde de masse ne bloque pas le RUN

`pipeline/refresh.ts` refuse si les fermetures sont ≥ 50 **et** dépassent 5 % des offres vivantes du périmètre. Le RUN
appelle `runRefresh` sur toutes les sources ACTIVE (`cli.ts`, `ingest-all`) : 89 666 offres vivantes le 02/10
(`scripts/garde-de-masse.sql`, swatch-group compté), 68 fermetures = 0,08 %. **Non refusé.** Un refresh borné à
`swatch-group` seul (380 offres, 17,9 %) serait refusé : c'est pourquoi l'aperçu ci-dessous lève la garde pour la seule
lecture et recalcule celle du RUN à part.

## À rejouer après la réouverture, AVANT le RUN qui fermera

La réouverture (`source-add --registered-revision`) collecte et publie ; la fermeture vient du refresh du RUN suivant
(18 h Paris), sur la dernière collecte prouvée, et seulement pour les représentations non revues depuis 48 h (toutes le
sont : dernière vue au plus tard le 30/09 à 21:10 UTC).

```sh
# Lecture seule, depuis la copie code/ de la release
python3 apps/aggregator/scripts/ops/db.py readonly npx tsx audits/2026-10-02/d508-swatch-fermeture/scripts/apercu-apres-reouverture.mts
```

Attendu : `eligibility.eligible = true`, `deactivations` ≈ 68, `runGuard.refused = false`, `vsDryRun02Oct` qui liste
les écarts avec cette liste (offres revenues, nouvelles absences). Rejoué le 02/10 sur la base de production : il
s'exécute et dit `source PAUSED : aucune collecte admise possible`, 0 fermeture.

Si la liste ne convient pas : remettre la source en pause avant 18 h (`audits/2026-09-30/pause-swatch-group-d493.csv`,
procédure de `../d493-swatch/reouverture-a-blanc.md`, « Retour arrière »). Rien n'est fermé tant que le RUN n'a pas
tourné.

## Rejouer ce dossier

```sh
# depuis apps/aggregator : lecture du site par l'adaptateur (71 requêtes, 2,5 s d'écart)
npx vitest run --config ../../audits/2026-10-02/d508-swatch-fermeture/scripts/vitest.live.config.mts
# depuis la racine : le catalogue de production (lecture seule), puis la liste
python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -XAq -f audits/2026-10-02/d508-swatch-fermeture/scripts/catalogue-swatch.sql' > audits/2026-10-02/d508-swatch-fermeture/catalogue-swatch-20261002.csv
python3 audits/2026-10-02/d508-swatch-fermeture/scripts/liste-a-blanc.py
```
