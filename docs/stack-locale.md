# Stack locale complète (lot F2)

Un seul parcours maintenu pour faire tourner **le catalogue, l’API, le backend Catwalks, le site et la synchronisation des offres directes** sur ce poste, avec des données de test isolées, sans aucune écriture vers Vercel, Railway, le media ou un service tiers. Outil : `apps/aggregator/scripts/stack-local/` (Node ≥ 22.12, Docker local sur socket Unix).

## Commandes

| Commande | Ce qu’elle fait |
|---|---|
| `npm run stack:prepare -- --backend=<dossier catwalks-backend> --website=<dossier catwalks-website> [--offres=650]` | vérifie Node et Docker, génère les secrets privés (`.stack-local/config.json`, 0600), crée et démarre les trois conteneurs (bases catalogue et backend sur volumes nommés, MinIO), le bucket d’archive, installe **depuis les locks** ce qui manque (additif, lock inchangé sinon arrêt), applique les migrations (78 catalogue, 104 backend), sème les données synthétiques. Rejouable. |
| `npm run stack:start -- [--mode=dev\|build] [--only=api,backend,website,inbox]` | démarre la boîte de réception locale, l’API catalogue, le backend et le site ; `build` = `next build` + `next start` (`NODE_ENV=production`, clé exigée) ; refuse un port déjà pris et **ne tue jamais** un autre processus. |
| `npm run stack:verify -- [--mode=build] [--sans-navigateur]` | les vérifications de la section « Ce que prouve `verify` » ; rapport JSON et captures dans `.stack-local/proofs/`. |
| `npm run stack:sync -- [--limite=200] [--depuis=0]` | rejoue la synchronisation des offres directes à la main (scénario manuel). |
| `npm run stack:stop -- [--containers]` | arrête les serveurs lancés par la stack (PID vérifiés), restaure `tsconfig.json` / `next-env.d.ts` réécrits par Next ; `--containers` arrête aussi les trois conteneurs. |
| `npm run stack:reset -- --oui` | efface **uniquement** les volumes, l’archive et la boîte de la stack (préfixe `catwalks-stack-`, label `catwalks.purpose=stack-local`), puis remigre et resème. |
| `npm run stack:status` | conteneurs, serveurs, URLs. |

Après un redémarrage du poste : les conteneurs repartent seuls (`--restart unless-stopped`), puis `npm run stack:start`. Aucun script dans `/tmp`, aucune base jetable : tout l’état est sous `.stack-local/` (ignoré par Git) et dans les volumes Docker nommés.

## Composants, ports, URLs

| Composant | Port (127.0.0.1) | Adresse | Détail |
|---|---|---|---|
| Base catalogue (PostgreSQL 18, image épinglée de `test:local`) | 56432 | conteneur `catwalks-stack-catalogue-db` | base `catwalks_stack_catalogue` (sans « test » dans le nom : les suites d’intégration ne peuvent pas la vider) |
| Base backend de test (PostgreSQL 18) | 56433 | conteneur `catwalks-stack-backend-db` | base `catwalks_stack_backend_test` (« test » exigé par les gardes du backend) |
| Archive RAW (MinIO) | 56900 / console 56901 | conteneur `catwalks-stack-minio` | bucket `catwalks-stack-observations`, variables `OBSERVATION_ARCHIVE_S3_*` des commandes de collecte |
| API catalogue (`apps/api`) | 3110 | `http://127.0.0.1:3110` | `CATALOGUE_API_KEY` de test ; `/api/health` porte le contrat des 78 migrations |
| Backend Catwalks | 3101 | `http://localhost:3101` | `CATALOGUE_FLUX_KEY` de test, CORS ouvert aux seuls hôtes du site local |

> **État au 25/09/2026 : les offres directes de la stack sont cassées.** Le backend a retiré son flux d’outbox (commit `8352cff` de sa branche `development`, conforme à D-444) : `seed.mjs` écrit encore la colonne retirée `countryCode` et compte `catalogueOutbox`, `verify.mjs` attend `/api/catalogue/flux` puis lance `direct-sync`. Tant que la stack n’est pas adaptée au lecteur de la liste publique (`direct-liste`, D-444), son semis et ses vérifications d’offres directes échouent contre ce backend.

| Site | 3100 | `http://localhost:3100` et `http://<pays>.catwalks.localhost:3100` | `EMPLOIS_API_URL` → API locale, `EMPLOIS_INDEXABLE=0` |
| Boîte de réception (imite l’API Brevo) | 56025 | `http://127.0.0.1:56025/` | chaque email « envoyé » y est archivé en JSON |

Les ports du propriétaire (API de développement 3010, site 3000, backend 3001) ne sont jamais utilisés. Pour changer un port : `.stack-local/config.json`, puis `stack:stop` et `stack:start`.

**Hôtes pays.** Chrome et Firefox résolvent `*.localhost` vers la boucle locale sans DNS ni `/etc/hosts` : `http://de.catwalks.localhost:3100/emplois` sert le marché allemand. En ligne de commande : `curl -H 'Host: de.catwalks.localhost:3100' http://127.0.0.1:3100/emplois` (le `fetch` de Node refuse l’en-tête Host). Le DNS public n’est pas touché ; le domaine `catwalks.io` reste celui des liens canoniques et des URL de candidature, par décision.

