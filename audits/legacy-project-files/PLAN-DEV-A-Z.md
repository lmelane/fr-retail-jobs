# Plan de développement A → Z — Fashion Atlas by Catwalks

*Message de Loïc au dev. Vaut mandat complet. Date : 3 septembre 2026.*

## 0 · Le cadre, une fois pour toutes

Je délègue **l'exécution complète et les décisions** de ce plan. Je ne veux plus d'aller-retour. Concrètement :

- **Tu ne me poses plus de question.** Quand un choix se présente, tu appliques la recommandation de l'audit (AUDIT-2026-09-03.html, AUDIT-REGISTRE.html, à la racine du dépôt). Si l'audit ne tranche pas, tu tranches toi-même, tu graves la décision dans CLAUDE.md sous un numéro D-xx avec la mention « prise par délégation », et tu avances.
- **Tu prends aussi le périmètre web.** La session web est terminée ; il n'y a plus qu'un seul propriétaire : toi. Plus de coordination entre sessions.
- **La seule chose que tu peux me demander : un accès** (clé, compte, droit Railway). Dans ce cas, un message d'une ligne qui dit exactement quoi cliquer, et tu continues sur autre chose en attendant.
- **Tu me parles uniquement en fin de lot**, avec le rapport au format fixe du §4. Pas de jalon de routine, pas de « rien à signaler ».
- **Le registre est la source de vérité.** Tu le mets à jour à chaque clôture (statut + hash de commit + mesure). Aucun point ne se ferme sur déclaration : chaque ligne a sa preuve d'exécution exigée, tu la fournis telle quelle.
- **Doctrine inchangée** : code + base + logs priment ; reproduction → correction → test de non-régression → preuve ; jamais de zéro silencieux ; jamais de contournement d'un Disallow ; jamais de changement de schéma sans migration versionnée.

## 1 · Les décisions, tranchées

| | Décision |
|---|---|
| **DEC-1 Promesse** | « Les offres de N Maisons du secteur, +X cette semaine ». Compteur calculé en base (Maisons avec ≥ 1 offre active), affiché sur la landing, le README et le titre racine. Plus aucun « toutes les Maisons » ni « en France » tant que la couverture Top-200 est sous 80 %. |
| **DEC-2 Flux B** | Pont, pas pilier. Aucune nouvelle source jobboard/cabinet. FashionJobs et WTTJ maintenus en l'état. Navigateur : reconnexion automatique seulement, pas de furtivité. Les adaptateurs Flux A (Oracle HCM, SAP SF Career Site Builder, iCIMS, ADP) passent devant. La relecture juridique des CGU devient un pré-requis du lancement commercial B2B, pas une tâche de ce plan. |
| **DEC-3 Table Source** | Oui, tout de suite, avant toute promotion post-J3. Statuts DRAFT / VALIDATED / ACTIVE / PAUSED / RETIRED, config JSON, verdict robots daté, dernier run, taux de qualité en colonnes, unicité par tenant, migration depuis `sources.csv`, `promote` et `retire-source` dessus. Le CSV disparaît. |
| **DEC-4 Pinger externe** | Oui. Tu crées le compte (healthchecks.io ou équivalent gratuit) avec l'adresse d'alerte du projet, ping en fin d'`ingest-all`, URL dans CLAUDE.md. |
| **DEC-5 Cadence** | Ingest toutes les 4 h, refresh quotidien, reconcile hebdomadaire. Tu poses les schedules sur Railway, tu vérifies que `catwalks-reconcile` lance bien `reconcile`, tu graves les valeurs, tu fermes L-01 avec l'invariant testé. |
| **DEC-6 Re-audit** | Après le lot 1 déployé et le panel J2, tu prépares l'instantané (dépôt + export lecture seule des compteurs prod) et tu le signales dans le rapport de fin de lot. |
| **L-03** | Contestation acceptée. Clos. |

## 2 · Les lots, dans l'ordre

Un lot ne commence pas tant que la porte de sortie du précédent n'est pas franchie et prouvée. À l'intérieur d'un lot, l'ordre des items est celui indiqué. Les identifiants renvoient au registre.

### Lot 0 · Fondations (immédiat, en parallèle de la fin de J3 v2)

1. **DEC-3** — table `Source` en base + migration depuis `sources.csv` + `promote` / `retire-source` réécrits dessus. Tests d'intégration.
2. **DEC-5** — schedules Railway posés, `catwalks-reconcile` corrigé, valeurs gravées ; **L-01** fermé (invariant `staleHours ≥ pages/window × intervalle × 1,5` testé ; `SourceRun` TIMEOUT/ERROR pour toute source non terminée, exclue du refresh).
3. **DEC-4** — pinger externe câblé.
4. **N-07** — `lib/jobs.test.ts:29` aligné ; e2e Playwright dans `ci.yml` avec `webServer` et base de fixtures ; `skip` silencieux retirés ; test du 410 ajouté. **O-02** clos sur un run CI vert (lien dans le rapport).
5. **L-02 (réserve)** — les taux description/date/pays/URL passent de `SourceRun.note` à des colonnes (migration), pour être requêtables.

