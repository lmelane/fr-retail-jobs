# P8 — les trois corpus de mesure, figés avant exécution

> Figés le 2026-09-13 sur le commit `6cae8a94`. Volumes et hôtes **lus en base**, jamais estimés. Ce document
> ne bouge plus une fois T0 lancé : un corpus qu'on ajuste en cours de route ne mesure plus rien de comparable.

## Ce que P8 refuse de faire

Aucun bombardement synthétique, aucune duplication d'une source pour simuler la charge, aucune montée en
concurrence dans le seul but de trouver le point de rupture. Les portails ATS sont des services de tiers, pas
un banc d'essai. Toute mesure vient de **vraies sources, de vrais endpoints, en passes bornées** — et une
réponse 429 ou hostile arrête la passe immédiatement.

Corollaire sur le choix des corpus : **un corpus n'est pas choisi pour produire un joli débit.** Il doit
ressembler à la charge que P9 créera réellement, y compris dans ce qu'elle a d'ingrat.

## T0 — sanité de l'instrumentation

Les trois sources de la référence P7, sur trois ATS sans code commun.

| Source | Famille | Hôte | Repr. |
|---|---|---|--:|
| `mecca` | Workday | `mecca.wd3.myworkdayjobs.com` | 181 |
| `ganni-talentrecruiter` | TalentRecruiter | `candidate.hr-manager.net` | 17 |
| `american-vintage-dr` | DigitalRecruiters | `careers.am-vintage.com` | 31 |

**But** : vérifier que chaque métrique est réellement collectée, établir une référence reproductible, et
**ne modifier aucune donnée** au second passage. T0 ne mesure pas la capacité — il mesure l'instrument.

## T1 — les neuf familles de la vague initiale

| Source | Famille | Hôte | Repr. | Refresh |
|---|---|---|--:|---|
| `urbn-hub` | iCIMS | `hub-urbn.icims.com` | 1 558 | interdit |
| `mecca` | Workday | `mecca.wd3.myworkdayjobs.com` | 181 | autorisé |
| `beiersdorf` | generic-listing | `www.beiersdorf.com` | 168 | interdit |
| `lagardere-travel-retail` | Talentsoft | `lagardere-recrute.talent-soft.com` | 130 | interdit |
| `dr-pierre-ricaud` | SuccessFactors | `careers.groupe-rocher.com` | 72 | interdit |
| `lindex-easycruit` | EasyCruit | `lindex.easycruit.com` | 50 | interdit |
| `saltrock-harri` | Harri | `harri.com` | 36 | interdit |
| `american-vintage-dr` | DigitalRecruiters | `careers.am-vintage.com` | 31 | autorisé |
| `ganni-talentrecruiter` | TalentRecruiter | `candidate.hr-manager.net` | 17 | autorisé |

**9 sources · 9 familles · 9 hôtes distincts · 2 243 représentations.**

Les six sources sans `canonicalIds` (P7) sont **autorisées pour l'ingestion et la mesure de capacité**,
**interdites de refresh**, et **exclues de toute conclusion sur la fermeture par absence**. Mesurer leur coût
n'exige pas de leur accorder le droit de fermer une offre.

## T2 — capacité élargie réelle

Tiré **exclusivement** des 50 sources admises par P6 (13 321 représentations, 9 familles).

### La contrainte qui a dicté la sélection

Le vivier P6 est **dominé par Workday (31 sources / 10 193 repr.)** et surtout : **18 des 50 sources partagent
un seul hôte**, `fastretailing.wd3.myworkdayjobs.com`. Les prendre ensemble aurait mesuré **le débit que ce
tenant nous concède**, pas la capacité de notre pipeline — et aurait martelé un hôte unique, ce que la porte
par hôte (D25) existe précisément pour éviter.

**Règle appliquée : au plus 1 source par hôte dans T2.** `uniqlo-us-retail` représente à elle seule le tenant
Fast Retailing.

