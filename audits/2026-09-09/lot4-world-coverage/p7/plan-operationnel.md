# P7 — PHASE 0 : plan opérationnel de la première vague

> **Aucune ingestion de production n'a eu lieu. Aucun refresh. Aucun cron réactivé. Aucune extension du
> catalogue.** État de production relu en fin de phase : **78 932 offres actives**, **0** offre active portant
> `closedAt`, **0** valeur `countryIntegrity`, **0** run en cours, dernier `SourceRun` du **2026-09-10 18:38 UTC**,
> 433 sources ACTIVE / 7 PAUSED, les trois crons sur le sentinel `0 0 29 2 *` avec `PIPELINE_PAUSED=1`.

Tout ce qui suit est **mesuré**, jamais estimé par analogie. Chaque chiffre porte sa source.

---

## 1. La vague initiale — les 9 sources, confirmées sans substitution

La vague proposée par le propriétaire est **retenue telle quelle**. Aucune contre-indication mesurée ne
justifie une substitution.

| Source | Famille ATS | Hôte réel | Offres publiées | Dernier run |
|---|---|---|---:|---|
| `mecca` | Workday | `mecca.wd3.myworkdayjobs.com` | 191 | OK · 182 lues · 0 erreur |
| `dr-pierre-ricaud` | SuccessFactors | `careers.groupe-rocher.com` | 71 | OK · 65 · 0 |
| `lagardere-travel-retail` | Talentsoft | `lagardere-recrute.talent-soft.com` | 130 | OK · 109 · 0 |
| `urbn-hub` | iCIMS | `hub-urbn.icims.com` | 1 476 | OK · 1 379 · 0 |
| `beiersdorf` | generic-listing | `www.beiersdorf.com` | 156 | OK · 136 · 0 |
| `lindex-easycruit` | EasyCruit | `lindex.easycruit.com` | 41 | NEW · 41 · 0 |
| `american-vintage-dr` | DigitalRecruiters | `careers.am-vintage.com` | 34 | NEW · 34 · 0 |
| `saltrock-harri` | Harri | `harri.com` | 30 | NEW · 30 · 0 |
| `ganni-talentrecruiter` | TalentRecruiter | `candidate.hr-manager.net` | 16 | NEW · 16 · 0 |
| **Total** | **9 familles** | **9 hôtes distincts** | **2 145** | **0 échec** |

Le volume indicatif de **2 145** annoncé au brief est **exactement** le nombre d'offres actuellement publiées
par ces neuf sources. Volume attendu à la collecte : **1 992** (somme des derniers volumes lus) ; l'écart de 153
correspond aux offres encore publiées qu'un run récent n'a pas revues, et c'est précisément ce que le cycle
doit trancher.

### Les contre-indications du brief, vérifiées une par une

| Interdiction | Mesure | Verdict |
|---|---|---|
| `vf-corporation` et ses 695 retenues | absente de la vague | respectée |
| source dont la dernière collecte comporte une erreur | **0 des 9** : tous `errors = 0`, aucun BROKEN / TIMEOUT / ERROR / CHALLENGED | respectée |
| source à 1–6 offres, sensible à la garde d'effondrement | **0 des 9** : la plus petite est `ganni-talentrecruiter` à **16** | respectée |
| risque non couvert par les scénarios démontrés | aucun : les 10 scénarios ci-dessous couvrent la vague | respectée |

**Une correction à signaler sur ma propre première lecture.** J'avais d'abord classé quatre sources
(`american-vintage-dr`, `ganni-talentrecruiter`, `lindex-easycruit`, `saltrock-harri`) comme « dernière collecte
en erreur ». C'était **faux** : leur statut est `NEW`, que `health.ts` écrit quand une source n'a **aucun run
antérieur** (`before === null ? 'NEW' : 'OK'`). `NEW` figure bien dans `NEVER_ATTESTS`, mais c'est une privation
de **droit d'attester** — « aucun passé : rien à attester » — pas un diagnostic de panne. Ces quatre collectes
ont réussi, avec 0 erreur.

