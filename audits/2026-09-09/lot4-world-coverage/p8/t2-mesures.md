# P8 · T2 — capacité élargie réelle, 18 sources

> 2026-09-13, commit déployé `85ce223`, crons gelés.
> Passe 1 : run `687c482a`, 13:42:20 → 14:05:26 UTC, **1 379,8 s** (23 min).

## Le verdict terminal : NON RECEVABLE comme mesure, et c'est correct

`COMPLETED_WITH_ERRORS` · `validForCapacity: **false**` · problèmes :
`PIPELINE_RUN_COMPLETED_WITH_ERRORS`, `SOURCE_RUN_FAILED_OR_INCOMPLETE:saks`,
`SOURCE_RUN_FAILED_OR_INCOMPLETE:knitwell-us-retail`.

Le passage n'entre donc pas dans une moyenne de capacité. **C'est exactement ce que la garde doit faire** — et
c'est la première fois qu'elle refuse un run réel dans ce lot.

### Ce que les 4 échecs d'écriture SONT

Les quatre sont un `EmployerIdentityReviewRequired` levé par `identity/resolve.ts` :

| Source | Libellé refusé |
|---|---|
| `saks` | « Neiman Marcus » (×2), « Bergdorf Goodman » |
| `knitwell-us-retail` | « A00 Premium Brands Services LLC » → proposé « Premium Brands » |

**La porte d'identité refuse d'inventer un employeur.** Ce n'est pas un défaut du pipeline : c'est la règle
D58 qui s'applique — un libellé nouveau ne devient une Maison que sur preuve, jamais par déduction. Ces quatre
offres attendent une revue, elles ne sont ni perdues ni mal attribuées.

Conséquence enregistrée par le pipeline lui-même : `saks` et `knitwell-us-retail` passent
`canAttestAbsence: false`. **Un run qui n'a pas pu tout écrire n'a pas le droit de fermer des offres par
absence.** La chaîne se protège toute seule.

### Aucune perte, aucune troncature

| Source | `fetched` | `accepted` | `declaredTotal` | `complete` | `truncated` |
|---|--:|--:|--:|---|---|
| `saks` | 740 | 740 | 740 | ✔ | ✘ |
| `knitwell-us-retail` | 2 000 | 2 000 | 2 000 | ✔ | ✘ |
| `aptar-beauty` | 227 | 189 | 227 | ✔ | ✘ |
| *les 15 autres* | — | — | — | ✔ | ✘ |

**18/18 sources `complete = true`, 0 tronquée, 0 rejet.** Les 38 retenues d'`aptar-beauty` sont sa décision
sectorielle par offre (D59), pas une perte.

## Le résultat central : 82 réponses 429, et où elles tombent

| Famille | Hôtes | Requêtes | 429 | Taux |
|---|--:|--:|--:|--:|
| **Workday** | 8 | 8 519 | **82** | **0,96 %** |
| Tout le reste | 20 | 2 352 | **0** | 0,00 % |

**Les 429 sont exclusivement Workday**, et à l'intérieur de Workday ils ne frappent que les **cinq plus gros
tenants** :

| Tenant Workday | Requêtes | 429 | p50 | max |
|---|--:|--:|--:|--:|
| `knitwellgroup.wd1` | 2 108 | 8 | 308 ms | 3 834 ms |
| `mango.wd3` | 1 775 | **35** | 251 ms | 787 ms |
| `richemont.wd3` | 1 461 | 28 | 342 ms | 6 318 ms |
| `nordstrom.wd501` | 1 418 | 7 | 412 ms | 1 833 ms |
| `saks.wd1` | 781 | 4 | 317 ms | 394 ms |
| `deckers.wd5` | 422 | **0** | 343 ms | 910 ms |
| `fastretailing.wd3` | 363 | **0** | 220 ms | 634 ms |
| `mecca.wd3` | 191 | **0** | 346 ms | 4 312 ms |

Le seuil est **par tenant et lié au volume** : en dessous de ~780 requêtes, aucun 429. Ce n'est donc pas une
propriété de « Workday », c'est une limite que chaque tenant applique à son propre trafic.

