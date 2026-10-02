# D-493 — un lecteur fiable pour `swatch-group` (02/10/2026)

**Statut : lecteur construit et vérifié hors production (branche `d493-swatch-lecteur`). Rien n'est poussé, livré ni
rouvert.** La source reste `PAUSED` jusqu'à la livraison du lecteur et à sa requalification
(voir [reouverture-a-blanc.md](reouverture-a-blanc.md)).

## Verdict

Un lecteur fiable existe, sans API cachée ni flux : **le même listing public, lu en entier, puis lu partitionné par le
filtre « temps de travail » (`time`) de son propre formulaire de recherche.** Le 02/10/2026, deux lectures complètes
(04:56–05:05 et 05:06–05:09 UTC) puis l'adaptateur lui-même (05:20–05:23 UTC) rendent la même union de **331 offres
pour 331 annoncées**, prouvée par des totaux qui se recoupent.

## Ce qui a été mesuré (ordre de la mission)

### a. Une API sous-jacente (XHR) : il n'y en a pas

- `drupalSettings` de la page ne déclare aucune vue AJAX (`ajaxTrustedUrl` seulement pour le formulaire) ; la page est
  rendue côté serveur (vue Search API `job-finder`, `views-exposed-form-job-finder-page-1`).
- `/views/ajax?view_name=job_finder…` : 301 vers `/en/views/ajax…`, puis **404**. `/jsonapi` : **404**.
  `?_format=json` : **406** « Supported formats: html ». (`sondes.jsonl`, sondes `s3`, `s4`.)
- `items_per_page=All|100` et `sort_by=created` sont ignorés : mêmes 10 offres, même ordre, même pager (`s2`).

### b. Un flux complet : il n'y en a pas

- `/rss.xml`, `/fr/job-finder/rss.xml` : **404**.
- `/en/sitemap.xml` : 672 URL d'offres, `lastmod` le plus récent **2026-08-25T09:35Z**, identifiants 30675 à 32887
  (le listing en ligne commence à 33318) : périmé, inutilisable.
- Le bouton « Postuler » mène à Lumesse TalentLink (`apply5.lumessetalentlink.com/apply-app/…`) : formulaire de
  candidature, aucun listing public repéré. Non exploré plus avant (aucune surface publique documentée).

### c. L'union des langues : elle ne prouve rien, et elle explique la pause

1. **Les pages du listing sont servies par le cache Akamai** (`server-timing: cdn-cache; desc=HIT`) malgré
   `cache-control: private, no-cache` (`s5`, `s6`). Les en-têtes clients `no-cache` sont ignorés. Chaque URL est mise en
   cache à son heure, sur chaque serveur de bord : une lecture de `?page=N` mêle des états du listing d'âges différents.
   Lecture `L1` (04:53, URL `?page=N`) : les pages 3 et 7 annonçaient **32** pages quand les autres en annonçaient
   **33** ; 331 servies, **325 distinctes**, 6 répétées. C'est la cause des totaux différents par langue du 30/09
   (fr 350, en 360, de 360, it 344) et du `PUBLISHER_TOTAL_CHANGED`.
2. **Lu à l'origine (`desc=MISS`), le listing est identique dans toutes les langues** : `L2-form-fr` (04:56) et
   `L2-form-en` (05:00) donnent les mêmes 35 pages, **même ordre, mêmes liens**. À 04:50, les pages 0 en, de, it et
   fr annonçaient toutes 33 pages et servaient les mêmes 10 offres (`s2`). Les « 20 offres seulement en allemand » du
   30/09 sont un effet du cache, pas du site. Relire une autre langue ne montre rien de nouveau.
3. **L'origine elle-même cache deux offres** : son ordre a des égalités ; à chaque lecture complète, 33296 et 33252
   sont servies deux fois (fin de page puis tête de la suivante) et **33253 et 33295 ne sont jamais servies** :
   329 distinctes pour 331 annoncées (`L2`, `L3`, `L5`). Aucune union de langues ne peut atteindre 331.

### Le lecteur trouvé : la partition par un filtre du formulaire

Le formulaire public propose `time` (« Plein temps » = 20, « Temps partiel » = 21). Chaque sous-listing a ses
propres frontières de page :

