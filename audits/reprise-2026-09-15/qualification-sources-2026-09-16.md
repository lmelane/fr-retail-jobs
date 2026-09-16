# Qualification des sources et du stock — état daté du 16 septembre 2026

Passation §11. Toutes les mesures sont lues sur le **clone complet du stock** (`catwalks_rehearsal_20260915`, photographie de production du 15 septembre, 77 migrations, lecture seule) et sur le **registre opérationnel maintenu** (`scripts/ops/source-registry.mts`, une décision par source, aucune par défaut), exécuté sur ce clone sous `default_transaction_read_only`. Preuve : [`preuves/qualification-registre-2026-09-16.json`](preuves/qualification-registre-2026-09-16.json) (444 lignes, identifiants, comptes et états seulement).

## Le verdict, source par source, et ce qu’il vaut

| Verdict du registre | Sources | Offres publiées | Ce que cela signifie |
|---|--:|--:|---|
| `PAUSED_BLOCKED`, motif « verdict d’accès non favorable » (`ACCESS_MISSING`) | 436 (toutes les ACTIVE) | 84 975 avec les 8 en pause | Aucune source n’a de **décision d’accès** (`SourceAccessDecision` : 0 ligne) ni de **fin d’ingestion attestante** (`SourceIngestionCompletion` : 0 ligne) sous le lecteur de release ; le registre refuse donc toute automatisation, à raison |
| `PAUSED_BLOCKED`, motif « source en PAUSED » | 8 | 2 305 offres encore actives | Pause de catalogue ; leur motif et leur condition de reprise restent à documenter |
| `FULL_AUTOMATION` / `PUBLISH_NO_CLOSE` / `EVIDENCE_ONLY` | 0 | 0 | Personne n’est admis par défaut : c’est le principe gravé en 5G3B3B et 5G3C |

Prochaine action donnée par le registre pour les 436 : « relire le `robots.txt` à la source et établir la base d’autorisation (D62) », c’est-à-dire produire, source par source, la capture `SOURCE_ACCESS` puis la décision (`source-onboard access`), puis une collecte admise. **Aucune source n’est certifiée par ce document** ; un statut `ACTIVE` reste un statut de catalogue.

## Ce que le stock dit d’autre (clone, SQL en lecture seule)

- Sources : 436 ACTIVE, 8 PAUSED, 92 RETIRED ; 43 familles, les plus nombreuses teamtailor (113 actives), greenhouse (63), workday (54), smartrecruiters en marque blanche (45), successfactors (31).
- Identité : 112 revues, toutes `VERIFIED`, sur 95 sources ; parmi les ACTIVE, **94 ont une identité vérifiée, 342 n’ont aucune revue**.
- Dernier passage : OK avec attestation possible 212, OK sans 81, DEGRADED 220, NEW 23, BROKEN 3 ; toutes les ACTIVE ont tourné dans les trente jours précédant le dernier passage du clone (14 septembre).
- Représentations hors registre : **441, toutes inactives** (constat de la passation confirmé ; rien n’est réactivé).
- Offres actives par statut de source : 81 416 sous ACTIVE, **2 305 sous PAUSED** (une pause de collecte laisse ses offres en ligne jusqu’à leur propre expiration : à décider explicitement, voir écarts).

## Points nommés par la passation

- **Configuration contenant `apiKey`** : une seule source, `rivoli-typesense` ; l’adaptateur documente et le code confirme qu’il s’agit de la **clé de recherche publique** lue en clair dans le HTML du site (`var TYPESENSE_API_KEY`), envoyée en `x-typesense-api-key`. Les deux `siteKey` (magnet : `element-6`, `eram-3`) sont la clé publique de connexion du site, encodée en base64 par l’adaptateur. **Aucun secret privé** dans les configurations du registre ; les rapports d’exploitation n’émettent aucune valeur de configuration (vérifié dans `source-registry.mts` et `operations-report.mts`) ; aucune rotation à demander.
- **`CATALOGUE_API_KEY` absente = chemin ouvert** : reproduit dans `apps/api/lib/cle-api.ts` (le garde laissait passer, « délibéré ») ; **corrigé** : en production, clé absente = 503 « non configuré », jamais une API ouverte ; hors production, absence tolérée et journalisée. Témoins D-422 : 7 verts, dont le nouveau témoin qui doit échouer. Consommateur vérifié : le site envoie la clé quand `CATALOGUE_API_KEY` est posée (`api.ts`, `sitemap-emplois.ts`) ; **condition de release** : la variable doit être posée côté site (Vercel) et côté API (Railway) avant de déployer ce garde, sinon le site voit des 503.
- **`verif:couverture` vers un fichier absent** : faux depuis le travail du propriétaire (`scripts/ops/verif-couverture-registre.mts` présent, script déclaré dans son `package.json` non committé) ; rien touché.
- **Eightfold et WTTJ lisaient des détails sans les conserver dans le RAW** : depuis 5G3B2A/5G3B3B, toute réponse passant par `fetchWithRetry` dans une collecte admise est capturée avec sa provenance (`captureHop`), détails compris (`eightfold.ts` lit ses détails par `fetchJson`, `wttj.ts` par `fetchJson`/`fetchText`). **Les preuves historiques perdues ne se réparent pas** ; elles se remplacent par une nouvelle capture admise, ce que le registre exige déjà pour toutes les sources (verdict ci-dessus).
- **Ba&sh** : travaux du propriétaire non committés (`bashTalents.ts`, `bashTalents.test.ts`, `verif-bash-live.mts`), préservés à l’octet, non qualifiés ici.
- **441 représentations hors registre** : inactives, non réactivées.

## Familles à examiner (§11.2) : état, pas verdict

Le relevé 4I reste le point de départ (`preuves/lot-4i-scope.json`) ; les comptes n’ont pas été remesurés ici. Aucune famille n’est certifiée : Workday, SmartRecruiters en marque blanche, SuccessFactors, Avature, Eightfold, génériques, Phenom, WTTJ, FashionJobs, DigitalRecruiters ont chacune une ou plusieurs sources ACTIVE dont le verdict est celui du tableau, `PAUSED_BLOCKED` faute de décision d’accès. La réussite d’un adaptateur ne certifie aucun portail de sa famille.

## Écarts ouverts, avec propriétaire

| Écart | Classe | Résolution attendue |
|---|---|---|
| 436 sources sans décision d’accès ni capture attestante | décision validée non implémentée (5G3B/5G3C posent le mécanisme, la qualification source par source reste à faire) | Campagne `source-onboard access` puis collecte admise, source par source, avant toute automatisation ; le lot 10 (CRON) en dépend |
| 342 sources ACTIVE sans revue d’identité | idem | Revues d’identité avec preuve officielle, pas de certification par compteur |
| 2 305 offres actives sous des sources PAUSED | comportement existant non documenté | Carte de décision : une pause retire-t-elle ses offres, ou les laisse-t-elle expirer ? |
| Preuves natives perdues (Eightfold, WTTJ) | corrigé pour l’avenir, irréparable pour le passé | Re-capture admise ; les résumés stockés restent des contenus partiels |
| Garde de clé fermé en production | corrigé | Poser `CATALOGUE_API_KEY` des deux côtés avant déploiement |