### Les 429 ont tous été absorbés

**82 retries pour 82 réponses 429. 0 erreur finale, 0 timeout, 0 offre perdue.** Le backoff par tenant a fait
son travail : chaque 429 a produit une attente puis une reprise réussie. Le portail nous a freinés, il ne nous
a jamais rejetés.

`mecca` sert de témoin : 191 requêtes et 0 × 429 en T1 corrigé comme en T2, avec une latence p50 qui monte de
243 à 346 ms sous la charge des 18 sources — **ralenti, jamais refusé**.

## LA GARDE 429 N'ÉTAIT PAS ARMÉE — défaut de procédure, corrigé

Ce passage a été conduit en croyant `P8_STOP_ON_FIRST_429=1` actif. **Il ne l'était pas.** La variable était
exportée dans le shell LOCAL ; le run s'exécute dans le conteneur Railway, où elle n'arrive ni par la commande
bornée ni par les variables de service. Vérifié après coup : aucune variable `STOP`/`429` sur le service.

Les trois passages concernés — T1 corrigé ×1 et ×2, T2 passe 1 — **n'avaient aucune garde d'arrêt**.

*Une garde qu'on croit armée est pire qu'une garde absente : elle fait relire un run comme sûr.*

Corrigé : `--stop-on-first-429` est un drapeau du runner, porté par la **commande déployée** (visible dans le
manifeste, attribuable au run, retiré à la restauration), et le `record.json` porte `stopOnFirst429` — un
passage relu dit désormais lui-même sa posture.

**Ce que le défaut ne remet pas en cause** : les 82 × 429 ont tous été absorbés, sans erreur ni perte. Le run
n'a pas maltraité les portails — mais il l'a établi *après coup*, par la télémétrie, et non par une garde qui
l'aurait arrêté. La différence compte, elle est nommée ici.

## Ressources — le premier palier où quelque chose bouge

| Grandeur | T1 corrigé p1 | **T2 p1** | Marge |
|---|--:|--:|---|
| RSS pic | 651 Mo | **758 Mo** | **3,2 %** de 24 Go |
| Connexions DB (pic) | 15, 1 en attente | **17, 3 en attente** | large |
| Requête la plus longue | 2,85 s | **4,56 s** | à surveiller |
| Échecs de persistance | 0 | **0** | — |

Le volume est **5,2 ×** celui de T1 (10 281 offres contre 1 976) pour un mur **2,4 ×** plus long : le pipeline
absorbe mieux que linéairement, parce que la concurrence de sources est mieux remplie.

**La requête la plus longue reste le point ouvert** : 0,72 s (T1 réf) → 2,85 s (T1c p1) → 0,047 s (T1c p2) →
4,56 s (T2 p1). La dispersion est trop forte pour conclure ; à confronter à la passe 2.

## Débit

**10 281 offres en 1 379,8 s = 7,45 offres/s**, contre 3,40 en T1 corrigé. Le corpus élargi est **2,2 × plus
efficace par seconde** que le corpus restreint — la concurrence de 4 sources est mieux utilisée quand 18
sources attendent que quand 9 attendent derrière une source dominante.

*Ce chiffre est un débit OBSERVÉ sur un run non recevable comme mesure de capacité. Il est rapporté comme
ordre de grandeur, pas comme référence.*

## Écritures

**591 créations · 9 648 ré-attestations · 4 échecs · 38 retenues · 0 rejet.**
`reattestationValidity.attributable: true` — lu **avant** la passe 2, conformément à la règle tirée de T1
(la garde n'étant pas déployée, une lecture après la passe 2 aurait été contaminée).

Les 591 créations sont de vraies offres nouvelles : `richemont-workday` 44, `mango` 95,
`knitwell-us-retail` 198, `nordstrom` 192, `saks` 51, `deckers` 11. Les sources déjà mesurées en T1 corrigé
créent **0** — cohérent avec deux passes antérieures sur le même périmètre.