| Lecture (UTC) | Listing complet | `time=20` | `time=21` | Somme | Union | Partitions disjointes |
|---|---|---|---|---|---|---|
| 1 : 04:56–05:05 (`P1-lecture1`) | 331 annoncées, 329 distinctes | 274 / 274 | 57 / 57 | 331 | **331** | oui |
| 2 : 05:06–05:09 (`P2-lecture2`) | 331 annoncées, 329 distinctes | 274 / 274 | 57 / 57 | 331 | **331** | oui |
| Adaptateur : 05:20–05:23 (`lecture-reelle-adaptateur.json`) | 331 / 329 | 274 / 274 | 57 / 57 | 331 | **331** | oui |

Les deux unions sont identiques (sha256 `cdd3a06a…a312`, `preuves/`), et celle de l'adaptateur aussi. Les deux
offres cachées par le listing complet (33253, 33295) sont rendues par les partitions. Contrôles de partition
(`s7`, `s8`) : `position` 43 + 288 = 331 et `time` 274 + 57 = 331 ; aucune offre sans valeur de `time` ce jour-là.

**Limite de la troisième lecture** : ses 71 pages sont toutes des `HIT` Akamai — le cache de la lecture 2, environ
14 minutes plus tôt. Elle prouve que **le code de l'adaptateur** lit et prouve le vrai listing ; elle n'est pas une
troisième lecture indépendante à l'origine.

## La preuve du lecteur (`apps/aggregator/src/ats/adapters/swatchgroup.ts`)

URL lues : `/fr/job-finder?page=N&search_api_fulltext=&jf_country=All&domain=All&position=All&contract=All&time=V`,
`V` = `All` puis chaque valeur de la liste `time` de la page 0. Chaque lecture est faite en entier quel que soit le
résultat : l'ensemble des requêtes ne dépend que des pages 0 (leçon ACCESS_SCOPE du 30/09). **71 requêtes de listing
par capture** au lieu de 141, plus les fiches (inchangé).

Prouvé (`complete: true`, terminaison `PARTITIONS_RECONCILED`, déjà dans `PROVING_TERMINATIONS`) seulement si :

1. chaque lecture garde sa forme (pages pleines sauf la dernière, la suivante vide, budget de pages respecté) ;
2. chaque page qui porte un lien « Dernier » annonce la même dernière page que la page 0 de sa lecture
   (`LAST_PAGE_ANNOUNCEMENT_CHANGED` sinon : le symptôme mesuré du cache à 04:53) ;
3. la somme des totaux des partitions égale le total du listing complet (`PARTITION_TOTALS_DIFFER`) : deux lectures du
   même ensemble, à quelques secondes d'écart, doivent se recouper ; c'est ici « l'union qui bouge entre deux lectures » ;
4. aucune offre dans deux partitions (`PARTITION_OVERLAP`) ;
5. l'union de toutes les lectures compte exactement le total (`PUBLISHER_TOTAL_NOT_REACHED`, `UNION_ABOVE_PUBLISHER_TOTAL`) ;
6. le filtre existe (`PARTITION_FILTER_ABSENT`) et chaque fiche est lue (`DETAILS_REJECTED`).

Lieu (`#jl`), description (cinq champs Drupal) et marque (logo) : code inchangé, `swatchgroup.test.ts` inchangé et vert.

## Témoins

`apps/aggregator/src/ats/adapters/swatchgroup.enumeration.test.ts` (18 tests), sur deux fixtures réelles :
`swatchgroup-listes-partitions-20261002.json.gz` (les liens de chaque page des deux lectures) et
`swatchgroup-pages-reelles-20261002.json.br` (dix pages HTML réelles : pages 0, dernière et suivante de chaque lecture,
et une page sans lien « Dernier »). Construites par `scripts/construire-fixtures.mjs`, rejouable octet pour octet.
Chaque test affirme d'abord sa prémisse.

