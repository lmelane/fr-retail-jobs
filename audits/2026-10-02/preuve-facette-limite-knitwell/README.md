# D-520 §4 a et b : preuve par facette, limite connue, knitwell

Lot construit le 02/10/2026 sur `development` de l'agrégateur, au titre de la lecture D-492 « listes, volumes et
lecteurs » (D-520 §4 a et b). Rien n'est en production. Les mesures en production sont en lecture seule, après 18:30 UTC.

## Fichiers

| Fichier | Contenu | Rejeu |
|---|---|---|
| `temoins-sur-5536c1d.out` | les témoins du lot lancés sur le code d'avant le lot (`5536c1d`), fichiers de test seuls copiés | voir « Témoins » |
| `mutants.sh` → `mutants.out` | chaque contrôle de `facetProof` retiré seul, puis l'adoption sans vérification | `bash mutants.sh > mutants.out` |
| `knitwell-fermetures.sql` → `.out` | fermetures sur preuve et événements de knitwell depuis le 23/09 | `db.py readonly`, commande dans le `.sql` |
| `../classes-listes-lecteurs/knitwell-effet.sql` → `knitwell-effet.out` | les collectes et l'état des représentations (lot précédent) | idem |
| `fermetures-ids.sql` → `.out` | les 505 représentations désactivées sur preuve depuis le 23/09 et toujours inactives | `db.py readonly` |
| `liste-knitwell.mts` → `liste-knitwell.json` | la liste complète de knitwell relue en direct le 02/10 à 18:44 UTC, liste seule | commande en tête du `.mts` |
| `partage.py` → `partage.out` | le partage des 505 fermetures : à tort (encore listées) / à bon droit | `python3 partage.py > partage.out` |
| `temoins-plafond-sans-correctif.out` | les témoins du correctif d'audit (total au plafond) lancés sans lui : 5 échecs | voir « Audit » |

## 1. Preuve par facette (§4 a)

`facetProof` (`apps/aggregator/src/ats/adapters/workday.ts`) juge les trois conditions ; la terminaison
`COVERING_FACET_RECONCILED` n'est posée, et `complete` vrai, que si elles tiennent toutes. Elle est désormais probante
pour le refresh (`refreshPlan.ts`).

| Condition | Contrôles (motif nommé si elle manque) |
|---|---|
| 1. facette obligatoire, partition | aucun recouvrement (`COVERING_FACET_OVERLAP`) ; chaque offre du site plafonné retrouvée (`COVERING_FACET_MISSES_SITE_POSTINGS`) ; deux facettes d'accord et aucune qui compte plus (`COVERING_FACET_WITHOUT_AGREEMENT`) |
| 2. chaque valeur lue en entier, sous le plafond | tableau prouvé (`COVERING_BOARD_UNPROVEN`) ; total sous 2 000 (`COVERING_BOARD_AT_CAP`, contrôle neuf) ; somme des totaux = compte de la facette (`COVERING_FACET_VALUES_MISMATCH`) |
| 3. union lue = somme des comptes | identifiants distincts + lignes sans chemin (`COVERING_FACET_TOTAL_MISMATCH`) |

Limite écrite, non testable : une offre sans valeur dans AUCUNE des facettes d'accord et servie au-delà du plafond
resterait invisible. Valeur par valeur, les totaux peuvent différer du compte d'une unité (knitwell le 02/10 : 1 759 et
1 267 pour 1 758 et 1 268, une offre passée d'une famille à l'autre) : seule la somme est exigée.

## 2. Limite connue (§4 b)

