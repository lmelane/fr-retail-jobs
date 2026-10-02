# Réouverture de Ralph Lauren (D-483) et de Marc O'Polo (D-485, D-489) — préparation À BLANC de la prochaine release

**Rien de ce qui suit n'a été exécuté en production.** Toutes les lectures de production de ce dossier sont faites par
`db.py readonly` (02/10/2026, vers 05:00 UTC). La release, ses écritures et la réouverture restent sous GO de Loïc,
hors de la fenêtre du RUN (jamais entre 15:30 et 18:30 UTC).

## 1. État mesuré en production (lecture seule, 02/10/2026)

| Source | Statut | Révision courante | `portalScope` | Domaine officiel de la Maison |
|---|---|---|---|---|
| `ralph-lauren-avature` | `PAUSED` (D-483) | `de332ddf-b45d-42fa-a89e-9ab1106e0d62` (v1) | **NULL** | `ralphlauren.com` (`RALPH_LAUREN`) |
| `marc-o-polo` | `PAUSED` (D-485) | `8bcea0c7-130d-4dda-97a6-2d71fcdcabdd` (v1), config `{"startUrl": ".../en/career"}` (lecteur générique) | NULL | `marc-o-polo.com` (`MARC_O_POLO`) |

- Dernière migration appliquée : `20261001200000_requetes_tapees`. La migration du lot D-483 n'est appliquée nulle part.
- `CaptureOutcome` : 21 186 lignes, 8,9 Mo ; valeurs de `transportCoverage` : `HTTP_ONLY` 10 327, NULL 10 857,
  `UNSUPPORTED_TRANSPORT` 2, toutes admises par la contrainte élargie (validation instantanée).
- **Ralph Lauren n'a pas de `portalScope`** : D-481 §2 (« la certification du portail Ralph Lauren est validée,
  registre relu, mécanisme de D-478 ») n'a pas été exécutée. Sans elle, ses offres, qui ne nomment pas leur employeur,
  seraient refusées pour identité comme le 29/09 (1 131). Le geste est préparé ci-dessous (étape 4a).
- Ralph Lauren n'a aucune `SourceIdentityReview` ; Marc O'Polo en a trois (18-20/09) sur sa révision v1, que la
  correction de configuration rend caduques (nouvelle révision).

## 2. Ce que `development` porte désormais (intégré le 02/10/2026)

- **D-483** (`af43994..5ec6f83` du worktree `agent-a0978c1d87237fef7`), rejoué sur `development` sans conflit. La
  migration est **renommée `20261002100000_waf_bootstrap_access`** (contenu inchangé) : sous son nom d'origine
  `20260930120000`, elle aurait été la seule en attente au milieu de l'historique déjà appliqué. Les critères
  d'acceptation (`audits/2026-09-30/d483-amorcage-waf/criteres-acceptation.md`) portent le nouveau nom.
- **D-485 / D-489** (`d485-marc-o-polo`, tête `25b234d`, D-489 en `0b58722`), rejoué ; un conflit d'import dans
  `genericJsonLd.ts` (les deux côtés ajoutaient un import) résolu en gardant les deux.
