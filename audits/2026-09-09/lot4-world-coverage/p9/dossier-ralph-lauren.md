# P9 · dossier `ralph-lauren-avature` — BLOQUÉ AVEC CONDITION DE REPRISE

> Vague 1, dossier isolé du lot 1 le 2026-09-13. Aucune mutation de production, aucune certification posée.

## Le constat

La validation de cette source **s'est figée 64 minutes** sur ce poste, sous un `--deadline-ms=300000`.
Séquence lue dans le journal :

```
16:50:18  waf.bootstrap_completed — careers.ralphlauren.com : amorçage réussi en 7 482 ms
   (puis plus AUCUN événement pendant 64 minutes)
```

L'amorçage WAF **réussit** ; c'est ce qui suit qui ne rend jamais la main.

## Ce que la production dit de la même source

| Run | Statut | Offres | `complete` |
|---|---|--:|---|
| 2026-09-08 22:29 | **OK** | **1 073** | `true` |
| 2026-09-07 22:20 | OK | — | — |
| 2026-09-06 13:30 | NEW | — | — |

**La source fonctionne depuis l'egress de production.** Elle publie 1 104 offres actives aujourd'hui.

## Ce qui a été écarté par la mesure

| Hypothèse | Test | Verdict |
|---|---|---|
| Le portail est injoignable | `curl` depuis ce poste : **HTTP 404 en 0,76 s, connexion en 9 ms** | **écartée** — l'hôte répond vite |
| Les délais du navigateur sont absents | `BROWSER_TIMEOUT_MS` 45 s, `WAF_PRIME_TIMEOUT_MS` 20 s, tous deux bornés | **écartée** |
| Un défaut de l'adaptateur sur toutes les sources Avature | l'adaptateur a rendu 1 073 offres complètes le 08/09 | **écartée** |

Ce qui reste : une **accumulation de reprises** derrière le WAF, sur un chemin où chaque appel est borné mais
où rien ne borne l'ensemble — depuis un egress que le portail traite différemment de celui de Railway (D32 :
*« une cause réseau ne se grave que sur une mesure prise dans le processus réel qui échoue »*).

**Je ne grave pas la cause exacte** : elle demanderait une mesure depuis l'egress de production, que ce
dossier n'a pas encore.

## Ce que le blocage a produit d'utile

Le défaut d'échéance qu'il a révélé est **général**, pas propre à cette source : `validate-candidate.mts`
passait `deadlineMs` dans la configuration de l'adaptateur — une échéance **coopérative**, que `avature.ts`
ne lit pas. Corrigé par `withHardDeadline` (côté appelant, donc pour tous les adaptateurs), prouvé sur cette
source même : **coupure à 91 s pour 90 s demandées**.

Sans ce dossier, le défaut serait resté latent jusqu'à figer une chaîne plus coûteuse.

## Pourquoi la certification est impossible en l'état

`b6-integrate.mts` exige une **preuve de validation FRAÎCHE de la phase** (`b6-validate-<phase>-<key>.json`,
avec les libellés réellement lus sur le board). Ce n'est pas une formalité contournable : c'est ce qui relie
la certification à un parcours observé. Sans validation, pas de preuve ; sans preuve, pas de certification.

Réutiliser la preuve d'un run de production antérieur serait exactement l'erreur que P8 a nommée — attribuer
à une phase un résultat produit par une autre.

## Verdict

**`BLOQUÉ AVEC CONDITION DE REPRISE`.**

| | |
|---|---|
| **Cause** | la validation ne rend pas la main depuis cet egress ; l'échéance ferme la coupe désormais à 90 s |
| **Preuve disponible** | portail sur le domaine officiel (`careers.ralphlauren.com`) · run de production OK à 1 073 offres le 08/09 · robots `ALLOWED` lu le 06/09 |
| **Ce qui manque** | une preuve de validation fraîche, avec les libellés natifs lus sur le board |
| **Prochaine action** | rejouer `validate-candidate --proof` **depuis l'egress de production** (protocole de run borné), ou depuis un egress qui n'est pas challengé |
| **Condition de déblocage** | une validation qui termine avec `robotsVerdict = ALLOWED`, `parsed ≥ 1`, `truncated = false` |

**Ce dossier ne bloque aucun autre dossier de la vague** : les quinze autres sont indépendants, et le lot 1 a
été relancé sans lui.

**Il ne sort pas du périmètre gelé** : la vague reste 16 sources. Un dossier bloqué reste un dossier de la
vague, avec sa condition de reprise — il n'est pas retiré pour faire un meilleur bilan.
