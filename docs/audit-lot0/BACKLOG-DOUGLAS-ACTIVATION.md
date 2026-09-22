# `DOUGLAS_ACTIVATION_REVIEW` — configuration prête, activation non décidée

**Backlog produit.** Aucun blocage technique. Aucune action requise pour le chantier Catalogue.

| | |
|---|---|
| ouvert le | 2026-09-22 |
| source | `douglas-sf` (successfactors, `jobs.douglas.group`) |
| statut en **production** | **`PAUSED`** |
| statut en development | `ACTIVE` |
| migration livrée | `20260922100000_douglas_brand_property` |
| contribution au catalogue V1 | **0 offre** |

## Ce qui est prêt

La source sert `sfstd_marketingBrand_obj` au niveau liste — `["DOUGLAS"]` et `["NOCIBE"]`, mesuré
sur 150 réponses archivées du 2026-09-21. `be586ec` apprend à l'adaptateur SuccessFactors à lire
ce champ (opt-in par tenant), et la migration ci-dessus déclare la configuration en base.

Vérifié sur le clone de répétition, par `prisma migrate deploy` — le mécanisme réel de production :

- `config` fusionnée, `origin` préservée ;
- `SourceRevision` v3 → **v4**, `currentRevisionId` à jour, la v4 portant `brandProperty` ;
- **0 décision d'accès** rattachée à la nouvelle révision — aucune preuve ancienne recyclée ;
- garde-fou éprouvé : une valeur divergente fait **échouer** la migration plutôt que l'écraser ;
- rejouable sans effet.

Mesuré en development, où la source est `ACTIVE` : **311 offres publiées, 0 erreur**, idempotence
démontrée (passe 2 : 0 créée, 311 mises à jour). L'origine de l'étiquette d'employeur passe de
`SOURCE_CATALOGUE_LABEL` à `listing.sfstd_marketingBrand_obj:CONFIGURED_BRAND_PROPERTY`.

## Ce qui n'est pas décidé

**La source est `PAUSED` en production.** La campagne de qualification ne retient que les sources
`ACTIVE` (`source-campaign-candidates.sql`), donc Douglas n'est pas collectée et ne contribue pas
au catalogue. C'est le registre qui fait son travail, pas un défaut.

La raison de la mise en pause n'a pas été instruite : les révisions ne conservent pas d'historique
de statut exploitable. **Ce n'est pas un oubli, c'est un choix de périmètre** — activer une source
engage ce qui est publié aux candidats, et cette décision appartient au propriétaire du produit.

Les 311 offres mesurées en development ne doivent donc **pas** être comptées comme un gain acquis
du prochain déploiement.

## Si l'activation est décidée

Rien à développer : passer `douglas-sf` en `ACTIVE` suffit, la configuration étant déjà livrée.
Le geste reste distinct de la migration technique — un changement de statut n'a pas sa place dans
une migration de schéma.

## Lien

Le problème plus large — aucune mutation de `Source.config` n'a de chemin de livraison versionné,
`data/seeds/sources.csv` ayant été supprimé et la table étant devenue la source de vérité — est
suivi séparément sous `SOURCE_REGISTRY_VERSIONED_DELIVERY`.