- Un témoin d'avant D-483 (`capture.test.ts`, amorçage général dans toute collecte) contredisait le lot : il suit
  désormais la règle D-483 (aucune collecte hors politique d'accès ne lance de navigateur).
- `npm run test:local` complet vert sur l'état intégré.

## 3. Preuves locales des lecteurs (lecture seule, réseau réel, aucune base)

- **Ralph Lauren**, `mesure-amorcage-borne-20261002.json` (`scripts/ops/mesure-amorcage-waf-d483.mts --borne`, code
  intégré, 05:02 UTC) : la liste Corporate répond **202 `challenge`** ; l'amorçage borné passe par **5 requêtes**
  (26 refusées par l'autorisation du lot), jeton `aws-waf-token` en **5,0 s** ; la même liste munie du jeton répond
  **200**, 6 cartes, **233 offres annoncées** (Corporate ; 225 le 30/09). robots.txt : liste et fiche autorisées.
  Une collecte complète (≈ 1 300 requêtes) n'a pas été rejouée en local : elle est la collecte ciblée de la
  réouverture, jugée par les dix critères de `criteres-acceptation.md`.
- **Marc O'Polo**, `collecte-locale-marc-o-polo.json` (`scripts/collecte-locale-marc-o-polo.mts`, lecteur dédié
  intégré, configuration que le registre relu écrira) : voir §6.

## 4. Commandes, dans l'ordre (à blanc)

Préalables : `development` promue sur `main` par Loïc au SHA de la release, CI verte, images construites ; dossier de
release `~/.catwalks/release-agregateur-<date>/` sur le modèle de `release-agregateur-20261002-r4` (`release.py`,
`params.json` : sha, run, code). Toutes les commandes `db.py` se lancent depuis la copie `code/` de ce dossier, avec
`CATWALKS_DB_ACCESS=/Users/lmelane/Downloads/catwalks-job-aggregator/backups/remediation-20260908`.

```sh
R=~/.catwalks/release-agregateur-<date>
python3 $R/release.py snapshot
# 1. Migration additive AVANT le code (contrainte élargie + déclencheur ; l'ancien code n'écrit jamais la valeur neuve)
python3 $R/release.py migrate
# 2. Images : worker et direct-sync (worker en pause, sans CRON), puis l'API
#    (l'API porte aussi l'ouverture de /api/suggest?type=city à la clé du backend ; CATALOGUE_API_KEY_BACKEND y est déjà posée)
python3 $R/release.py deploy
python3 $R/release.py deploy-api
python3 $R/release.py check api-paused
```

### 4a. Registre relu (écritures de production, GO requis)

```sh
cd $R/code
# Ralph Lauren : le portail certifié de D-481 §2 (SINGLE_BRAND) ; n'ajoute pas de révision (portalScope hors empreinte)
python3 apps/aggregator/scripts/ops/db.py readonly   npx tsx apps/aggregator/scripts/ops/importer-registre-csv.mts audits/2026-10-02/reouverture-rl-mop/portail-ralph-lauren-d481.csv
python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/scripts/ops/importer-registre-csv.mts audits/2026-10-02/reouverture-rl-mop/portail-ralph-lauren-d481.csv --ecrire
# Marc O'Polo : le lecteur dédié (D-485) ; crée une révision v2 (déclencheur Source_record_revision)
python3 apps/aggregator/scripts/ops/db.py readonly   npx tsx apps/aggregator/scripts/ops/corriger-sources-relues.mts audits/2026-09-30/marc-o-polo/registre-relu-marc-o-polo.csv
python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/scripts/ops/corriger-sources-relues.mts audits/2026-09-30/marc-o-polo/registre-relu-marc-o-polo.csv --ecrire
# La révision à requalifier, relue après l'écriture (jamais devinée)
python3 apps/aggregator/scripts/ops/db.py readonly sh -c 'psql "$DATABASE_URL" -XAt -c "select key, \"currentRevisionId\", \"portalScope\", status, config::text from \"Source\" where key in ('"'"'ralph-lauren-avature'"'"','"'"'marc-o-polo'"'"')"'
```

Inspection déjà rejouée le 02/10 (lecture seule) : `importer-registre-csv` → « 1 portalScope à écrire, 0 à retirer,
0 en pause » ; `corriger-sources-relues` → `marc-o-polo generic-listing → generic-listing`, config
`{"startUrl":"https://company.marc-o-polo.com/en/career/start-creating-with-us/our-jobs","reader":"marc-o-polo-vacancies","apiUrl":"https://vhfco59ro6.execute-api.eu-central-1.amazonaws.com/production"}`.

### 4b. Réouverture et collecte ciblée (D-482 §2), une source après l'autre

`release.py` (r4) n'a qu'un mode `source KEY` (`start.sh --source=KEY`, qui ne collecte qu'une source ACTIVE). La
réouverture d'une source PAUSED passe par `source-add --registered-revision` (qualification native, décision
d'accès, promotion PAUSED → ACTIVE, puis ingestion normale). Mode à ajouter au `release.py` de la prochaine release,
mêmes gardes que `source` :

```python
elif mode == 'reouvrir':
    # Réouverture d'une source PAUSED par sa révision revue (D-483, D-485) : qualification, décision, promotion, ingestion.
    import re
    cle, revision, domaine, relecteur = (sys.argv[2:6] + [''] * 4)[:4]
    assert re.fullmatch(r'[a-z0-9][a-z0-9-]*', cle) and re.fullmatch(r'[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}', revision)
    assert re.fullmatch(r'[a-z0-9-]+(\.[a-z0-9-]+)+', domaine) and re.fullmatch(r'[a-z0-9-]{3,60}', relecteur)
    assert c['services'][W]['source']['image'] == IMG_WORKER, 'Le worker ne porte pas la nouvelle image'
    commande = f'sh apps/aggregator/start.sh source-add --key={cle} --registered-revision={revision} --official-domain={domaine} --reviewer={relecteur}'
    patch({'services': {W: {'deploy': {'cronSchedule': None, 'startCommand': commande}, 'variables': {'PIPELINE_PAUSED': {'value': '0'}}}}})
    out(reouverture=cle, revision=revision, lance=True)
```

```sh
# Ralph Lauren (révision inchangée par l'étape 4a ; à relire quand même juste avant)
python3 $R/release.py reouvrir ralph-lauren-avature de332ddf-b45d-42fa-a89e-9ab1106e0d62 ralphlauren.com loic-melane-d483
#   … attendre la fin (PipelineRun / SourceIngestionCompletion), juger les critères (§5), puis seulement :
# Marc O'Polo (révision v2 relue après l'étape 4a)
python3 $R/release.py reouvrir marc-o-polo <UUID_REVISION_V2> marc-o-polo.com loic-melane-d489
#   … attendre la fin, juger (§5)
python3 $R/release.py normal
python3 $R/release.py check api
```

Les arguments de ces deux `source-add` sont acceptés par le parseur réel du worker (`sourceLaunchArguments`, exécuté
le 02/10 sur les deux lignes, la révision de Marc O'Polo remplacée par un UUID de forme valide).

## 5. Ce qui juge chaque réouverture (lecture seule après la collecte)

- **Ralph Lauren** : les dix critères de `audits/2026-09-30/d483-amorcage-waf/criteres-acceptation.md` (collectes
  `HTTP_WITH_WAF_BOOTSTRAP` validées par rejeu, décision `ALLOWED` portant `bootstraps`, 5 requêtes navigateur au plus
  vers `*.awswaf.com`, aucun corps de jeton archivé, aucun 403/406/202 après l'amorçage, liste lue en entier, ≥ 70 %
  de descriptions, aucune fermeture, **offres publiées et zéro refus pour identité**, critère 10 ajouté le 02/10 :
  il échoue si le `portalScope` de l'étape 4a manque). La carte de décision « jeton refusé en cours de collecte » de ce fichier n'est
  soumise au CEO que si la collecte reproduit ce refus.
- **Marc O'Polo** : la collecte rend `FULL_RESPONSE` sans motif bloquant ; les offres lues = la liste de l'API
  (116 le 30/09) moins les fermées ; l'employeur déclaré par les deux pages d'offre est le même et rattache les offres
  à la société déjà liée aux 55 en ligne (D-489) ; aucune offre fermée à tort parmi les 49 publications retrouvées.
- Un seul critère manqué : la source repasse en `PAUSED` (`importer-registre-csv.mts` avec
  `audits/2026-09-30/pause-ralph-lauren-d483.csv` ou `pause-marc-o-polo-d485.csv`, `--ecrire`), motif consigné, rien
  n'est corrigé à chaud.

## 6. Preuve locale de Marc O'Polo

`collecte-locale-marc-o-polo.json` : lecteur dédié intégré (`fetchMarcOPoloJobs`), configuration du registre relu,
site réel, 02/10/2026 de 05:02:42 à 05:16:08 UTC (13 min 26 s, cadence plancher de 7 s sous le pare-feu de l'API),
aucune base.

- **115 offres lues = 115 dans la réponse de l'API** (116 le 30/09) ; preuve `NATIVE_SITE_VACANCIES_FEED`, fin
  `FULL_RESPONSE`, une réponse, **aucun motif, aucun bloquant** (la page publiée et l'API qu'elle déclare concordent) ;
- **employeur « Marc O’Polo » sur 115/115** (D-489 : nom déclaré par les pages d'offre, appliqué à toutes) ;
- descriptions de 200 caractères ou plus : **115/115** ; 0 rejet ; aucun avertissement ni erreur.

Ce que cette lecture ne prouve pas : la résolution d'identité en base (rattachement à la société déjà liée aux 55
offres en ligne, mesuré le 30/09 par `audits/2026-09-30/marc-o-polo/scripts/identite-employeur.mts`) ni la
qualification d'accès : c'est la collecte ciblée de la réouverture qui les juge (§5).
