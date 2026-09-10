# Le pipeline métier

Ce que le produit promet : **toutes les offres d'emploi publiques du secteur
mode · luxe · beauté · horlogerie · retail en France, en un seul endroit, sans
doublon, avec le texte complet et le lien de candidature direct.**

Ce document décrit comment cette promesse est tenue, moteur par moteur, et où
sont les limites connues. Les permissions de crawl vivent dans
[`apps/aggregator/data/access-verdicts.csv`](apps/aggregator/data/access-verdicts.csv),
les pièges techniques par vendeur dans [`DISCOVERY.md`](DISCOVERY.md).

```
  FLUX A — EMPLOYEURS                    FLUX B — JOBBOARDS & CABINETS
  ATS des Maisons (Workday,             WTTJ, FashionJobs, Indeed,
  SuccessFactors, Avature…)             cabinets de recrutement
          │                                       │
          └───────────────┬───────────────────────┘
                          ▼
                     INGESTION            crons Railway, santé surveillée
                          ▼
                    NORMALISATION         un schéma canonique, rien n'est jeté
                          ▼
                   DÉDUPLICATION          à l'écriture — jamais deux fois la même offre
                          ▼
              CLASSIFICATION SECTEUR      référentiel 728 maisons, offre par offre
                          ▼
                  DRAPEAU FRANCE          stocké, jamais un rejet — le web filtre
                          ▼
                    BASE UNIQUE           1 Job canonique + N JobSources
                          ▼
                     SITE WEB             liste, carte, entreprises, /offre/[id]
```

Les deux flux sont **de rang égal**. Un jobboard n'est pas un doublon du flux
employeur : les cabinets portent des mandats exclusifs, et beaucoup de petites
Maisons n'ont aucun ATS public — leurs offres n'existent QUE là (Agatha renvoie
explicitement ses candidats vers Indeed).

---

## 1 · DISCOVERY — trouver les sources

**Fait, 8 lots, 728 Maisons analysées.** Résultat :

| | Maisons |
|---|---|
| Flux identifié et validé | 391 → **93 flux distincts** après regroupement |
| Aucune infrastructure de recrutement | 276 (petits créateurs, ateliers, licences) |
| Interdits par robots.txt | 10 — jamais contournés |
| Bloqués par pare-feu (WAF) | 6 — Chromium légitime, à brancher |

La méthode : **le site de la marque d'abord** (son pied de page nomme son ATS),
puis WTTJ en repli, puis capture réseau. Chaque hôte a son verdict robots.txt
lu à la source — ALLOWED, DISALLOWED (on s'abstient), WAF_BLOCKED (navigateur
légitime), PARTIAL (on prend la route permise, ex. Richemont
`/broadbean_external/`).

Trois règles nées des erreurs de cette phase :

- **Un rapport d'agent est une piste, jamais une conclusion.** Puig a été
  abandonné à tort sur la foi d'un rapport ; le robots réel l'autorise.
- **Un compteur déclaré ment.** On compte les identifiants uniques collectés,
  jamais le `total` annoncé (Workday, Phenom, Eightfold, Radancy mentent tous
  différemment).
- **Toujours un contrôle négatif** (`?search=zzzznope`) avant de croire un
  filtre — les `query=` des portails groupe sont flous, pas des filtres.

## 2 · FETCH — lire les sources

**19 adaptateurs**, tous API-first, tous rendant la description complète
(moyenne 3 500+ caractères). Catalogue actuel : **93 flux validés en direct,
20 378 offres**, une ligne par flux — pas par Maison, car le portail Coty sert
17 marques et l'appeler 17 fois fausse tout.

Deux protections structurelles :

- **Clés auto-rafraîchies.** LVMH et WTTJ tournent sur des clés Algolia
  publiques que les vendeurs font tourner à chaque déploiement. Sur refus,
  l'adaptateur relit la clé sur le site, réessaie, et **lève une erreur**
  sinon — jamais un zéro silencieux (une clé morte a produit de faux « aucune
  offre » sur trois lots de découverte).