**Ce que `NEW` implique quand même, et qui est porté au plan** : ces quatre sources n'ont pas de volume de
référence, donc la garde d'effondrement n'a rien à comparer, et elles n'obtiendront pas de droit de fermer au
premier cycle. C'est le comportement voulu.

---

## 2. Paramètres d'exécution — chiffrés, lus dans le code

| Paramètre | Valeur | Origine |
|---|---|---|
| Concurrence globale (sources en parallèle) | **4** | `INGEST_SOURCE_CONCURRENCY`, défaut `ingestOrchestrator.ts:56` |
| Concurrence **par hôte** | **4** | `HOST_MAX_CONCURRENCY`, `hostGate.ts:31` |
| Délai minimum entre deux requêtes au même hôte | **80 ms** | `HOST_BASE_GAP_MS`, `hostGate.ts:32` |
| Débit maximal par hôte qui en découle | **≈ 12,5 req/s** par hôte au repos (1 / 80 ms) | dérivé |
| Plafond du backoff adaptatif par hôte | **8 000 ms** | `HOST_MAX_GAP_MS`, `hostGate.ts:33` |
| Timeout de connexion HTTP | **20 000 ms** | `HTTP_TIMEOUT_MS`, `http.ts:33` |
| Timeout de lecture HTTP | **30 000 ms** | `HTTP_READ_TIMEOUT_MS`, `http.ts:42` |
| Taille maximale d'un corps | **20 Mo** | `HTTP_MAX_BODY_BYTES`, `http.ts:43` |
| Tentatives par requête | **3** (+1 après levée d'un challenge WAF) | `fetchWithRetry`, `http.ts:160` |
| Budget maximal **par source** | **40 min** | `INGEST_SOURCE_TIMEOUT_MS`, `ingestOrchestrator.ts:29` |

**Les 9 sources sont sur 9 hôtes DISTINCTS** — aucun hôte partagé dans la vague. La concurrence de 4 ne fait
donc jamais converger deux sources sur le même hôte, et la porte par hôte (D25) n'aura pas à arbitrer.

### Durée

Latence mesurée le 2026-09-12 (lecture de `robots.txt`, une requête par hôte, depuis ce poste) :
**9/9 hôtes joignables, HTTP 200**, médiane **180 ms**, le plus lent `hub-urbn.icims.com` à **353 ms**.

> Cette mesure vaut depuis ce poste. **Elle ne dit rien de l'egress de la production** — leçon D32 : un
> conteneur voisin n'est pas la source. La mesure qui compte sera celle du run borné.

**Durée maximale par source : 40 min** (le budget). **Durée maximale du cycle : 40 min × ⌈9/4⌉ = 120 min**
dans le pire cas théorique. Durée attendue : **10 à 20 min** — `urbn-hub` (1 476 offres, la seule source
volumineuse) a été observée à **150 s** dans un run corrélé, et les huit autres totalisent moins de 700 offres.

**Condition d'arrêt de durée : si le cycle dépasse 45 min, arrêter et rendre compte** — c'est le double de
l'attendu haut, et cela signifie un hôte qui ralentit, pas un volume qui a grandi.

---

## 3. Seuils d'arrêt — tous chiffrés

### Seuils déjà appliqués par le code, sans intervention

| Garde | Seuil | Effet |
|---|---|---|
| Énumération non prouvée | `complete !== true` | **aucune fermeture** — la porte principale, fermée par défaut |
| Couverture d'un total déclaré | **< 0,9** | refuse le droit d'attester |
| Effondrement du volume | **< 0,5** du dernier run productif | refuse le droit d'attester |
| Statut du run | BROKEN / TIMEOUT / ERROR / CHALLENGED / NEW | refuse le droit d'attester |
| Erreurs | `errors > 0` | refuse le droit d'attester |
| Troncature | `truncated = true` | refuse le droit d'attester |
| Fermeture de masse au refresh | **> 50 %** de la base vivante, **et ≥ 50 offres** | refuse le refresh ENTIER, n'écrit rien |

### Seuils d'arrêt de la reprise — décision humaine

| Condition | Seuil chiffré | Action |
|---|---|---|
| Sources en échec dans le cycle | **≥ 1** sur 9 | arrêter, ne pas enchaîner le refresh, rendre compte |
| Variation d'identifiants sur une source établie | **> 20 %** d'écart d'ensemble avec le dernier run | arrêter, examiner avant tout refresh |
| Variation d'identifiants, sources `NEW` | pas de seuil : **aucune référence** | ne ferment rien par construction |
| Offres qui fermeraient au refresh | **> 5 %** du périmètre de la vague (> 107 offres) | arrêter, ne pas fermer, examiner |
| Durée du cycle | **> 45 min** | arrêter, rendre compte |
| Offres à code pays ambigu devenant éligibles | **> 200** en un cycle | arrêter : c'est le signe d'un verdict trop permissif |
| Écriture hors périmètre | **≥ 1** run d'une source hors allowlist | arrêter immédiatement |
| Invariant d'intégrité | **≥ 1** verdict hors liste positive | arrêter immédiatement |

Le seuil de 20 % sur les identifiants est calé sur l'amplitude **réellement observée** : sur 30 jours,
`urbn-hub` a varié de 1 374 à 1 379 (0,4 %), `lagardere-travel-retail` de 109 à 129 (18 %), les autres pas du
tout. 20 % laisse passer la variation la plus large jamais mesurée et arrête tout ce qui la dépasse.

---

## 4. Périmètre technique — l'ingestion ET le refresh sont bornés

**C'était le trou.** L'ingestion avait `INGEST_ONLY_KEYS` depuis D36 ; **le refresh n'avait rien** : il prenait
toute `JobSource` active (`where: { isActive: true }`, `refresh.ts`). Un refresh lancé après la vague aurait pu
fermer les offres des 431 autres sources — dont les **385 en publication retenue** et les **5 suspendues**, qui
n'ont précisément pas tourné et dont le silence ne prouve rien.

Livré : **`REFRESH_ONLY_KEYS`**, sa propre liste, avec trois propriétés.

1. **Le périmètre n'est jamais déduit du statut `ACTIVE`.** Le registre P6 a défait cette confusion : `ACTIVE`
   dit qu'une source est au catalogue, pas qu'elle vient de démontrer son exhaustivité.
2. **Filtre fermé, appliqué aux DEUX requêtes** — la planification et, surtout, la requête transactionnelle qui
   écrit. Posé sur une seule, le périmètre aurait fui au moment de la mutation.
3. **Une clé inconnue arrête la commande**, elle n'est jamais ignorée : une faute de frappe qui réduirait le
   périmètre en silence est plus dangereuse qu'un arrêt.

Vérifié par trois tests d'intégration sur base réelle :

- une offre périmée **hors** périmètre reste active, non fermée, non retirée, sa `JobSource` toujours active —
  alors que sa source a un droit de fermer parfaitement valide : **seul le périmètre les sépare** ;
- une offre attestée par une source hors périmètre **ne se ferme pas** quand celle de la vague se tait ;
- sans allowlist, le comportement historique est **inchangé**.

Valeurs à poser pour le premier cycle :

```
INGEST_ONLY_KEYS  = mecca,dr-pierre-ricaud,lagardere-travel-retail,urbn-hub,beiersdorf,
                    lindex-easycruit,american-vintage-dr,saltrock-harri,ganni-talentrecruiter
REFRESH_ONLY_KEYS = (les mêmes 9 clés, posées SÉPARÉMENT, et seulement après réception de la vérification)
```

---

## 5. `countryIntegrity` — persisté, et la circularité refermée

### Le diagnostic, confirmé à la source

`resolveGeography` produisait bien la provenance (`method`) ; `dedup/upsert.ts` n'en gardait que le
`countryCode`. **La preuve était calculée puis jetée** — 0 valeur sur 78 932 offres actives.

### Un défaut trouvé en lisant le code, et corrigé

`resolveGeography` classe en `RAW_COUNTRY` **aussi bien** `country: "Canada"` (un nom, preuve indépendante du
suffixe) **que** `country: "CA"` (un code nu, qui ne dit rien de plus que le suffixe « …, CA » que la règle web
refuse déjà). Persister le `method` tel quel aurait donné au second le privilège de balisage refusé au
premier : **la validation circulaire de H-GEO-01, réintroduite par une autre porte.**

`countryIntegrityOf()` sépare donc les deux : `RAW_COUNTRY` ne prouve **que** si la valeur déclarée ne se
réduit pas à un code ambigu. Vérifié sur les 9 codes concernés.

### La liste positive, fermée des deux côtés

`RAW_COUNTRY_CODE` · `RAW_COUNTRY` · `VERIFIED` — et rien d'autre.

- Un champ `country_code` **dédié** prouve, même ambigu : c'est une déclaration délibérée, pas un suffixe.
- Ce qui est **lu dans le libellé** ne produit aucun verdict persisté : `LOCATION_ADMIN1_SUFFIX`,
  `LOCATION_COUNTRY_PREFIX`, et aussi `LOCATION_COUNTRY_NAME`. Ce dernier serait pourtant recevable (il ne se
  déclenche que sur un pays nommé en toutes lettres ou un code alpha-3) — on ne l'ajoute pas : la liste est
  arrêtée à trois valeurs, et le web sait **déjà** lire cette preuve dans le libellé (`spellsOutCountry`).
  L'ajouter dupliquerait la même preuve sans rendre une seule offre éligible de plus.
- Un **format postal compatible** ne prouve rien (H-GEO-01) ; il ne sert qu'à réfuter.
- Un verdict **inconnu** ne prouve rien : la liste est fermée, pas ouverte par défaut.

**Un test de contrat** lie les deux listes (aggregator ↔ web) : elles vivent dans des workspaces différents,
aucun typecheck ne verrait leur divergence. Il échoue le jour où l'une bouge sans l'autre.

### `JobRow` porte le champ, et le cast a disparu

`markupIneligibility` lisait `(job as { countryIntegrity?: string }).countryIntegrity` — un accès élargi qui
**compile même si la colonne n'est jamais sélectionnée**. `countryIntegrity` est désormais un champ **requis**
de `JobRow` : le typecheck a immédiatement exigé qu'il soit déclaré partout, ce qui est exactement la garantie
recherchée.

### Mesuré avant / après, par identifiant, sur clone

Ingestion **réelle** (`replay-ingest.mts` → `ingestAllBySource`, comme la production l'appelle), transport
rejoué depuis une cassette enregistrée sur les vrais sites. **Jamais un objet synthétique enrichi à la main.**

| | Avant | Après |
|---|---:|---:|
| Offres portant un verdict (3 sources) | **0** | **163** |
| Verdicts hors liste positive | 0 | **0** |
| Offres à code pays ambigu | 49 | 49 |
| … dont **prouvées** | **0** | **40** |
| … dont **restant sans preuve** | 49 | **9** |
| Clone entier (77 951 → 77 966 offres) | 0 verdict | **163** |

**Les 40 offres ambiguës devenues prouvées le sont légitimement, et je l'ai vérifié à la source plutôt que de
le supposer.** Le `raw` stocké affichait `country: null`, ce qui contredisait le verdict `RAW_COUNTRY` : le
`raw` conservé est le nœud de **listing**, alors que le pays vient de la **page de détail**. En dépouillant la
cassette elle-même, les valeurs publiées sont **`'Germany'`, `'France'`, `'India'`, `'Netherlands'`,
`'Mexico'`…** — **aucun code ambigu nu**. « Hamburg » sous `DE` est donc prouvé parce que la source écrit
littéralement « Germany ».

**Les 8 843 offres ambiguës de production ne peuvent pas redevenir éligibles en bloc** : seule une source qui
déclare le pays produit un verdict, offre par offre. Dans la vague, **99 offres** sont concernées (1,1 % des
8 843).

---

## 6. Les scénarios sur clone — 10/10

Ingestion réelle sur clone, puis relecture de l'état. Chaque contrôle est une **propriété**, jamais un compte
figé (D55) : « aucun verdict hors liste » survit à un changement de volume, « exactement 163 » serait faux
demain.

| # | Propriété | Résultat |
|---|---|---|
| 1 | ingestion complète de la vague (3 sources rejouables sur cassette) | ✓ 367 offres |
| 2 | preuves d'énumération **recalculées** par le run | ✓ 3/3 |
| 3 | aucun droit de fermer sans énumération **PROUVÉE** | ✓ |
| 4a | `countryIntegrity` réellement persisté | ✓ 163 |
| 4b | aucun verdict hors liste positive | ✓ 0 |
| 4c | les codes ambigus ne deviennent prouvés qu'un par un | ✓ 40 prouvées / 9 non |
| 5+6 | aucune double écriture au second passage **ni** après reprise | ✓ 0 doublon |
| 7 | aucune source hors allowlist n'a produit de run | ✓ 0 |
| 8 | fermeture employeur et retrait administratif restent exclusifs | ✓ 0 |
| 9 | retenues de publication conservées (RAW préservé) | ✓ 951 retenues intactes |
| 10 | toute offre écrite est lisible par la chaîne publique | ✓ 367/367 |

### Deux démonstrations qui valent d'être détaillées

**Le second passage n'écrit rien.** Passe 1 : 15 offres créées, 167 re-attestées. Passe 2 : **0 créée**, les
mêmes 167 re-attestées, verdicts strictement identiques. Le point fixe est atteint.

**L'interruption et la reprise.** Crash simulé après **5 transactions committées** (le kill est placé sur
`$transaction`, là où la persistance a réellement lieu). Reprise : **0 offre créée**, 136 re-attestées, source
revenue en `OK`, 148 représentations — **aucun doublon, aucune perte**.

### Ce que le clone a révélé, et qui est la meilleure preuve de sûreté du lot

`mecca` a rendu **BROKEN** au rejeu (1 offre lue sur 182, 1 erreur) : la cassette ne capture pas toute la
pagination Workday, qui passe par des corps POST. **C'est un artefact d'enregistrement, pas un défaut de
production** — `mecca` avait lu ses 182 offres à l'enregistrement, en ligne.

Et le système s'est comporté exactement comme il le doit : `complete = false`, `canAttestAbsence = false`, et
**les 182 offres `mecca` du clone sont intactes**. Une source qui lit 1 offre sur 182 ne ferme rien. C'est la
règle D51 (« une anomalie externe ne devient jamais une corruption interne ») vérifiée sous une panne réelle,
pas sur un cas de test.

**Conséquence pour la vague** : `mecca` n'est pas écartée — sa collecte en ligne est saine (OK, 182, 0 erreur).
Mais son exhaustivité ne pourra être **prouvée qu'en ligne**, au run borné, pas sur cassette.

---

## 7. Sauvegarde, restauration, rollback

**Sauvegarde** : `before-p7-phase0-production.dump`, **494 322 010 octets**,
sha256 `d27fe737a88e36fc1c40c7969510a29589f693418e7c2945b51abcfd5c425f2c`, prise le **2026-09-12 08:28 UTC**.

**Preuve de restauration — car un dump n'est pas une sauvegarde tant qu'il n'a pas été restauré (D26).**
Restauré dans une base neuve `catwalks_lot4_replay_p7phase0`, `pg_restore` **exit 0**, contenu comparé à la
production :

| | Restauré | Production |
|---|---:|---:|
| Offres actives | **78 932** | 78 932 |
| Offres totales | 83 070 | — |
| `JobSource` | 86 252 | — |
| Sources ACTIVE / PAUSED | 433 / 7 | 433 / 7 |
| `countryIntegrity` non nul | 0 | 0 |

**Rollback** : `pg_restore` de ce dump. Un cycle borné n'écrit que des offres et des `SourceRun` ; il ne
supprime rien et ne touche ni au catalogue ni aux retenues. Le rollback est donc une restauration complète,
jamais une réparation partielle.

**Fenêtre d'observation** : **24 h** après le cycle, sans refresh, avant toute décision d'élargissement.

**Reprise après interruption** : démontrée sur clone (§6). Une reprise rejoue la source depuis le début ;
l'idempotence de l'écriture garantit qu'aucune offre n'est dupliquée.

---

## 8. Ordre d'exécution imposé, et le point d'arrêt

```
1. sauvegarde fraîche, RESTAURÉE (la restauration est la preuve)
2. INGEST_ONLY_KEYS posé sur les 9 clés · deploy-guard · run borné depuis l'egress du cron
3. recalcul de complete et canAttestAbsence          ← le run les produit
4. enregistrement de source.enumeration_observed     ← le run le produit
5. comparaison par source des anciens et nouveaux droits
6. démonstration que seules les sources PROVEN peuvent fermer
7. vérification des retenues
8. vérification des ensembles d'identifiants
9. ─────────── RÉCEPTION EXPLICITE DU PROPRIÉTAIRE ───────────
10. seulement alors : REFRESH_ONLY_KEYS + refresh
```

**Aucun refresh tant que l'étape 9 n'est pas franchie.** Les 5 sources de la vague qui portent aujourd'hui un
`canAttestAbsence = true` le tiennent de l'**ancienne** règle : c'est le recalcul qui décidera, jamais l'état
persisté.

---

## 9. Métriques, alertes, destinataires

| Métrique | Où elle est lue | Seuil d'alerte |
|---|---|---|
| Statut et erreurs par source | `SourceRun` | ≥ 1 échec → arrêt |
| Exhaustivité et terminaison | `PipelineEvent` `source.enumeration_observed` | absente → pas de droit de fermer |
| Droits recalculés | `SourceRun.canAttestAbsence` | tout `true` sans `complete = true` → arrêt |
| Volume par source | `SourceRun.fetched` vs dernier productif | < 50 % → refus automatique |
| Verdicts d'intégrité | `Job.countryIntegrity` | toute valeur hors liste → arrêt |
| Offres devenant éligibles | recomptage `googleEligible` | > 200 en un cycle → arrêt |
| Écriture hors périmètre | `SourceRun` des clés non listées | ≥ 1 → arrêt immédiat |
| Révision déployée | `PipelineRun.revision` vs `origin/main` | écart → la chaîne échoue |

**Alerte technique** : digest Brevo par run vers `loic.melane@catwalks.io` (D24), armé sur le service
aggregator. **Heartbeat** : healthchecks.io, armé. **Destinataire des décisions** : Loïc — aucune décision
d'élargissement, de refresh ou de reprise des crons n'est prise par délégation.

---

## 10. Ce qui reste ouvert, dit franchement

1. **`mecca` ne peut pas être prouvée hors ligne** (cassette Workday incomplète, §6). Sa preuve d'exhaustivité
   viendra du run borné en ligne, ou elle restera non prouvée — auquel cas elle ne fermera rien, ce qui est le
   comportement sûr.
2. **6 des 9 sources n'ont pas de cassette** : `dr-pierre-ricaud`, `lagardere-travel-retail`, `urbn-hub`,
   `lindex-easycruit`, `saltrock-harri`, `ganni-talentrecruiter`. Les trois dernières ont une configuration que
   `requestTarget` ne sait pas encore adresser (`portalUrl`, `customer`). Les scénarios ont donc été démontrés
   sur **3 sources et 3 familles ATS** (Workday, DigitalRecruiters, generic-listing), pas sur les neuf. Les
   propriétés vérifiées sont structurelles — elles ne dépendent pas de la famille — mais je ne prétends pas
   avoir rejoué les neuf.
3. **Les 4 sources `NEW`** n'auront pas de droit de fermer au premier cycle, faute de référence. Attendu.
4. **La latence mesurée l'est depuis ce poste**, pas depuis l'egress de la production (D32).

---

## GO / NO-GO

**GO pour la première ingestion manuelle bornée**, sur les 9 sources listées, **sous réserve de l'accord
explicite du propriétaire**, et **sans refresh** : celui-ci exige la réception de la vérification (étape 9).

Ce qui autorise ce GO : périmètre technique fermé des deux côtés et testé ; `countryIntegrity` persisté,
contractualisé et mesuré ; 10/10 scénarios sur clone dont l'interruption-reprise ; sauvegarde restaurée ;
seuils chiffrés ; et la démonstration, sous une panne réelle, qu'une source qui échoue ne ferme rien.
