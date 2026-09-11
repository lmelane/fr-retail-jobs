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

---

## Prérequis ajouté le 2026-09-11 — `countryIntegrity` doit être PERSISTÉE

**Ne pas supposer qu'une ingestion remplira `countryIntegrity` automatiquement.** Le diagnostic est net :
`resolveGeography` (apps/aggregator/src/normalize/geography.ts) produit bien `method` et `sourcePath` — la
provenance du pays — mais `dedup/upsert.ts` n'en garde que `countryCode`. **La provenance est calculée puis
jetée**, et la colonne `countryIntegrity` est vide : **0 valeur sur 78 932 offres actives**.

Conséquence mesurée : **7 210 offres** à code pays ambigu n'ont aucune provenance exploitable et restent
inéligibles au balisage. Elles ne redeviendront éligibles que lorsque leur verdict positif sera **démontré**.

### À faire pendant P6/P7, sans mutation de production

1. **définir** les verdicts positifs et négatifs autorisés pour `countryIntegrity` — la liste positive est déjà
   fixée côté web (`RAW_COUNTRY_CODE`, `RAW_COUNTRY`, `VERIFIED`) ; la chaîne d'ingestion doit produire
   exactement ces valeurs ;
2. **persister** le verdict issu du chemin géographique réel (`resolveGeography().method`), et non un drapeau
   recalculé ailleurs ;
3. **transmettre** `countryIntegrity` dans le `JobRow` réellement utilisé par la fiche — il ne le porte pas
   aujourd'hui, la règle web le lit via un accès élargi ;
4. **tester le chemin complet** ingestion → base → `JobRow` → `JobPosting` **sur clone** ;
5. **vérifier que le test ne repose pas sur un objet synthétique enrichi à la main** : le verdict doit venir
   d'une ingestion réelle, pas d'un décor de test qui pose le champ.

### Lors de P7 seulement, après accord explicite

1. ingestion complète du sous-ensemble admis ;
2. vérification des `countryIntegrity`, `complete` et `canAttestAbsence` **recalculés** ;
3. `refresh` seulement après validation.

**Une offre ne redevient Google-éligible que si son verdict positif est effectivement démontré. Les 7 210 offres
ne doivent pas redevenir éligibles en bloc.**