**Porte de sortie :** CI verte sur les deux apps ; table `Source` en prod locale avec les 101 lignes migrées ; cadences gravées ; pinger qui alerte quand on coupe le cron en local.

### Lot 1 · Mise en production de la vague 1

1. **N-06** — checklist D26 dans l'ordre : dump prod restauré en local (comptes Jobs/Companies notés) → `separate-fused` répété sur ce dump → déploiement du code → `separate-fused` en prod (`fusedAfter = 0`) → `retire-source cartier-3` → premier `ingest-all` en génération 7. Variables Railway posées par toi (`BREVO_*` recopiées depuis Catwalks sur aggregator et web, `NEXT_PUBLIC_SITE_URL`). Sauvegarde automatique quotidienne activée.
2. **S-01** — cartes en `<a href>`, URL `/offre/[slug]-[id]` avec 301 depuis l'ancien id, nav + footer + lien Maison + offres similaires sur la page offre.
3. **S-02a** — JSON-LD : `employmentType` schema.org, `datePosted = postedAt ?? firstSeenAt`, `validThrough` de repli, `identifier`, `directApply: false`, `<html lang>` = `Job.language` ; test e2e réel (retirer le `.catch(() => {})`).
4. **S-02b (intérim)** — `addressCountry` depuis le mapping `countries.ts` du champ brut, omis quand inconnu, jamais « FR » par défaut. La version définitive vient avec A-02 (lot 3).
5. **DEC-1** — compteur « N Maisons, +X cette semaine » en base et dans l'UI ; libellés « toutes » et « en France » retirés.

**Porte de sortie (mesures prod collées dans CLAUDE.md) :** `fusedAfter = 0` en prod et à J+7 ; 0 offre Richemont / ELC / Beaumanoir portant le nom d'une autre marque du groupe ; premier digest Brevo reçu ; crawl depuis `/` atteignant ≥ 95 % des offres actives sans sitemap ; 50 URLs offres passées au Rich Results Test sans erreur ; compteur DEC-1 visible.

### Lot 2 · Convertir le stock découvert

1. **C-02 / C-03** — fin J3 v2 → validation-volume → promotion sur la table `Source` ; génériques exclus tant qu'ils n'ont pas ≥ 1 offre parsée (titre + URL + lieu).
2. **C-04** — score d'identité (nom du board, domaine des offres, lien depuis le site officiel, logo) pour Teamtailor / Greenhouse / Lever / SmartRecruiters ; les 765 lignes de revue manuelle re-passées.
3. **C-05a** — branches de détection Workable, SuccessFactors, Phenom, Avature, Eightfold, Ashby, Magnet, Pinpoint ; matrice vendor × (détection, adaptateur, validation) testée ; re-sweep des 10 404 vivants.
4. **A-01b** — Avature / L'Oréal Luxe : marque par offre, une seule ligne par tenant.
5. **F-04** — chaque adaptateur retourne `{ jobs, declaredTotal, truncated }` ; `truncated` = DEGRADED ; Talentsoft lu au complet.
6. **F-05** — `postedAt` LVMH, Workday (`postedOn`), Greenhouse (`first_published`).
7. **F-06** — zéros silencieux TalentView / Generic → erreurs ; garde `^https?://` à l'ingestion.
8. **F-07** — FashionJobs : curseur à la dernière page traitée ; 403 = page réessayée.
9. **F-01** — `http.ts` : timeout après acquisition du slot, timeout de lecture, plafond de taille ; pLimit ≤ concurrence du gate.
10. **F-02** — un seul nettoyeur HTML ; `grep stripHtml src/ats/adapters` = 0 ; réingestion.

**Porte de sortie :** ≥ 500 sources ACTIVE ; ≥ 400 Maisons avec ≥ 1 offre active correctement attribuée ; 0 source `truncated` non alertée ; `postedAt` ≥ 95 % des offres actives ; URL valide = 100 % ; part auto-résolue de la revue manuelle ≥ 60 % avec 0 faux positif sur 50 relus.

### Lot 3 · Données monde et précision