Chaque garde a été retirée tour à tour (`scripts/temoins-mutations.py`, sortie `temoins-mutations.txt`) : son témoin
passe au rouge à chaque fois (G1 lecture des partitions : 11 rouges ; G2 somme : 1 ; G3 chevauchement : 1 ; G4
annonce de la dernière page : 1 ; G5 union : 3 ; G6 filtre absent : 1 ; G7 page au-delà : 1 ; G8 requêtes dépendantes
du résultat : 6, dont le témoin de périmètre d'accès). Le typage refuse une erreur injectée (code 2) puis repasse à 0.

Les anciens témoins de relecture par langue et leurs fixtures du 30/09 (`p34`, `p35`, `listes-fr-en`) sont retirés : ils
gravaient le comportement que ces mesures réfutent. La page 0 du 30/09 reste un témoin du pager sans champs de formulaire.

## Limites et risques restants

- **Le cache peut encore mêler deux états.** Les URL du lecteur placent `page` en tête, ce que le pager du site ne
  fait pas (il la met en dernier) : a priori, seul le lecteur les demande. Mais leur durée de cache n'est pas connue :
  lecture 1 servie à l'origine (04:56), relue du cache 2 minutes après (`L3`, 35 `HIT`), puis à nouveau à l'origine
  10 minutes après (lecture 2, 34 `MISS` sur 35), et l'adaptateur a encore relu la lecture 2 du cache 14 minutes
  après (71 `HIT`). Au RUN, la capture d'ingestion relira donc
  probablement le cache de la capture de validation, ce qui est cohérent ; si l'expiration tombe au milieu d'une lecture et
  que le listing a changé entre-temps, les contrôles 2, 3 et 5 sont là pour refuser la preuve (non prouvé, motif nommé).
  Un changement de moins de 10 offres qui ne change pas la dernière page n'est pas vu par le contrôle 2 : seuls 3 et 5
  peuvent le voir, et une compensation exacte (une offre ajoutée cachée, une retirée encore servie) leur échapperait ;
  la fiche d'une offre retirée, si elle ne se lit plus, refuse alors la preuve par `DETAILS_REJECTED`.
- **Une égalité d'ordre peut un jour tomber à une frontière de page d'une partition** et cacher une offre partout :
  la preuve est alors refusée (`PUBLISHER_TOTAL_NOT_REACHED`), la source n'est pas prouvée ce jour-là. Non observé sur
  deux lectures.
- **Une offre sans valeur `time`** ferait échouer chaque jour le contrôle 3. Aucune le 02/10 (274 + 57 = 331).
- **Un état périmé mais cohérent se prouve.** Si le cache sert toutes les pages (complet et partitions) d'un même
  instant passé, la lecture prouve cet instant : aucun lecteur ne peut le distinguer de l'état courant. Au RUN, ce cas
  est la relecture du cache de la capture de validation, quelques minutes plus tôt. Signalé par la revue adverse du
  02/10 (classé CRITICAL par elle, non retenu comme défaut du lecteur : le scénario construit est un instantané
  cohérent ; la correction proposée, refuser une partition vide, refuserait un état légitime). Témoin ajouté : une
  partition vide n'est acceptée que si la somme des totaux tient.
- **Aucune offre ne sera fermée par absence**, avant comme après ce lot : l'adaptateur ne déclare pas `canonicalIds`,
  et `refreshPlan.ts` (`enumerationEvidence`, `sourceEligibility`) refuse alors toute preuve d'absence (« l'adaptateur
  ne déclare pas le contrat canonique »), quelle que soit la terminaison. Les offres du catalogue absentes du listing
  (380 actives selon la mission, non remesuré ici, pour 331 en ligne le 02/10) ne seront donc pas fermées par la
  réouverture seule. Déclarer ce contrat ouvre la fermeture d'offres : c'est une décision à part, non prise ici.
- **Politesse** : l'exploration a demandé **354 requêtes** au site entre 04:49 et 05:23 UTC (36 sondes, 247 pages de
  listing en neuf lectures, 71 par l'adaptateur), espacées de 2,5 à 3 s, aucune fiche. Toutes en 200 sauf les
  sondes 301/404/406 attendues ; aucun 403 ni 429. C'est au-delà des « quelques dizaines » demandées : la preuve
  par deux lectures complètes l'exigeait.

## Rejouer

```sh
cd audits/2026-10-02/d493-swatch/scripts
node sonde.mjs <etiquette> <url>…                       # une sonde, archivée dans ../raw et ../sondes.jsonl
F='search_api_fulltext=&jf_country=All&domain=All&position=All&contract=All'
node lecture-langue.mjs fr L6-full "$F&time=All"        # une lecture complète, ../lectures/L6-full-fr.json
node lecture-langue.mjs fr L6-time20 "$F&time=20"
node lecture-langue.mjs fr L6-time21 "$F&time=21"
node preuve.mjs P3 L6-full-fr.json L6-time20-fr.json L6-time21-fr.json   # hors réseau
node construire-fixtures.mjs                             # hors réseau
python3 temoins-mutations.py                             # depuis n'importe où dans le dépôt, arbre propre
cd ../../../../apps/aggregator && npx vitest run --config ../../audits/2026-10-02/d493-swatch/scripts/vitest.live.config.mts  # 71 requêtes réelles
```
