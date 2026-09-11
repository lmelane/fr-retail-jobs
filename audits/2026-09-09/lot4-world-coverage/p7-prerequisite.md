# P7 — prérequis bloquant à conserver au suivi (posé le 2026-09-11, hors périmètre P5)

**Avant toute reprise du `refresh`, un nouveau run d'INGESTION doit d'abord recalculer les preuves d'énumération
et les droits `canAttestAbsence` avec le code actuel. Ne jamais relancer `refresh` seul sur les anciens états
persistés.**

## Pourquoi c'est bloquant, mesuré

Les colonnes `SourceRun.complete` et `SourceRun.canAttestAbsence` en base ont été écrites par le code
**antérieur** au 2026-09-11, où un ratio atteint suffisait à produire `complete = true`. Elles ne portent donc pas
la règle en vigueur (« seul un parcours démontré ferme »).

- **216 sources** portent un `canAttestAbsence = true` hérité de l'ancienne règle ;
- sous la règle actuelle, **53 seulement** y auraient droit ;
- **340 sources sur 440** n'ont aucune trace d'énumération archivée (`source.enumeration_observed` n'existe que
  depuis le 2026-09-09) et ne peuvent donc rien prouver avant d'avoir tourné à nouveau.

`runRefresh` lit `canAttestAbsence` **tel qu'il est stocké**. Un `refresh` lancé seul, sur ces états, fermerait
donc des offres sur la foi de droits périmés — exactement ce que la règle interdit.

## L'ordre imposé à la reprise

```
1. INGESTION complète (recalcule complete, canAttestAbsence, la trace d'énumération)
2. VÉRIFICATION des droits recalculés (attestation-replay.mts)
3. REFRESH seulement ensuite
```

Cet ordre renforce D36 (« ingest complet d'abord, refresh ensuite »), pour une raison supplémentaire : ce n'est
plus seulement une question de fraîcheur des attestations, mais de **validité de la règle** qui les a produites.
