# Contrôles après le détachement FashionJobs — 2026-09-11

Les contrôles initiaux (aucune fermeture, aucune orpheline, aucune URL nulle) **ne prouvaient pas que le candidat arrive sur la bonne annonce**. Voici ce qui a été établi depuis.

## Faute de méthode reconnue

L'incohérence Hermès a été **détectée sur le clone puis déclarée après l'application en production**. C'est l'inverse de la règle : une incohérence métier vue sur clone doit être **corrigée, isolée ou arbitrée avant** la mutation. La déclarer après coup ne vaut pas validation. Règle retenue pour toute mutation suivante.

## Défaut de traçabilité, et sa conséquence

Mon exécution n'a archivé que **5 identifiants sur 172**, et `deactivateSources` n'écrit un `JobEvent` que lorsqu'une offre est fermée ou retirée — or ici `jobsWithdrawn = 0` **par construction**, puisque les offres gardaient leur source officielle. **Aucune trace datée n'existe donc**, et les 172 exacts **ne sont pas reconstituables** après coup.

Les contrôles ci-dessous portent sur les **268** offres correspondant au prédicat du détachement : un **sur-ensemble** contenant les 172 plus des désactivations FashionJobs antérieures. Vérifier plus large ne peut pas masquer un problème, mais ne permet pas d'attribuer chaque constat à l'opération.

**Correctif pour les prochaines mutations** : archiver la **liste complète** des identifiants avant application.

## A. Correspondance annonce → destination

| Verdict | Offres |
|---|---:|
| URL appartenant à une source vivante **de cette offre** | **265** |
| `canonicalSourceKey` nul, mais URL toujours valide | **3** |

**Aucun candidat n'est envoyé vers l'annonce d'une autre offre par l'effet du détachement.** Le mécanisme lui-même l'interdit : `deactivateSources` reprend l'URL via `selectCanonicalSource` parmi **les sources restantes de la même offre** — il ne peut pas emprunter l'URL d'une autre offre.

Les 3 `canonicalSourceKey` nuls ne viennent pas du détachement : la base en compte **5 185** sur les offres actives, dont **4 601 n'ont jamais touché FashionJobs**. Population préexistante, dossier distinct.

## B. Deux offres dont l'URL ne correspond à aucune source vivante

Trouvées en poussant le contrôle plus loin — **antérieures au détachement** (`firstSeenAt` du 2026-09-06, attestation FashionJobs toujours active) :

| Offre | Titre affiché | RAW de la source | URL de candidature | Lecture |
|---|---|---|---|---|
| Boardriders `cmtpkwxko…` | « Stagiaire E-Commerce & CRM f/h » | « Coordinateur Web-Merchandising & CRM (H/F) » | `groupe-beaumanoir.gestmax.fr/…` | **Défaut réel** : trois annonces distinctes dans une même ligne ; le candidat partirait vers une offre Beaumanoir sans rapport |
| Aroma-Zone `cmtpkx05b…` | « Chargé(e) de Recrutement Expert(e) Retail » | identique | `careers.aroma-zone.com/…` | Titre et RAW concordent ; l'URL pointe le site officiel plutôt que FashionJobs — **amélioration, pas un défaut** |

**Ces deux offres font partie des 585 qui dépendent de FashionJobs seul**, donc du périmètre en attente d'arbitrage. Elles ne sont pas modifiées. **Le cas Boardriders est un défaut de qualité visible par le candidat** : il doit être traité avec ce dossier, quelle que soit la décision sur les 585.

## C. Qualité de l'attestation conservée

Le prédicat « une autre source ACTIVE ≠ fashionjobs » **ne démontrait ni le caractère officiel ni la validité** de la source. Qualifié avec les règles existantes (prédicat de la porte de promotion + tier du catalogue) :

| Attestation conservée | Offres |
|---|---:|
| **Certifiée et côté employeur** | **109** |
| Côté employeur, non certifiée | **93** |
| **Jobboard spécialisé** (`wttj-sector`) | **66** |

Tiers des sources conservées : EMPLOYER_DIRECT 178 · SPECIALIST_JOBBOARD 66 · ATS_OFFICIAL 21 · GROUP_OFFICIAL 3.

**Les 66 sur `wttj-sector` sont conformes**, vérifié contre la doctrine et non supposé : le produit repose sur **deux flux de rang égal** — (A) ATS et pages carrière, (B) **jobboards et cabinets** (CLAUDE.md, définition du produit). La règle qui interdit de servir des offres vise **FashionJobs nommément**, pas tout jobboard. Ces 66 offres restent donc attestées par un flux B légitime.

**Nuance à conserver** : 93 + 66 = **159 offres** sur 268 ne conservent pas d'attestation *certifiée*. Ce n'est pas propre au détachement — 351 des 441 sources actives ne sont pas certifiées — mais l'opération n'a pas amélioré leur provenance.

## D. Les retenues : prédicat corrigé

Mon prédicat comptait comme retenue **toute représentation non publiée aujourd'hui**, ce qui englobait des représentations **écrites puis fermées** — du cycle de vie ordinaire.

**Une retenue est une écriture REFUSÉE : aucune ligne `JobSource` n'existe.**

| Mesure (2026-09-11 05:47Z) | Avant correction | Après correction |
|---|---:|---:|
| Retenues réelles | 740 | **702** |
| Écrites puis désactivées (cycle de vie, **pas** des retenues) | comptées comme retenues | **38** (Aptar) |
| Publiées malgré une retenue passée | 35 | 35 |

Retenues par motif : `WORKDAY_EMPLOYER_ABSENT_IN_DETAIL` **695** (VF) · `APPLICATION_EXPLICITLY_CLOSED` 6 (blackstore) · `WORKDAY_DETAIL_FETCH_FAILED` 1 (KnitWell).

**Les 695 VF sont intactes**, conformes à la décision de ne jamais les créditer au groupe. **UNIQLO n'apparaît dans aucune retenue** — les réparations n'en ont levé aucune, vérifiable par identifiant.

## E. Les 35 publiées après une retenue — non validées

La présence d'une observation d'identité **ne suffit pas** à valider les 28 qui en ont une. Ce qui manque, pour les 35 : relier la **retenue**, la **preuve recevable** de l'employeur, la **décision de levée** et la **publication**.

| Source | Offres | Avec observation |
|---|---:|---:|
| mango | 27 | 27 |
| tapestry | 5 | 0 |
| nordstrom | 3 | 1 |

**Les 7 sans observation sont prioritaires** ; **les 28 autres ne sont pas automatiquement conformes**. Dossier **ouvert dans P2**, aucune conclusion tirée.

## F. Distinction demandée

- **Aucune nouvelle offre orpheline parmi celles détachées** : 0 des offres touchées n'a perdu toute attestation vivante.
- **637 offres restent sans source ACTIVE** dans le catalogue : population **préexistante**, sans rapport avec cette opération (dont 585 dépendant de FashionJobs seul, 52 sous des sources WTTJ en pause).

Ces deux affirmations ne se substituent pas l'une à l'autre.
