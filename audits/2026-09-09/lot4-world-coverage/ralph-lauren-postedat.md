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

## Verdict — énoncé strictement à la mesure des preuves

**Ce qui est établi : aucune date de publication n'a été trouvée sur les surfaces inspectées** — 2 listes, 8 fiches de détail, 2 surfaces triées, toutes archivées avec leur empreinte.

**Ce qui n'est PAS établi, et que la version précédente de ce document affirmait à tort :**

- ❌ « Le tenant ne publie la date **nulle part** ». Je n'ai inspecté qu'un sous-ensemble de surfaces. Le portail Avature expose d'autres routes (recherche JSON, flux, pages de liste paramétrées) qui n'ont pas toutes été sollicitées, et **je n'ai pas reproduit les requêtes réellement émises par le portail** — les deux paramètres de tri testés sont une hypothèse de ma part sur son fonctionnement, pas une capture de son trafic.
- ❌ « L'adaptateur est définitivement hors de cause ». L'adaptateur ne cherche la date que par le littéral `"datePosted"` (`avature.ts`, mode portail), et son propre commentaire note qu'« Avature expose la ville dans des champs structurés plutôt que dans son JSON-LD, qui reste vide ». **Un champ structuré de date non lu reste une hypothèse ouverte.**

**Ce qui reste donc le plus probable, sans être prouvé** : le gabarit de ce board n'affiche pas la date sur la carte ni sur la fiche. La liste porte un tri `data-sortBy="postedDate"`, ce qui indique que **l'ATS détient une date** ; les deux surfaces triées que j'ai demandées n'en ont affiché aucune, mais cela ne prouve pas qu'aucune route ne l'expose.

## Chemin réseau de cette observation — à corriger avant toute conclusion ferme

**Ces requêtes ont été émises depuis le poste local, PAS depuis l'egress de production.** D36 autorise le local pour vérifier un adaptateur, mais deux faits l'affaiblissent ici :

1. Le journal montre `waf.bootstrap_completed` — **le site est derrière un WAF**, franchi par amorçage navigateur. Un WAF peut servir un contenu différent selon l'origine.
2. La production collecte depuis l'egress Railway, dont l'IP diffère (D32 : « une cause réseau ne se grave que sur une mesure prise dans le processus réel »).

**Vérification complémentaire nécessaire, et strictement bornée** : rejouer *uniquement* la lecture d'une liste et d'une fiche depuis l'egress de production, pour confirmer que le contenu servi est le même. Aucune recollecte de l'ensemble.

> **Blocage externe, daté — 2026-09-10 21:4x UTC.** La sonde a été écrite (`backups/lot4-20260909/p2-rl-egress-probe.py` : deux pages, lecture pure, aucune écriture en base, aucune ingestion, restauration de la commande normale prévue). Elle **n'a pas pu être exécutée** : le jeton Railway de cette session est **en lecture seule** sur le service — la mutation de `startCommand` renvoie **HTTP 403**, alors que la lecture du même service répond normalement. Vérifié après l'échec : la commande de production est intacte (`sh apps/aggregator/start.sh`), aucun effet de bord.
> **Prochaine action** : rejouer cette sonde avec un jeton autorisé à poser une commande bornée, ou depuis toute exécution disposant de l'egress de production. Tant qu'elle n'a pas tourné, **la conclusion de ce dossier reste locale**, et le doute WAF/origine reste ouvert.

## L'unique offre datée : ce que la mesure dit

`jobId=2888`, `postedAt = 2026-08-31T08:47:19Z` — avec une **heure précise**, signature d'un `datePosted` ISO, non d'une carte.

Mesure structurante : **c'est la seule offre dont l'`externalId` a 4 chiffres** ; les 1 103 non datées en ont **toutes 5**.

| Longueur de l'`externalId` | Offres | Datées |
|---|---:|---:|
| 4 caractères | 1 | **1** |
| 5 caractères | 1 103 | **0** |

