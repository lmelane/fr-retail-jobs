# Ralph Lauren — 1 103 offres sans date de publication : observation ciblée du 2026-09-10

**Question posée** : les 1 103 offres actives de `ralph-lauren-avature` sans `postedAt` (sur 1 104) relèvent-elles d'un défaut de **collecte**, d'**archivage**, de **parsing**, de **transformation**, ou d'une **absence réelle** dans les données officielles accessibles ?

Première observation du LOT P2. Aucune conclusion n'est tirée d'une seule carte : deux listes et six fiches de détail ont été lues et **archivées avec leur empreinte**, et le raisonnement ci-dessous ne porte que sur ce qui a été effectivement observé.

## Ce qui a été observé et archivé

| Élément | Volume | Archive |
|---|---:|---|
| Liste `SearchJobsCorporate` (board configuré) | 133 928 o | `p2-ralph-lauren/list-en-US-CareersCorporate-SearchJobsCorporate.html` · sha256 `ce0f0616…8773` |
| Liste `SearchJobsRetail` (board configuré) | 142 496 o | `p2-ralph-lauren/list-en-US-CareersCorporate-SearchJobsRetail.html` · sha256 `7e9eddb3…a544ea` |
| Fiches de détail réelles | 6 | `p2-ralph-lauren/detail-*.html`, empreintes dans `details.json` |

Le périmètre observé est le **board configuré de la source** (`careers.ralphlauren.com`, les deux listes de `Source.config`), pas une page choisie ailleurs.

## Résultats, par niveau

**Sur les cartes de liste** — la carte publie **ville · référence · fonction**, et rien d'autre :

> `(Senior) Sales Executive (w/m/d), Polo MW | München, Bavaria, Germany | • | #W181339 | • | Sales & Customer Support`

Mesuré sur les deux listes : **0 date au format `jj-Mmm-aaaa`**, 0 date sous une autre forme. À comparer avec les cartes L'Oréal du même ATS, qui portent « Posted 16-Jun-2026 » — c'est ce marqueur que l'adaptateur sait lire.

**Sur les fiches de détail** — sur les 6 fiches lues : **0 JSON-LD**, **0 `JobPosting`**, **0 littéral `datePosted`**, **0 occurrence de « posted » ou « publish »** dans le corps. La seule date présente est le badge **« Great Place To Work Certified AUG 2025-AUG 2026 »**, identique sur les 6 fiches. Ce n'est pas une date de publication : la promouvoir en `datePosted` **inventerait une date**, ce que la méthode interdit.

**L'élément qui tranche** : les listes contiennent un contrôle de tri `data-sortBy="postedDate"`, libellé « Sort jobs by Posted date ». **Le board Avature connaît donc une date de publication et permet de trier dessus, mais ne l'expose sur aucune carte ni sur aucune fiche publique.**

## Verdict

**Absence réelle sur les surfaces publiques collectées — ce n'est ni un défaut de collecte, ni d'archivage, ni de parsing, ni de transformation.**

- Pas un défaut de **parsing** : il n'y a rien à lire. `DATE_MARKER` n'échoue pas sur un format inattendu, il n'y a aucune date sur la carte, et aucune sur la fiche.
- Pas un défaut de **collecte** : les deux surfaces que l'adaptateur lit (liste et détail) ont été relues directement et archivées ; elles ne portent pas la donnée.
- Pas un défaut d'**archivage** : le RAW appauvri (`source`/`reference`/`department`) est une conséquence, pas la cause — la donnée n'existe pas en amont.

**Nuance à conserver, et elle est importante** : la date *existe* dans Avature (le tri en atteste). Elle n'est pas publiée sur les surfaces publiques. Dire « limite éditeur » serait donc imprécis : la formulation exacte est **« le tenant ne publie pas la date de publication sur les surfaces publiques accessibles, bien que son ATS la détienne »**.

## Portée de cette conclusion — ce qu'elle ne couvre pas

L'observation porte sur **2 listes et 6 fiches**, pas sur les 1 103 offres. Elle établit que **le gabarit du board** n'expose pas la date, ce qui est cohérent avec 1 103 offres non datées sur 1 104. Elle ne prouve pas offre par offre. L'offre unique qui *est* datée (1 sur 1 104) n'a pas été expliquée et reste un point ouvert.

## Suite : ce qui doit être fait, et ce qui ne doit pas l'être

- **Ne rien réparer sur ces 1 103 offres.** Aucune date ne peut être écrite sans l'inventer. Aucune suppression ni désindexation ne se justifie par la seule absence de `postedAt` : ces offres sont réelles, actives et atteignables.
- Conséquence assumée et **documentée, pas masquée** : elles restent **inéligibles Google Jobs** (`jobPostingSchema` rend `null` sans `datePosted`, et un `JobPosting` sans `datePosted` serait invalide). C'est la bonne décision : publier une date fausse pour gagner l'éligibilité tromperait le candidat et Google.
- **Piste du tri `postedDate` : explorée et close.** Deux surfaces triées ont été demandées et archivées (`sort-83463a3557.html` sha256 `a0837247…69151`, `sort-712529e200.html` sha256 `46775a5a…0f4d9`) : elles rendent bien des cartes (6 chacune) et **0 date**, sous aucun format — ni `jj-Mmm-aaaa`, ni ISO, ni relative. Demander le tri par date de publication ne fait pas afficher la date. Le dossier est donc figé sur l'observation, pas sur une hypothèse.