`ENUMERATION_UNPROVABLE` (page d'accueil, flux RSS) : non bloquante pour toute source (`isKnownListLimit`), classe
`LISTE_INDEMONTRABLE` en trajectoire de décision (D-520 §4 b), sans échéance ni escalade à 14 jours ; muette, elle est à
réparer ; tout autre défaut à côté l'emporte. Jamais d'attestation : la collecte reste `complete: false`.

Fraîcheur, vérifiée dans le code :
- `availability.ts` : `collectionReconfirms` refuse une collecte `complete: false` (« parcours déclaré incomplet ») ;
  le plafond de 72 h (`ceilingApplies`) ne dépend que du statut de la source : une offre non revue depuis 72 h sort.
- `applyLinkProbe.ts` : `probeTargets` sonde toute offre servie non revue depuis 24 h, sans condition de preuve.

## 3. Knitwell

Mesures en lecture seule le 02/10 à 18:31-18:47 UTC. Le RUN de 16:02 UTC n'était pas fini (403 sources sur 412, sans
refresh) ; knitwell, elle, venait d'être collectée (18:38, 2 002 offres, non prouvée). La liste a été relue après.

- **Collectes** (`knitwell-effet.out`) : `complete` et `canAttestAbsence` vrais avec 1 999 à 2 000 offres les 24, 25, 27,
  28 et 30/09 (et le 23/09 selon le lot précédent) ; « réfutée » les 26/09, 29/09 et 01/10.
- **Effet** (`knitwell-fermetures.out`) : 519 représentations désactivées sur preuve (209 le 27/09, 1 le 29/09, 302 le
  30/09, 7 le 01/10 sur la preuve du 30/09) ; 14 déjà revues et rouvertes par la collecte ; **505 toujours inactives**.
  Aucune retenue de disponibilité : la colonne n'existe pas encore en production (migration `20261002140000`).
- **Partage** (`partage.out`) contre la liste complète du jour (3 521 identifiants, 3 523 au compte des facettes,
  2 lignes sans chemin) : **258 fermées à tort et toujours en ligne** (88 du 27/09, 170 du 30/09), 247 absentes de la
  liste (fermées à bon droit, sauf peut-être 2 qui seraient les lignes sans chemin).
- Le jour même, la preuve par facette est adoptée (`COVERING_FACET_RECONCILED`, 4 facettes d'accord) mais les 2 lignes
  sans chemin rendent l'absence inutilisable (`canonicalAbsenceProofUsable: false`) : le refresh ne fermera rien sur
  cette collecte tant qu'elles existent.

**Réparation**, par le mécanisme existant : la collecte native revoit chaque offre listée et la rouvre
(`dedup/upsert.ts`, `reactivateJob`, événement REOPENED). Un plan de réparation ne peut pas réactiver une représentation
(`remediation/plan.ts`). Avec la release, après la migration `20261002140000_r143_disponibilite_autorite` (qui rattrape
`publisherClosedAt` depuis `DataCorrection` REFRESH_LIFECYCLE) et le code, hors fenêtre du RUN et hors RUN :

```
python3 apps/aggregator/scripts/ops/db.py readonly npx tsx apps/aggregator/scripts/ops/reouverture-fausse-preuve.mts \
  knitwell-us-retail --depuis=2026-09-23 --output=<aperçu.json>
# relire : aRouvrir attendu autour de 258, resteFermees autour de 247, preuve COVERING_FACET_RECONCILED
python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/scripts/ops/reouverture-fausse-preuve.mts \
  knitwell-us-retail --apply --plan=<aperçu.json>
```

L'application refuse si la base a changé depuis l'aperçu, lance `verifier-source`, puis exige une collecte complète et
attestante et chaque ligne revue rouverte (sortie 1 sinon). Si le RUN suivant la release passe avant, il rouvre
lui-même ces offres : l'aperçu le montrera.

## Audit (un tour, deux lectures)

- Technique : un HIGH, antérieur au lot mais sur la preuve elle-même, corrigé (`772d32b`) : un total au plafond sans
  facette à plat comptée se déclarait prouvé (2 000 lues sur 3 000). Trois MEDIUM et trois LOW laissés, voir la lecture D-492.
- Réconciliation : aucun CRITICAL ni HIGH ; quatre MEDIUM ou LOW documentaires, voir la lecture D-492.

Contrôles : `npm run typecheck`, `npm run test:local` (3 892 + 1 025 + 552 tests) verts sur `772d32b`.