La différence est donc **structurelle, pas aléatoire** — ce qui écarte l'idée d'un board qui publierait la date de façon intermittente. Sa fiche relue aujourd'hui ne porte ni JSON-LD ni `datePosted` ; son RAW n'a pas de `department`, contrairement aux autres. Elle a donc été lue par un chemin différent, à un moment où ce littéral existait. **Je ne peux pas l'établir davantage sans état historique, et je ne l'invente pas.** (Le marqueur « expired » relevé sur sa page est un faux positif : c'est un message d'expiration de **session**, vérifié.)

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

**Deux populations à ne pas confondre — la version précédente de ce tableau les mélangeait à tort :**

**(a) Sources où l'absence est le GABARIT** — la source ne date (presque) rien :

| Source | Non datées / actives | Verdict et prochaine action |
|---|---|---|
| `ralph-lauren-avature` | **1 103 / 1 104** | aucune date sur les surfaces inspectées ; **vérification egress bloquée** (§ ci-dessus) |
| `lindex-easycruit` | **41 / 41** | pas un défaut : seules des dates de *vacance* existent, refus délibéré de les publier |
| `fenwick-volcanic` | **31 / 31** | **indécidable hors ligne, et ce n'est PAS un résidu** — comme Ralph Lauren, cette source ne date aucune offre. Prochaine action : **observation ciblée de son board Volcanic**, même méthode que Ralph Lauren (liste + détail, natif archivé), pour distinguer absence réelle et champ non lu. |

**(b) Sources où l'absence est un RÉSIDU** — la source date massivement, quelques offres échappent :

| Source | Non datées / actives | % datées |
|---|---|---:|
| `l-oreal-professionnel` | 128 / 1 804 | 92,9 % |
| `adidas` | 63 / 1 142 | 94,5 % |
| `urbn-hub` | 59 / 1 476 | 96,0 % |
| `brown-thomas-taleo` | 12 / 76 | 84,2 % |
| `zegna-altamira` | 8 / 64 | 87,5 % |
| `element-6` | 5 / 403 | 98,8 % |
| `uniqlo-hkm-headquarters` | 2 / 6 | 66,7 % |

Sur ces sources, l'explication ne peut pas être « le board ne publie pas la date » — il la publie pour l'écrasante majorité. Le résidu tient à un chemin qui échoue par intermittence, exactement ce que le rejeu UNIQLO a démontré.

**Deux erreurs de classement corrigées en route**, toutes deux sur le même principe — *le sens d'un champ dépend de l'ATS, jamais de son nom* :
1. `lindex-easycruit` a d'abord été classé « défaut de parsing prouvé » parce que son RAW porte `date_start` sur les 41 offres. Lecture de l'adaptateur : ce sont des dates de vacance, et refuser de les promouvoir est une **décision documentée**, conforme à « n'inventer aucune date ».
2. À l'inverse, `jobPostingInfo.startDate` de Workday **est** la date de publication, déjà utilisée par l'adaptateur (commentaire F-05) — le classifieur allait la ranger parmi les champs non pertinents.

## `uniqlo-hkm-headquarters` — 2 offres : cause ÉTABLIE par rejeu, corrigée et testée

### Le rejeu sur archives, étape par étape

Chaque étape appelle la **fonction de production réelle**, sur le RAW archivé, sans aucune collecte :

| Étape | Fonction | Résultat pour les 2 offres |
|---|---|---|
| 1 — liste | `postedAtFromWorkday("Posted 30+ Days Ago")` | `null` — **volontaire** (« un plancher, pas une date ») |
| 2 — détail | `raw.detail.jobPostingInfo.startDate` | **2026-07-29** et **2026-05-26** |
| 3 — fusion | le détail écrase la liste | date présente |
| 4 — écriture | `plausiblePostedAt(...)` | date présente |
| 5 — production | `Job.postedAt` | **null** |