- **Flux séquentiels.** Un portail groupe derrière un WAF coupe l'accès quand
  on l'appelle en rafale — c'est mesuré, pas supposé.

## 3 · NORMALIZE — un schéma, tout garder

Chaque offre sort en `NormalizedJob` (~25 champs) : titre, lieu complet
(ville/CP/région/coordonnées), contrat **et** temps de travail (deux notions —
« Full-time » n'est pas un contrat), télétravail, expérience, salaire en
fourchette, description, département, dates. **Le payload brut du vendeur est
conservé** (`raw`) : un champ sans colonne aujourd'hui pourra être promu demain
sans re-crawler le marché.

Le contrat est ramené à un vocabulaire français
(CDI/CDD/STAGE/ALTERNANCE/VIE/INTERIM/FREELANCE), les titres et villes sont
normalisés pour la déduplication.

## 4 · DEDUP — le vrai secret du produit

**À l'écriture, jamais en tâche planifiée** : la base ne contient jamais deux
fois la même offre, pas même une seconde.

- Clé de blocage : `entreprise résolue | ville normalisée`
- Fusion floue des titres avec synonymes FR/EN (« Conseiller de vente » ≡
  « Sales Advisor »)
- Deux garde-fous prouvés sur données réelles : deux offres d'une même source
  avec des ids distincts ne fusionnent **jamais** ; le volume horaire (24H/35H)
  est discriminant — sans quoi 122 vrais postes de Beaumanoir disparaissaient.

**Canonicalisation** : chaque offre réelle = 1 `Job` + N `JobSources`. Le lien
de candidature affiché suit la hiérarchie
`employeur direct > groupe officiel > ATS officiel > jobboard spécialisé >
agrégateur` — et se promeut automatiquement si une meilleure source arrive.

## 5 · LIFECYCLE — vivre tout seul

Trois crons Railway, chacun son domaine de panne :

| Cron | Rythme | Rôle |
|---|---|---|
| `ingest` | ~2 h | nouveautés + mises à jour, géocodage, santé |
| `refresh` | quotidien | ferme les offres qu'aucune source ne rapporte plus |
| `reconcile` | hebdo | fusions rétroactives après ajout d'alias |

**Santé** : après chaque ingest, chaque source est comparée à son état
précédent. Une source qui produisait et rend zéro = `BROKEN` → **le cron sort
en erreur** et Railway l'affiche. Une chute de moitié = `DEGRADED`. Historique
borné à 10 jours (`SourceRun`).

**Purge par génération** : chaque offre porte le `PIPELINE_VERSION` qui l'a
écrite. Quand un correctif rend les anciennes lignes irréparables (descriptions
jamais stockées, secteurs non classés), on incrémente la version — le prochain
run supprime l'ancien et re-récupère. Le correctif voyage avec le déploiement ;
personne n'a de purge manuelle à retenir.

## 6 · Le site

Comportement jobboard, sans inscription : pagination serveur (25/page, toute la
base accessible), état dans l'URL (partageable), filtres visibles avec comptes
exacts, recherche multi-champs qui comprend les groupes (« sandro » atteint les
offres publiées sous SMCP ; « kering » ouvre ses 14 Maisons), `/offre/[id]`
partageable avec données structurées JobPosting, `/entreprises` classée par
volume, carte OpenStreetMap (sans clé). Aucun nom de produit dans l'interface.

---

## Limites connues, dites plutôt que cachées

- **WAF à franchir au navigateur** : Richemont (1 396 offres), Estée Lauder
  (1 400), FashionJobs. Légitime (robots les autorise), pas encore branché.
- **TalentSoft sans adaptateur** : 10 sources (~200 offres).
- **Teamtailor peut sur-compter** les paires offre×ville (Normal : 440 vs 308
  uniques) — la dédup absorbe, à corriger dans l'adaptateur.
- **L'expansion de groupe est exacte, pas floue** : « dior » trouve les offres
  mais ne saute pas vers LVMH, car le référentiel écrit « Christian Dior
  Couture ».
- **Interdits nominatifs** (jamais crawlés) : Devred, Interparfums, Made In
  Design, LinkedIn.
