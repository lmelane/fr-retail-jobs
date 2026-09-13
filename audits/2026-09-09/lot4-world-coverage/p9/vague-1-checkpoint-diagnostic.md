# P9 · VAGUE 1 — CHECKPOINT DE DIAGNOSTIC

> **La vague 1 est OUVERTE.** Ce document est un point d'étape, pas une clôture : la constitution des
> preuves EST le travail de P9, et les 16 dossiers doivent obtenir un verdict final.

> 2026-09-13. Périmètre gelé avant exécution (`vague-1-perimetre.json`, commit `6252dbb`). Crons gelés du
> début à la fin, aucune purge, aucune extension non bornée. **Aucune mutation de production.**

## Le résultat, sans arrangement

**0 source certifiée sur 16.** La vague n'a pas atteint son objectif nominal, et la raison est structurelle,
pas accidentelle.

| Mesure | Valeur |
|---|--:|
| Sources du périmètre | 16 |
| Sources **validées** sur clone (adaptateur réel, robots lu, libellés natifs) | **4** |
| Sources certifiées | **0** |
| Offres observées à la validation | **4 112** |
| Offres persistées / uniques ajoutées | **0** (aucune ingestion : la chaîne n'en fait pas) |
| Mutations de production | **0** |
| Revues d'identité en base | 105, **inchangées** |
| Croissance de stockage chaud | **0 octet** |

## Ce qui bloque, et pourquoi ce n'est pas contournable

`b6-integrate.mts` exige une **spec de certification** par source, portant :

```
officialDomain · proofUrl · proofSha (sha256 de la page officielle ARCHIVÉE)
mustContain (la référence du board à trouver DANS cette page) · portalScope · statement
```

**Aucune des 16 sources de la vague n'a de spec.** Le fichier en contient 33, toutes issues de la passe B6 —
et l'inventaire `B_OFFICIAL_DOMAIN_PORTAL` a été construit sur un critère *dérivé* (`onOfficialDomain`,
comparaison de domaines enregistrables), **pas** sur l'existence d'une page officielle archivée qui nomme le
board configuré.

*C'est l'erreur de conception de cette vague, et elle est à moi* : j'ai lu « portail sur le domaine officiel »
comme « preuve disponible ». Le domaine identique est un **indice** ; la preuve exigée par le contrat D60 est
une page archivée, hachée, qui nomme le board. Les deux ne sont pas la même chose.

La vérification l'a d'ailleurs montré avant l'exécution sur deux cas : `kult-olymp-hades` appelle
`jpweltersgorgensgmbhcobekleidungskg.recruitee.com` et `oak-essentials` le board `jennikayne` — deux tenants
qu'aucune comparaison de domaines n'aurait rapprochés de leur Maison.

## Verdict par dossier

| Source | Verdict | Motif |
|---|---|---|
| `rituals` | **COLLECTE VALIDÉE, CERTIFICATION EN ATTENTE** | 1 087/1 087, `complete`, robots ALLOWED — spec manquante |
| `adidas` | **COLLECTE VALIDÉE, CERTIFICATION EN ATTENTE** | 1 110/1 110, `complete`, robots ALLOWED — spec manquante |
| `primark` | **COLLECTE VALIDÉE, CERTIFICATION EN ATTENTE** | 878/878, robots **DISALLOWED** couvert par D62 — spec manquante |
| `lovisa` | **COLLECTE VALIDÉE, CERTIFICATION EN ATTENTE** | 1 037/1 037, **`SINGLE_BRAND_CONSISTENT`** — spec manquante |
| `ralph-lauren-avature` | **BLOQUÉ AVEC CONDITION DE REPRISE** | validation ne rend pas la main depuis cet egress (`dossier-ralph-lauren.md`) |
| Les 11 autres | **NON EXÉCUTÉ** | la chaîne s'arrête avant eux ; spec manquante par construction |

Aucun dossier ne reste « en cours ».

## Ce que la vague a réellement produit

Elle n'a pas certifié. Elle a **trouvé quatre défauts réels**, tous corrigés au niveau partagé, tous prouvés
sur des sources réelles :

| Défaut | Portée | Preuve |
|---|---|---|
| `requestTarget` ne résolvait ni `recruitee` ni `rituals` | toutes les sources de ces deux familles | `rituals` validait 0 → **1 087** |
| L'échéance de validation était **coopérative** | tous les adaptateurs qui ne la lisent pas | 64 min de blocage → **coupure à 91 s** |
| `robots` observait **et** décidait | 46 sources, 5 155 offres | `primark` refusé → collecté sous D62 |
| L'invocation masquait le code de sortie | toute la chaîne | `CODE=0` sur un échec → code réel propagé |

**Les quatre auraient bloqué n'importe quelle vague ultérieure, plus grande et plus coûteuse.** Une première
vague dont le rôle est de démontrer le processus a fait exactement cela : elle a montré où le processus casse.

## Le coût, mesuré

| | |
|---|--:|
| Sauvegardes fraîches prises et vérifiées (sha256) | 4 |
| Clones restaurés depuis ces dumps | 4 |
| Requêtes réseau vers les portails | validation de 4 sources × 4 passages |
| **Stockage chaud ajouté** | **0** |
| **Offres fermées, retirées ou perdues** | **0** |

## Ce qu'il faut pour certifier ces 16 sources

Pour chacune : **archiver la page officielle** qui nomme le board configuré, en calculer le sha256, écrire la
spec (périmètre, énoncé, référence du board). C'est un travail de **preuve par source**, ni automatisable ni
dérivable de l'inventaire — le contrat D60 existe précisément pour empêcher qu'une certification repose sur
une comparaison de chaînes.

Ordre de grandeur honnête : cette étape est le vrai coût d'une vague de certification, et l'inventaire ne
l'avait pas exposé.

## Ce que P9 en conclut, et qui NE clôt rien

> Décision propriétaire du 2026-09-13 : la constitution des preuves est le travail, pas un préalable à
> arbitrer. La vague se poursuit jusqu'au verdict final des 16 dossiers.

La famille `B_OFFICIAL_DOMAIN_PORTAL` **n'est pas** « 83 sources prêtes à certifier ». C'est 83 sources dont
le portail est sur le bon domaine et **pour lesquelles la preuve reste à constituer**. La reclasser
honnêtement vaut mieux que de reproduire l'erreur à plus grande échelle.