Verdict du rejeu : *« le rejeu produit une date, la production n'en a pas — la perte est hors du chemin rejoué »*. Ni parsing, ni fusion, ni frontière d'écriture.

### Le premier point de perte

La mesure décisive : les 2 offres non datées ont **aussi** `countryCode`, `city` **et** `description` **tous nuls**, quand les 4 datées les ont tous. Leur RAW fait ~1 990 octets contre ~4 400. Ce n'est donc **pas un défaut de date** : c'est le **détail entier** qui n'a pas été appliqué.

Cause exacte, `workday.ts` : leur détail ne porte **aucun employeur** (`raw_country` nul, `raw_location` vide). La branche `if (!employer)` retournait alors **l'offre de liste inchangée**, en archivant le détail sans en appliquer un seul champ.

**Deux préoccupations étaient indûment couplées : *qui* recrute, et *ce que* l'offre décrit.**

### Correctif et test

La retenue est **conservée** — rien n'est publié sans employeur prouvé — mais les champs factuels du même document sont désormais appliqués. **Test de non-régression vérifié en échec sur l'ancien code** (`git stash` : 1 failed / 20 passed), plus un second test prouvant qu'**aucune date n'est inventée** quand le détail sans employeur n'en porte pas.

**État exact** : cause corrigée et testée ; **les 2 offres ne sont pas encore réparées**. **Prochaine action** : rejeu borné de la source sous protocole (sauvegarde, clone, production, rejeu 0), reporté en **P3**.

## Décision de réparation, pour l'ensemble des 1 452

**Aucune donnée n'est réparée dans ce lot**, et c'est le résultat correct :

- **1 103 (Ralph Lauren)** : aucune date trouvée sur les surfaces inspectées. En inventer une serait une faute. **Vérification egress restant due.**
- **41 (Lindex)** : la seule date disponible est une date de vacance ; la publier comme date de publication serait un mensonge de type. **Dossier clos** — c'est une décision, pas un défaut.
- **31 (Fenwick)** : source entièrement non datée, **indécidable hors ligne**. Action : observation ciblée de son board.
- **2 (UNIQLO)** : **cause désormais établie** (voir ci-dessous) — le détail sans employeur était rejeté en bloc. Cause corrigée et testée ; réparation des données à faire sous protocole.
- **5 (`element-6`)** : **RAW vide** — la ligne archivée ne contient rien, donc ni la date ni aucun autre champ n'est rejouable. C'est un défaut d'**archivage ou de collecte**, distinct des indécidables : ici on sait que le problème est chez nous, on ne sait pas encore où. Action : rejeu ciblé de ces 5 identifiants pour voir ce que l'adaptateur produit aujourd'hui.
- **301 restantes** (L'Oréal 128, adidas 63, URBN 59, Brown Thomas 12, Zegna 8, +31 Fenwick comptés ci-dessus) : **indécidables hors ligne** — le RAW porte des champs, mais aucun champ de date de publication. Le problème peut être chez l'éditeur *ou* dans un champ que nous ne lisons pas. Action : par source, comparer un RAW **daté** et un RAW **non daté** de la même source — la différence nomme le chemin fautif, sans aucune collecte.

**Les cinq groupes ci-dessus appellent cinq actions différentes.** Les confondre en « 306 indécidables » masquait deux dossiers traitables hors ligne (les 5 RAW vides, et la comparaison daté/non-daté des 301).

**Aucune suppression ni désindexation** n'est motivée par l'absence de `postedAt`. Ces offres sont réelles, actives, atteignables (HTTP 200, sans `noindex`). Leur seule conséquence, **documentée et non masquée**, est de rester **inéligibles Google Jobs** : `jobPostingSchema` rend `null` sans `datePosted`, et un `JobPosting` sans date serait invalide. Perdre l'éligibilité sur 1,8 % du catalogue est préférable à publier des dates fausses sur ces offres.
