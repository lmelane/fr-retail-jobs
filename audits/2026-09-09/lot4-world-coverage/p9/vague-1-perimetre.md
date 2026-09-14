# P9 · VAGUE 1 — périmètre figé

> Figé le 2026-09-13 avant toute exécution. Ce document ne bouge plus : une vague qu'on ajuste en cours de
> route ne se réceptionne pas. Périmètre machine : `vague-1-perimetre.json`.

## Ce que la vague fait, et ce qu'elle ne fait pas

**Elle certifie 16 sources déjà actives dont le portail est hébergé sur le domaine officiel de la Maison.**
Ces sources **collectent déjà** — 6 573 offres publiées aujourd'hui. Ce qui leur manque n'est pas
l'ingestion : c'est la **revue d'identité** sous le contrat strict de D60.

**Elle n'ajoute aucun acteur nouveau, et c'est délibéré pour une première vague.** Le brief demande de
démontrer le *processus* d'extension avant de l'appliquer largement. Certifier des sources dont la preuve
existe déjà exerce la chaîne complète — sauvegarde, clone, validation réelle avec robots et libellés natifs,
certification board + périmètre, contrôle des volumes — **sans dépendre d'une découverte préalable**, qui est
le facteur de risque des 189 sources `E_RESEARCH_NEEDED`.

**Aucune ingestion n'est déclenchée par cette vague.** La chaîne `b6-certify-existing.sh` ne fait ni
`register`, ni `promote`, ni run. Conséquence directe : **aucune observation nouvelle, donc aucune croissance
de stockage chaud** — la vague est compatible avec la réserve stockage objet par construction, pas par
arbitrage.

## Les 16 dossiers

| Source | Acteur | ATS | Portail | Offres | Pays | Catégorie |
|---|---|---|---|--:|---|---|
| `rituals` | Rituals | rituals | `careers.rituals.com` | 1 245 | DE (19) | D |
| `adidas` | adidas | successfactors | `jobs.adidas-group.com` | 1 142 | US (52) | D |
| `ralph-lauren-avature` | Ralph Lauren | avature | `careers.ralphlauren.com` | 1 104 | US (20) | D |
| `primark` | Primark | smartrecruiters-whitelabel | `careers.primark.com` | 966 | US | D |
| `lovisa` | Lovisa | teamtailor | `careers.lovisa.com` | 893 | US | D |
| `lacoste` | Lacoste | digitalrecruiters | `careers.lacoste.com` | 464 | US | D |
| `psycho-bunny` | Psycho Bunny | generic-listing | `careers.psychobunny.com` | 165 | US | D |
| `dr-martens-tf` | Dr. Martens | talentfunnel | `jobs.drmartens.com` | 153 | US | D |
| `beauty-success-geodir` | Beauty Success | geodirectory | `recrutement.beautysuccess.fr` | 110 | FR | D |
| `kult-olymp-hades` | KULT \| OLYMP&HADES | recruitee | `www.kult-olymp-hades.de` | 80 | DE | D |
| `zegna-altamira` | Zegna | altamira | `careers.zegnagroup.com` | 64 | IT | D |
| `bash-talents` | ba&sh | bashtalents | `talents.ba-sh.com` | 57 | FR | D |
| `rivoli-typesense` | Rivoli Group | typesense | `www.rivoligroup.com` | 47 | BH | D |
| `oak-essentials` | Oak Essentials | greenhouse | `oakessentials.com` | 34 | CA | D |
| `fenwick-volcanic` | Fenwick | volcanic | `www.careers.fenwick.co.uk` | 31 | GB | D |
| `catbird` | Catbird | lever | `www.catbirdnyc.com` | 18 | US | D |

**16 sources · 16 familles ATS · 7 pays principaux · 19 à 52 pays couverts pour les plus grosses ·
6 573 offres publiées.**

Catégorie **D — source déjà couverte** au sens du brief §3 : le portail est déjà présent au catalogue. Ce qui
change est son **statut de preuve**, pas sa présence.

## Pourquoi CETTE sélection, et pas la plus facile

Le brief interdit de choisir une vague parce qu'elle est commode. Les critères appliqués :

| Critère | Application |
|---|---|
| Diversité ATS | **16 familles distinctes** — une par adaptateur, choisie sur le plus gros volume de chaque famille |
| Diversité géographique | 7 pays principaux, dont FR (2), DE (2), IT, GB, CA, BH — pas seulement US |
| Volume représentatif | de 18 offres (`catbird`) à 1 245 (`rituals`) — la vague exerce les deux extrêmes |
| ATS déjà maîtrisé | les 16 adaptateurs existent ; **aucun développement n'est prévu** |
| Preuve disponible | les 16 portails sont sur le domaine officiel (`onOfficialDomain = true` pour les 16) |
| Risque d'attribution | aucun alias revu, **aucune revue obsolète** sur les 16 |

**La diversité ATS est le vrai critère de représentativité** : si la chaîne de certification se comporte
identiquement sur seize adaptateurs différents, elle est démontrée pour la famille entière (83 sources), pas
pour un cas particulier.

## Vérifications faites AVANT le gel

- `onOfficialDomain = true` sur les 16 — le domaine enregistrable du portail **est** le domaine officiel de
  la Maison ;
- `hasReviewedAlias = false` et `staleReview = false` sur les 16 — rien à défaire, rien de périmé ;
- aucune des 16 n'est parmi les 2 sources en échec au dernier run (`l-oreal-professionnel`, `mango`) ;
- aucune n'est un portail de groupe (famille `G`) : pas de certification MULTI_BRAND requise ici.

## La procédure, inchangée depuis B6

`b6-certify-existing.sh <nom> <clés>`, la chaîne prouvée en D60 :

```
garde de déploiement → sauvegarde FRAÎCHE → clone restauré depuis ce dump
  → clone : validation réelle (adaptateur, robots explicite, libellés natifs) + certification
  → production : la même
  → volumes en lecture seule
```

Ni `register`, ni `promote`, ni run. **Aucune fusion ni déploiement pendant l'exécution.** Les crons restent
gelés.

## Critère de réception de la vague

Chaque dossier doit porter un verdict — `INTÉGRÉ ET VALIDÉ`, `DÉJÀ COUVERT`, `COLLECTE VALIDÉE, PUBLICATION
RETENUE`, `BLOQUÉ AVEC CONDITION DE REPRISE` ou `EXCLU AVEC MOTIF`. Aucun dossier ne reste « en cours ».

L'indicateur de cette vague n'est **pas** un nombre d'offres ajoutées — elle n'en ajoute aucune par
construction. C'est : **combien de sources passent sous contrat de preuve strict, et la chaîne se comporte-t-
elle identiquement sur seize familles ATS.**