## Identifiants privés

`.stack-local/config.json` (0600, jamais affiché par l’outil) : mots de passe des deux bases, `catalogueApiKey`, `fluxKey`, `nextauthSecret`, identifiants MinIO, clé Brevo synthétique, et le **compte candidat de test** `candidat.stack@catwalks.test` avec son mot de passe (`secrets.candidatPassword`). Tous sont générés au premier `prepare` et propres à ce poste.

## Données de test, et ce qui n’en est pas

- **Synthétique, marqué comme tel** : Maison « Maison Test Stack (synthétique) », 650 offres `STACK-TEST-0001…0650` (client `SYNTHETIQUE`, textes explicites, treize villes sur les douze marchés), compte `candidat.stack@catwalks.test`, comptes jetables `jetable.<horodatage>@catwalks.test` créés puis supprimés par `verify`.
- **Offres externes** : aucune tant que F3 n’a pas ingéré des captures qualifiées ; la stack ne charge jamais le stock historique non certifié.
- **Neutralisé par l’environnement** (une valeur posée dans l’environnement prime sur `.env.local`, vérifié avec `@next/env`) : Brevo redirigé vers la boîte locale (`BREVO_API_URL`, surcharge locale dans B et W), PostHog, Sentry (`SENTRY_DISABLED=1`, interrupteur local dans B et W), Firebase (un téléversement de CV échoue explicitement : bucket isolé à traiter en F5), Turnstile désactivé, Slack, Google, jetons Railway et Vercel absents. Les serveurs reçoivent un environnement minimal, jamais celui du shell.

## Ce que prouve `verify` (18 constats)

Santé et contrat de migrations de l’API ; clé refusée puis acceptée ; flux d’outbox fermé sans clé ; **rejeu complet de plus de 500 offres** par pages de 200 (curseur, aucune erreur) ; rejeu depuis zéro idempotent (rien réappliqué, aucun doublon) ; retrait puis remise en ligne d’une offre (version qui monte, copie qui suit) ; **interruption brutale** d’une consommation d’événements neufs (processus tué après 5 événements sur 80) puis reprise exacte ; union des deux origines dans l’API avec les offres Catwalks en tête ; page emplois du site avec la Maison synthétique ; hôte neutre qui invite à choisir, hôtes `fr`/`de`/`us` qui servent leur marché (le `h1` compte exactement les offres du marché, dans sa langue) ; connexion du compte de test ; réinitialisation de mot de passe **capturée par la boîte locale** ; trois captures Chromium. Un constat qui ne peut pas conclure le dit.

## Scénario manuel (dix minutes)

1. `npm run stack:status` : trois conteneurs `running`, quatre serveurs vivants.
2. Ouvrir `http://fr.catwalks.localhost:3100/emplois` : « 100 offres », Maison Test Stack visible ; `http://de.catwalks.localhost:3100/emplois` : « 50 offres » ; `http://localhost:3100/emplois` : invitation à choisir un marché.
3. Ouvrir une offre Catwalks depuis la liste : parcours de candidature Catwalks (connexion) ; se connecter avec le compte de test (email et mot de passe dans `.stack-local/config.json`).
4. Retirer une offre dans le backend de test, puis synchroniser et recharger la page : elle disparaît.
   ```sh
   docker exec -i catwalks-stack-backend-db psql -U catwalks -d catwalks_stack_backend_test -c "UPDATE jobs SET status='OFFLINE', is_active=false WHERE reference='STACK-TEST-0002'"
   npm run stack:sync
   ```
   La remettre en ligne (`status='ONLINE', is_active=true`), resynchroniser : elle revient avec une version supérieure.
5. Demander une réinitialisation de mot de passe depuis le site : l’email apparaît sur `http://127.0.0.1:56025/`, rien ne part chez Brevo.
6. `npm run stack:verify` : 18 / 18, captures dans `.stack-local/proofs/`.

## Preuves

`.stack-local/proofs/verify-<horodatage>.json` (chaque constat avec ses valeurs) et `<horodatage>-emplois-fr.png`, `-emplois-hote-de.png`, `-inbox.png`. Le bilan du lot ([lot-f2](../audits/reprise-2026-09-15/lot-f2.md)) cite les exécutions de référence en mode `dev` et en mode `build`.

## Limites connues

- Téléversement de CV et avatars : Firebase Storage neutralisé, pas encore de bucket isolé (F5, avec le scénario de candidature).
- Langues DE/IT/ES/NL/CN du site : à terminer (F5) ; l’hôte `de` sert aujourd’hui l’interface française.
- Ingestion d’offres externes : F3 (captures qualifiées), avec l’archive MinIO déjà branchée.
- Les modifications locales de B et W (surcharge `BREVO_API_URL`, `SENTRY_DISABLED`, `distDir` de B, ignore de `.next-stack`) sont committées localement, jamais poussées.