1. **A-02** — `countryCode` ISO-3166 + ville canonique à l'ingestion (géocodeur monde avec cache) ; `isFrance` dérivé ; **S-02b définitif**.
2. **C-06 / A-03** — référentiel Maisons en base (pays, groupe, segment, domaines officiels, ATS, statut), alimenté par la découverte ; le web lit la base, plus le CSV ; `groups.ts` réparé.
3. **D-02** — jeu de 300 paires étiquetées à la main dans le dépôt ; concept = bonus, pas plancher ; contrat, temps de travail, seniorité discriminants ; meilleur score, pas premier match.
4. **D-03** — verrou consultatif par `clusterKey` ; `raw` sur JobSource seulement.
5. **R-01** — robots.txt parsé (cache 24 h) dans `http.ts` et le transport navigateur ; Disallow refusé automatiquement ; `Crawl-delay` respecté ; UA honnête avec page « pourquoi nous crawlons / opt-out » ; verdicts journalisés dans `Source`.
6. **R-02 (reste)** — DNS-rebinding : résolution puis filtrage de l'IP avant connexion.

**Porte de sortie :** `countryCode` ≥ 99 % ; 0 offre étrangère classée FR sur 200 tirées ; précision dédup ≥ 0,98 et rappel ≥ 0,90 sur le jeu étiqueté ; 0 requête vers un chemin Disallow sur un run complet (compteur) ; « sandro » atteint SMCP en prod ; part OTHER / sans groupe < 10 %.

### Lot 4 · SEO et tenue en charge

1. **S-03** — routes `/emplois/[pays]/[ville]`, `/metier/[slug]`, `/metier/[slug]/[ville]`, `/groupe/[slug]` avec seuil d'offres ; canonical + noindex des filtres ; `generateSitemaps` par type ; `lastmod = updatedAt`.
2. **S-04** — `tsvector` généré + GIN pondéré (titre A, Maison B, description C) ; index `(isActive, postedAt desc)` ; `Company.slug` unique ; facettes cachées 5 min ; `React.cache` ; rate-limit `/api` ; `lib/search.ts` branché ou supprimé.
3. **S-05** — garde `^https?://` à l'affichage ; `x-internal-probe` vérifié ; leaflet retiré ; CLAUDE.md nettoyé.
4. **O-03** — `DailySnapshot` (source × pays × Maison × compte + taux) et page `/admin` avec les 11 KPIs de l'audit.
5. **O-04** — deux images pipeline (léger / navigateur), `npm ci`, `USER node`, healthcheck web.

**Porte de sortie :** bench local 200 k offres synthétiques, `/emplois?q=` p95 < 300 ms ; Search Console sans erreur de sitemap ; nombre de pages longue traîne indexables dans le rapport ; `/admin` en ligne.

### Lot 5 · Adaptateurs Flux A (le gisement suivant)

1. **C-05b** — dans cet ordre : Oracle HCM (Hermès, retail US), SAP SF Career Site Builder (Italie, Suisse), iCIMS, ADP. Chacun avec fixture enregistrée, test unitaire, ≥ 1 source en prod.
2. **F-03 (réduit)** — reconnexion sur `disconnected`, contexte persistant ; pas de furtivité (DEC-2).
3. Re-sweep de découverte avec les nouvelles détections ; promotion.

**Porte de sortie :** ≥ 2 adaptateurs retail US en prod ; FashionJobs 0 run BROKEN sur 14 jours ; couverture Top-200 mesurée et publiée.

### Lot 6 · Re-audit (DEC-6)

Instantané frais (dépôt + export lecture seule des compteurs prod) signalé dans le rapport de fin de lot 5. Même grille, mêmes 11 KPIs, chiffres avant/après.

## 3 · Règles permanentes pendant tout le plan

- Chaque correctif : test de non-régression dans le dépôt, CI verte avant merge.
- Chaque changement de schéma : migration versionnée, jamais `db push`.
- Chaque source promue : ≥ 1 offre parsée réellement, verdict robots daté, propriétaire.
- `separate-fused` en mode métrique une fois par semaine : `fusedAfter` doit rester à 0.
- Toute décision prise par délégation : une entrée D-xx dans CLAUDE.md, datée.
- Registre mis à jour à chaque clôture : statut, hash, mesure.

## 4 · Format du rapport de fin de lot (le seul message que j'attends)

```
LOT n — clos le <date> — branche/commit <hash>
Porte de sortie : chaque critère, avec sa mesure réelle (chiffre, requête, lien CI)
Constats clos : ID → preuve (commit + mesure)
Décisions prises par délégation : D-xx → une ligne chacune
Accès manquants : (vide, ou une ligne « clique ici »)
Lot n+1 : démarré le <date>, premier item en cours
```

Rien d'autre. Si un lot glisse, tu le dis dans ce rapport avec la cause et la nouvelle date, tu ne t'arrêtes pas pour me demander.
