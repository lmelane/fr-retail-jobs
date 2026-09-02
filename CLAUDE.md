# CLAUDE.md — Catwalks Job Aggregator

> Ce fichier grave les **décisions métier** et l'**état vérifié** de la plateforme.
> Règle : le **code + la base + les logs de prod** sont la source de vérité, jamais un résumé.
> Toute décision métier structurante se prend avec le propriétaire (Loïc), jamais seul.

## Le produit, en une phrase

Un **jobboard/agrégateur gratuit** qui réunit **toutes les offres publiques Mode · Luxe · Beauté · Horlogerie · Retail disponibles en France**, sans doublon, avec le texte complet et le lien de candidature direct. Deux flux de rang égal : (A) les ATS/pages carrière des employeurs, (B) les jobboards et cabinets. Déduplication à l'écriture : **1 offre canonique + N sources**.

## Parties prenantes

- **Propriétaire / décideur produit** : Loïc (loic.melane.pro@gmail.com). Décide de toute intention métier.
- **Candidats** : cherchent, filtrent, lisent une offre complète, postulent chez l'employeur. Aucune inscription.
- **Employeurs / Maisons** : leurs offres sont agrégées depuis des sources publiques et autorisées (robots.txt lu à la source).

## Infra (vérifié le 2026-09-02)

Projet Railway **« data feed of jobs »**, env `production` :

| Service | Rôle réel |
|---|---|
| `Postgres` | base de prod (postgres-ssl:18), volume monté, réseau interne uniquement |
| `catwalks-web` | site Next.js — `catwalks-web-production.up.railway.app` |
| `catwalks-aggregator` | cron `ingest` |
| `catwalks-refresh` | cron `refresh` (lifecycle) |
| `catwalks-reconcile` | **anomalie : exécute `ingest`, pas `reconcile`** (à corriger) |

Monorepo npm workspaces : `apps/aggregator` (pipeline), `apps/web` (site), `packages/db` (Prisma).
La base de prod n'est joignable que via le réseau interne Railway → diagnostics via `railway ssh --service catwalks-aggregator` (lecture seule pour l'audit).

## Décisions métier gravées

### D1 — DB indisponible → page d'erreur propre, jamais d'offres fictives
Si la base est injoignable, le site rend une **page d'erreur propre (503)**, pas d'offres inventées. Le fallback `DEMO_JOBS` (6 offres fictives) est **supprimé**. _Un jobboard ne ment jamais sur ses offres._ (Décidé 2026-09-02.)

### D2 — Les filtres Groupe et Source sont activés dans l'UI
La barre de filtres expose **Secteur · Contrat · Ville · Maison · Groupe · Source**. Le groupe et la source, aujourd'hui morts-nés dans le code, deviennent des filtres réels (comptes exacts), conformément à la promesse produit (« Kering ouvre ses 14 Maisons »). (Décidé 2026-09-02.)

### D3 — `Job.source` stocke le vrai ATS
`Job.source` (AtsType) doit refléter la **vraie source** (WORKDAY, GREENHOUSE, LVMH_ALGOLIA…), pas la valeur figée `GENERIC_JSONLD`. Corrige la contrainte unique `(companyId, source, externalId)` et le chemin de récupération après course. (Décidé 2026-09-02.)

### D4 — Fresh start, versioning conservé, legacy d'affichage supprimé
On **repart d'une base propre** une fois. On **garde** `pipelineVersion` comme garde-fou des futurs correctifs de schéma. On **supprime** `readableDescription` (nettoyage des vieilles lignes) : les nouvelles lignes sont déjà propres. (Décidé 2026-09-02.)

### D5 — Suppression du legacy à 100 %
Tout code mort / de compatibilité inter-générations / rustine temporaire est **supprimé**, pas conservé « au cas où ». Une décision métier cachée dans du legacy remonte en decision card avant suppression.

### D6 — Ingest découpé par source, purge conditionnelle au succès
Chaque source (ou petit lot) devient un **run court et indépendant**. La purge par génération n'efface une source que **si son fetch a réussi** — jamais en tête de run global. Un flux qui casse n'empêche plus les autres ni ne vide la base. (Décidé 2026-09-02.)

### D7 — Chantier en local d'abord, prod à la fin
Toutes les corrections et la reconstruction de base se font **en local** (Postgres Docker isolé). On ne déploie/relance les crons de prod qu'une fois la plateforme **validée de bout en bout**. Aucune écriture en prod pendant le chantier. (Décidé 2026-09-02.)