## Ce qui reste ouvert sur ce dossier

L'unique offre datée sur 1 104 n'est pas expliquée. Volume négligeable, mais c'est une anomalie non résolue, pas un détail à taire.

---

# Les 349 autres offres sans date : qualification par source

Les 1 452 offres sans `postedAt` se répartissent sur **10 sources**. Qualifiées hors ligne sur le RAW archivé, sans aucune collecte, par `scripts/coverage/undated-postings.mts` (`reference/undated-by-source.csv`).

| Source | ATS | Non datées | % datées de la source | Verdict hors ligne |
|---|---|---:|---:|---|
| `ralph-lauren-avature` | avature | 1 103 | 0,1 % | **absence réelle** — observation ci-dessus |
| `l-oreal-professionnel` | avature | 128 | 92,9 % | indécidable hors ligne (RAW sans champ de date) |
| `adidas` | successfactors | 63 | 94,5 % | indécidable hors ligne |
| `urbn-hub` | icims | 59 | 96,0 % | indécidable hors ligne |
| `lindex-easycruit` | easycruit | 41 | 0 % | **pas un défaut** : le RAW ne porte que `date_start`/`date_end`, dates de *vacance*, que l'adaptateur refuse délibérément de publier comme date de publication |
| `fenwick-volcanic` | volcanic | 31 | 0 % | indécidable hors ligne |
| `brown-thomas-taleo` | taleo | 12 | 84,2 % | indécidable hors ligne |
| `zegna-altamira` | altamira | 8 | 87,5 % | indécidable hors ligne |
| `element-6` | magnet | 5 | 98,8 % | RAW vide : archivage ou collecte |
| `uniqlo-hkm-headquarters` | workday | 2 | 66,7 % | **défaut prouvé** (ci-dessous) |

**Lecture importante** : les sources à 92–99 % datées ne sont pas des sources cassées. Leur poignée d'offres non datées est un résidu, pas un gabarit — l'inverse exact de Ralph Lauren (0,1 %) et de Lindex (0 %), où c'est la règle.

**Deux erreurs de classement corrigées en route**, toutes deux sur le même principe — *le sens d'un champ dépend de l'ATS, jamais de son nom* :
1. `lindex-easycruit` a d'abord été classé « défaut de parsing prouvé » parce que son RAW porte `date_start` sur les 41 offres. Lecture de l'adaptateur : ce sont des dates de vacance, et refuser de les promouvoir est une **décision documentée**, conforme à « n'inventer aucune date ».
2. À l'inverse, `jobPostingInfo.startDate` de Workday **est** la date de publication, déjà utilisée par l'adaptateur (commentaire F-05) — le classifieur allait la ranger parmi les champs non pertinents.

## `uniqlo-hkm-headquarters` — 2 offres : défaut réel, cause non établie

Mesuré sur les 6 offres de la source : **4 ont `postedAt` = `raw.detail.jobPostingInfo.startDate`**, 2 ont la date dans le RAW et `postedAt` nul. Ni multi-source (une seule attestation), ni retenue (`publicationHold` nul), ni structure différente (`jobPostingInfo` présent partout), ni rejet par `plausiblePostedAt` (dates passées : 2026-05-26 et 2026-07-29).

Le mécanisme est connu : la liste rend « Posted 30+ Days Ago », que `postedAtFromWorkday` laisse **indéfini à dessein** (« un plancher, pas une date »), et le détail doit ensuite écraser avec `startDate`. Pour ces deux offres le détail *a bien été récupéré* — il est dans le RAW — mais la date n'a pas atteint la colonne.

**La cause exacte n'est pas établie.** Conformément à la règle « corriger les causes établies avant de réparer les données », **aucune réparation n'est appliquée** : réécrire ces deux dates depuis le RAW corrigerait le symptôme et le laisserait revenir au prochain run. À instruire en P3, avec un rejeu de la source sur archive.

## Décision de réparation, pour l'ensemble des 1 452

**Aucune donnée n'est réparée dans ce lot**, et c'est le résultat correct :

- **1 103 (Ralph Lauren)** : aucune date n'existe à écrire. En inventer une serait une faute.
- **41 (Lindex)** : la seule date disponible est une date de vacance ; la publier comme date de publication serait un mensonge de type.
- **2 (UNIQLO)** : la donnée existe, mais la cause n'est pas établie — on corrige la cause avant la donnée.
- **306 restantes** : indécidables hors ligne ; chacune demande une observation de sa source, non ouverte dans ce lot.

**Aucune suppression ni désindexation** n'est motivée par l'absence de `postedAt`. Ces offres sont réelles, actives, atteignables (HTTP 200, sans `noindex`). Leur seule conséquence, **documentée et non masquée**, est de rester **inéligibles Google Jobs** : `jobPostingSchema` rend `null` sans `datePosted`, et un `JobPosting` sans date serait invalide. Perdre l'éligibilité sur 1,8 % du catalogue est préférable à publier des dates fausses sur ces offres.