### Le corpus figé

| Source | Famille | Repr. | Dernier run | Motif de présence |
|---|---|--:|---|---|
| `knitwell-us-retail` | Workday | 1 997 | DEGRADED¹ | plus gros volume du vivier |
| `mango` | Workday | 1 697 | OK | gros volume sain |
| `nordstrom` | Workday | 1 575 | DEGRADED¹ | gros volume, archivage |
| `urbn-hub` | iCIMS | 1 558 | OK | seule de sa famille, gros volume |
| `richemont-workday` | Workday | 1 433 | OK | multi-maisons |
| `saks` | Workday | 835 | OK | volume moyen |
| `deckers` | Workday | 424 | OK | volume moyen |
| `uniqlo-us-retail` | Workday | 347 | NEW² | **une seule** du tenant partagé à 18 |
| `jean-paul-gaultier-5` | SuccessFactors | 249 | OK | plus grosse de sa famille |
| `aptar-beauty` | SuccessFactors | 190 | DEGRADED¹ | couverture de champ |
| `mecca` | Workday | 181 | OK | continuité avec T0 |
| `beiersdorf` | generic-listing | 168 | OK | seule de sa famille |
| `lagardere-travel-retail` | Talentsoft | 130 | OK | famille Talentsoft |
| `dr-pierre-ricaud` | SuccessFactors | 72 | OK | source légère |
| `lindex-easycruit` | EasyCruit | 50 | OK | seule de sa famille |
| `saltrock-harri` | Harri | 36 | OK | seule de sa famille |
| `american-vintage-dr` | DigitalRecruiters | 31 | OK | seule de sa famille |
| `ganni-talentrecruiter` | TalentRecruiter | 17 | OK | seule de sa famille |

**18 sources · 9 familles · 18 hôtes distincts · 10 990 représentations** — soit **83 %** du volume du vivier
P6 avec **36 %** de ses sources, sans jamais empiler deux sources sur un hôte.

### ¹ Les DEGRADED sont qualifiés, pas subis

Aucune source à erreur **non qualifiée** n'entre dans T2. Les quatre DEGRADED retenus ont été lus à la source :

| Source | Ce que DEGRADED signifie ici | Troncature |
|---|---|---|
| `knitwell-us-retail` | 1 999/2 000 lues, 1 ligne `ROW_WITHOUT_EXTERNAL_PATH` (ligne Workday anonyme, observée mais sans identifiant) | non |
| `nordstrom` | 1 299/1 299 lues, 1 annonce non publiable archivée | non |
| `aptar-beauty` | 216/216 lues, description 98,9 % | non |
| `vf-corporation` | *écarté* — 695 annonces non publiables non résolues, volume d'anomalie trop élevé pour un corpus de référence | non |

Aucune n'est tronquée, toutes ont parcouru leur board entier. Un défaut de **couverture de champ** n'est pas
un défaut de **collecte** (D51).

### ² `NEW` n'est pas un échec

`NEW` signifie « aucun run antérieur » (`health.ts:169`), pas « run raté ». La confondre avec un échec a déjà
coûté une fausse alerte pendant ce lot ; `uniqlo-us-retail` est donc admise sans réserve.

## Risques connus, avant exécution

| Risque | Où | Conduite |
|---|---|---|
| Volume Workday concentré | 8 sources sur 18 | mesuré **par famille**, jamais globalisé |
| `hub-urbn.icims.com` : 1 558 repr. sur un hôte | T1 et T2 | porte par hôte (D25) inchangée |
| Lignes Workday anonymes | `knitwell-us-retail` | comptées comme observées, **jamais** comme absentes |
| Cloudflare / WAF | historique L'Oréal, Michael Page | `CHALLENGED` exclut de la clôture ; arrêt sur 429 |
| Durée du préflight (~4 min : dump + restauration + comparaison) | chaque passe | comptée hors débit de collecte |