### D8 — Retirer les filtres « 7 jours » et « Confirmées »
Ces deux boutons de la barre n'apportent pas de valeur candidat (« Confirmées » expose un concept interne multi-sources ; « 7 jours » isolé est bancal). Barre finale : Secteur · Contrat · Ville · Maison · Groupe · Source. (Décidé 2026-09-02.)

### D9 — Logos d'entreprises via Clearbit, fallback initiale
Page Entreprises : afficher le logo via `https://logo.clearbit.com/{domaine}` (gratuit, sans clé), le domaine venant du catalogue (`careers_domain`). Fallback **pastille avec initiale** si pas de domaine ou logo indisponible (`onError`). Le logo ne doit jamais casser l'affichage. (Décidé 2026-09-02.)

## État vérifié de la prod (2026-09-02) — ce qui NE va pas

Constats lus dans la base et les logs de prod, pas supposés :

1. **La base ne contient que 3 employeurs** (Kering, L'Oréal, Groupe Courir) pour **2 140 offres**, dont **305 seulement en France**. Très loin du marché visé (728 maisons, 93 flux annoncés).
2. **L'ingest meurt avant d'atteindre les flux API.** `runIngest` fait d'abord les sources sitemap (8), puis les flux API (le gros du marché) — mais le run s'arrête pendant les sitemaps (timeout / container tué). Les 22 adaptateurs ATS ne produisent donc **rien en prod**.
3. **L'Oréal = 0 offre France** sur 1 662 offres (bug de parsing de localisation Avature).
4. **WTTJ tronqué** : 59 560 offres à la source, 17 lues, 12 en France.
5. **Puig = 0 offre** (source cassée, silencieuse).
6. **La purge par génération s'exécute AVANT tout fetch, hors transaction, sans garde de succès** → si le fetch échoue après un bump de version, la base reste vide.
7. **`pipelineVersion` n'est écrit qu'au CREATE** → les offres MERGED/attach gardent l'ancienne version et sont re-supprimées au run suivant (churn : `firstSeenAt` et `id` instables). Preuve : 31 offres encore en v4, dont 12 multi-sources.
8. **`SourceRun` est vide** → le monitoring de santé n'a jamais rien enregistré ; l'ingest meurt avant `checkSourceHealth`.
9. **La santé (`health.ts`) se compare à elle-même** (lit `JobSource` live après l'ingest) et n'est **pas** consultée par `refresh` → une source cassée voit ses offres fermées 48 h plus tard sans garde-fou.
10. **`catwalks-reconcile` lance `ingest`** au lieu de `reconcile`.
11. **Zéro test** dans tout le dépôt.

Détail exhaustif des findings (3 audits défensifs, chaque regex exécutée) : voir `AUDIT.md` (à produire).

## Sécurité — points ouverts

- **XSS JSON-LD** : `apps/web/app/offre/[id]/page.tsx` injecte `JSON.stringify(structuredData)` dans un `<script>` sans échapper `</script>` → titre/description d'une source hostile peut casser hors du script.
- **SSRF** : `lib/http.ts` / `ats/detect.ts` fetchent des URLs issues de Serper / HTML / CSV sans valider le schéma ni bloquer les hôtes internes.
- **Clé Algolia LVMH** codée en dur (`lvmhAlgolia.ts`) — clé publique de secours, à documenter comme telle.

## Tests

- **Unitaires** (sans base) : `npm run test:unit -w @catwalks/aggregator` — normalizers, france, html, ssrf, geocode.
- **Intégration** (base dédiée) : `DATABASE_URL=…/catwalks_test npm run test:integration -w @catwalks/aggregator` — purge, santé, refresh.
- ⚠️ **Les tests d'intégration VIDENT la base.** Ils ne tournent QUE sur une base dont le nom contient « test » (garde `src/test/setup-integration.ts` qui refuse sinon). **Ne jamais** les lancer sur la base de démo/prod. Base de démo locale = `catwalks`, base de test = `catwalks_test` (même conteneur Docker `catwalks-audit-pg`, port 55440).

## Méthode de travail

1. **Audit défensif** (fait, 3 passes parallèles + vérif prod).
2. **Boucle obligatoire par correctif** : reproduction (test/BDD) → correction → audit défensif → tests de non-régression → validation. Après chaque correction : audit défensif / BDD → validation → correction suivante.
3. **BDD** : formaliser les comportements attendus en scénarios vérifiables (socle de tests à créer — aujourd'hui absent).
4. Rien n'est « corrigé » parce que ça paraît logique : **preuve d'exécution** exigée.
