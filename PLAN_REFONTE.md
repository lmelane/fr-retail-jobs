# PLAN_REFONTE.md — Refonte UI « Corporate Elegance »

> Étape 0 (audit + plan). **En attente de validation avant l'étape 1.**
> Source de vérité : `design_2.md`. Référence d'implémentation : `index_1.html`.
> Périmètre : **UI uniquement** — aucune route, API, modèle de données, logique
> ingest/dédup/matching ni SEO (title/meta/JSON-LD) modifiés.

---

## A. Audit du code existant

### A.1 Thème & tokens

| Fichier | État actuel | Action |
|---|---|---|
| `apps/web/app/globals.css` (315 l.) | Tailwind 4 `@import 'tailwindcss'` + `shadcn/tailwind.css` + `tw-animate-css` ; `@font-face catwalks_font` (5 graisses) ; `@theme` avec `--color-*`, `--radius`, palette N/B/gris, `--ease-catwalks` ; keyframes rotating-word | Réécriture : purge `catwalks_font`, tokens `--fa-*` (§2, §13), classes typo (§11), primitives filets/boutons/chips/champs (§4, §12), suppression `--radius .75rem`/`rounded-full`/`shadow-*` |
| `tailwind.config.*` | **Absent** (Tailwind 4, config dans le CSS via `@theme`) | Les mappings couleurs/typo/radius se font dans `@theme` de globals.css |

### A.2 Primitives shadcn (`components/ui/`)

| Fichier | Refonte |
|---|---|
| `button.tsx` | Variantes `.fa-btn` : primary (vert), outline (ink), outline-green, ghost, inverse, icon (§4.4 + §12). Flèche → / ↗. Plus de pill. |
| `badge.tsx` | Chips (§4.5) : neutre (bordure `--fa-line`, caption), accent (green-tint), alerte (warning). |
| `input.tsx` | Champ éditorial (§4.11) : bordure basse pointillée, fond `paper-alt`, focus vert. |
| `select.tsx` | Filtre « select pointillé » / dropdown (§4.3). |
| `card.tsx` | **Dé-boîté** : plus de bordure/ombre/radius ; séparation par filet pointillé (§2.6, §4.6, §4.8). |
| `separator.tsx` | Devient filet pointillé `linear-gradient` (`.fa-rule`, `.fa-rule-v`). |
| `skeleton.tsx` | Blocs `paper-alt` sans arrondi, pulsation 1.2s (§4.12). |
| `tabs.tsx`, `toggle*.tsx` | Onglets soulignés 1px, chips filtres (§4.3, §4.5). |
| `sheet.tsx` | Bottom-sheet mobile filtres / menu plein écran, **sans arrondi** (§4.3, §4.1). |
| `scroll-area.tsx`, `tooltip.tsx` | Ajuster tokens (fond, filet-menu) ; pas de refonte structurelle. |

### A.3 Composants métier (`components/`)

| Fichier | Section design_2.md | Note périmètre |
|---|---|---|
| `site-nav.tsx` | §4.1 Header 2 étages fixe 114px + méga-menu + burger mobile ; nav typographique (retirer icônes valise/immeuble) ; `[UX]` « Entreprises » → **« Maisons »**, ajouter « Matching » | Liens/routes inchangés (alias `/maisons` ajouté §C) |
| `site-footer.tsx` | §4.14 Footer 4 col, colonne Candidats **verte**, filets pointillés, horodatage ingest | Liens légaux inchangés (déjà corrigés) |
| `search-pill.tsx` | §4.2 Barre de recherche bordure 1px ink radius 5px, filet vertical pointillé, bouton vert « Rechercher → » | Logique autocomplete/submit inchangée |
| `rotating-word.tsx` | Home hero : la DA abandonne la pastille noire ; le H1 devient serif statique (§5.1). Composant probablement **retiré** de la home (à confirmer) | Suppression d'usage UI seulement |
| `landing-view.tsx` | §5.1 Home (hero photo 680px, intro 4+6, stats §4.9, carrousel secteurs, cartes Maison, dernières offres, bandeau matching, footer) | Données réelles branchées inchangées |
| `jobs-view.tsx` | §5.2 Moteur split-view 5+7 sur 1280 : recherche sticky (§4.2), filtres (§4.3), carte offre (§4.6) | Filtres/URL-state/infinite-scroll inchangés |
| `job-detail.tsx` | §4.7 Panneau détail : logo, titre serif `display-1`, double CTA (D18) inchangé, tableau clé/valeur en filets, description | CTA + UTM + liens inchangés |
| `companies-view.tsx` | §5.4 Maisons : titre serif, chips catégorie (§4.5), grille 3 col cartes Maison (§4.8), « Charger plus → » | Infinite-scroll/recherche inchangés |
| `company-profile-view.tsx` | §5.5 Page Maison : hero 480px, intro 4+6, chiffres clés, filtres légers + liste offres | Filtre ville/contrat inchangé |
| `company-logo.tsx` | §4.7/§4.8 Logo carré 1px `--fa-line`, monogramme `FA Display` en fallback | Source logo inchangée |

### A.4 Pages / routes (`app/`)

| Fichier | Section | Note |
|---|---|---|
| `app/layout.tsx` | §2.2 fonts + preload, §4.1/§4.14 header/footer globaux | Metadata/SEO conservés |
| `app/page.tsx` → `landing-view` | §5.1 Home | inchangé côté data |
| `app/emplois/page.tsx` → `jobs-view` | §5.2 Moteur | inchangé |
| `app/offre/[id]/page.tsx` → `job-detail` | §5.3 Offre autonome + JSON-LD **conservé** | SEO intact |
| `app/entreprises/page.tsx` → `companies-view` | §5.4 Maisons | route conservée, alias §C |
| `app/entreprise/[slug]/page.tsx` → `company-profile-view` | §5.5 Page Maison | route conservée |
| `app/error.tsx` | §4.13 erreur/503 dans la DA | inchangé côté logique |
| `app/not-found.tsx` | **Absent** → à créer | §4.13 404 serif verte |

---

## B. Fonts — plan d'intégration (§2.2)

- **FA Sans** = Mona Sans (fichiers fournis, à copier dans `apps/web/public/fonts/sans/`) :
  `Mona-Sans-Regular.woff2` → 400 · `Mona-Sans-RegularItalic.woff2` → 400 italic · `Mona-Sans-Medium.woff2` → 500.
  **Pas de graisse 600** : dans les classes typo, tout `600 sans` (caption, t-title, chips) sera mappé sur **500** (nuance explicite à `design_2.md` §2.2 : « si pas de 600, 500 »). Je documente l'écart.
- **FA Display** = **Instrument Serif** (OFL, confirmé par index_1.html + §2.2) : télécharger Regular + Italic depuis Google Fonts, **convertir en woff2**, self-host dans `apps/web/public/fonts/display/`. Aucune font via CDN en prod.
- `@font-face` + `--fa-font-display` / `--fa-font-sans` (§2.2) ; **preload** des deux Regular (`<link rel=preload as=font crossorigin>` dans `layout.tsx`).
- **Suppression** de `catwalks_font` (les 5 `@font-face` + le mapping `--font-sans/--font-heading`).

> ⚠️ Point à valider : je récupère Instrument Serif OFL et je la convertis en woff2. OK ?

---

## C. Changements UX autorisés (balisés `[UX]`)

1. **« Entreprises » → « Maisons »** dans l'UI (nav, titres). La route `/entreprises` **reste** ; j'ajoute un **alias `/maisons`** (nouvelle route qui rend le même composant) — pas de suppression, pas de rupture SEO.
2. **Normalisation de la casse des titres d'offres à l'affichage** (première lettre capitale, reste minuscule sauf acronymes H/F, CDI, VIE…). **Affichage uniquement** — pas de modif ingest (le CLAUDE.md dit « normaliser à l'ingest », mais le périmètre STRICT interdit de toucher l'ingest → je le fais côté rendu via un util `displayTitle()`, réversible).
3. **Bouton « Sauvegarder »** (bookmark) en UI, **sans backend** (état local/localStorage, per-viewer).
4. **« Charger plus »** : l'infinite-scroll existe déjà (IntersectionObserver) → je garde le comportement, j'ajoute un `btn-outline` « Charger 25 offres de plus → » comme déclencheur/fallback visible (pas de changement d'API).

---

## D. Ordre d'exécution (1 commit par étape, conforme §10)

| Étape | Contenu | Fichiers |
|---|---|---|
| **1. Tokens + fonts** | `@font-face` FA Sans/Display, preload, purge catwalks_font ; tokens `--fa-*` (§13) ; classes typo (§11) ; purge radius/shadow/pill | `globals.css`, `layout.tsx`, `public/fonts/**` |
| **2. Primitives** | filets `.rule/.rule-b/.rule-v`, boutons (§4.4/§12), chips (§4.5), champs (§4.11), dropdown (§4.3), skeleton | `components/ui/*` |
| **3. Header + Footer** | §4.1 (transparent→blanc home, méga-menu, burger), §4.14 | `site-nav.tsx`, `site-footer.tsx`, `layout.tsx` |
| **4. Home** | §5.1 alignée sur index_1.html, données réelles | `landing-view.tsx`, `app/page.tsx` |
| **5. Moteur /emplois** | §4.2/§4.3/§4.6/§4.7, split-view 5+7, responsive | `jobs-view.tsx`, `job-detail.tsx`, `search-pill.tsx` |
| **6. Maisons + Offre + états** | §5.4/§5.5/§5.3, 404, états vides, skeletons, toasts | `companies-view.tsx`, `company-profile-view.tsx`, `app/offre`, `not-found.tsx`, `error.tsx` |
| **7. QA** | Checklist §14 point par point + captures 1440/1024/390 + Lighthouse a11y ≥ 95 + grep critères | (ci-dessous) |

---

## E. Critères d'acceptation (rappel, à cocher en QA)

- [ ] grep : 0 `#000` texte · 0 `#fafafa` · 0 `rounded-full` hors point d'état · 0 `box-shadow` hors `--fa-shadow-menu` · 0 `catwalks_font`
- [ ] Contenu (titres offre/Maison/section, chiffres) en `FA Display` ; UI en `FA Sans`
- [ ] Header 114px fixe / 64px mobile ; filets pointillés `linear-gradient`
- [ ] Vert `#105A33` uniquement : CTA primaire, sélection, chips actifs, captions de bloc, chiffres clés, colonne Candidats footer, focus
- [ ] Zéro régression : recherche, filtres, sélection offre, liens candidature externes, pages Maisons, formulaire matching
- [ ] Build + lint OK ; pas de warning font fallback
- [ ] Aucun élément Lacoste (code, assets, placeholders, fixtures)

---

## F. Risques / points à trancher avant l'étape 1

1. **Instrument Serif woff2** : je la récupère (OFL) et la convertis — **OK ?**
2. **Graisse 600 sans absente** → mappée sur 500 (documenté). **OK ?**
3. **Normalisation casse des titres** : périmètre STRICT interdit l'ingest → je le fais **à l'affichage** (util `displayTitle`). **OK** ou tu préfères le faire à l'ingest plus tard ?
4. **`rotating-word.tsx`** : la DA rend le H1 serif statique → j'en **retire l'usage** sur la home (composant conservé au cas où). **OK ?**
5. **Photos hero** : la DA demande des photos pleine largeur (atelier/matière, libres de droits, jamais Lacoste/Maison sans accord). **Je n'ai pas d'asset photo.** → je mets un **hero fond `--fa-green-night` uni** (prévu §5.5 comme fallback) en attendant que tu fournisses des visuels. **OK ?**

---

**→ En attente de ta validation (F1–F5 + le plan global) avant de commencer l'étape 1.**

---

## G. Journal des étapes

- **Étape 1 ✓** tokens --fa-* + fonts (FA Sans Mona, FA Display Instrument Serif OFL), font-synthesis:none, catwalks_font purgée.
- **Étape 2 ✓** primitives (.pill/.dd/.chip/.f-input/.toggle/.toast/.sk) + shadcn ui/ (button vert, badge chips, input, card/tabs/sheet/select/skeleton) — 0 pill/ombre/gros rayon dans ui/. Portals Radix (Select/Sheet) : z-120, bordure line, shadow-menu, pas d'overlay flou.
- **Étape 3 ✓** Header 2 étages fixe (SiteNav client, mode+actif déduits du pathname, transparent→blanc home, méga-menu, burger mobile, « Maisons ») + Footer 3 col (Candidats vert, horodatage), tous deux dans le layout global. Captures : r3-home-top (transparent), r3-home-scrolled (blanc), r3-emplois (blanc), r3-footer. Le header rend FASHION ATLAS serif, filets pointillés, nav caption, CTA vert — vérifié sur /emplois. (Le hero vert-nuit de la home et la refonte des vues métier viennent aux étapes 4-6.)
- **Étape 4 ✓** Home (LandingView) DA : hero vert-nuit + grain SVG + voile, barre de recherche posée sur le bas du hero, intro éditoriale 4+6, chiffres clés (t-number vert, même source `landingStats()` que prod), secteurs (5 + comptes), Maisons qui recrutent (exclut RECRUITER/OTHER/UNKNOWN à l'affichage — filtre côté page.tsx, aucune touche API), dernières offres (displayTitle), bandeau matching vert-nuit → catwalks.io. Données réelles, aucune photo/logo Maison.
- **Étape 5 ✓** Moteur /emplois — SearchPill refondu en `.search` DA (rect 5px, filet vert au focus, filet vertical pointillé entre champs, bouton vert, autocomplete conservé) ; barre sticky `.searchbar` sous le header fixe (root `pt-(--header-h)` pour que le sticky ne recouvre pas la liste) ; filtres en pills `.pill` 3 états (repos/ouvert/actif avec croix pour retirer) + dropdown portal `.dd` (filet 1px, shadow-menu, z-120, coché vert) ; split-view `.split` 480 | filet-v | reste ; carte offre `.offer` sans boîte (filet du `<li>`, maison caption + groupe muted, titre FA Display via displayTitle, point vert si <48h, meta sans icône, hover paper-alt, sélection border-left vert, visitée grisée via sessionStorage) ; panneau détail `.detail` sticky à scroll interne (logo pastille initiale, titre serif, 2 boutons D18 — Matcher Catwalks vert + Voir l'offre outline, kv filets 160px, description prose serif 560px) ; JobDetail partagé ; sous lg carte → route `/offre/[id]` (fiche autonome restylée DA) ; skeletons/erreurs/empty DA. Parité fonctionnelle vérifiée en live (serveur hydraté) : no-horizontal-scroll, dropdown 3 options, URL secteur écrit/effacé, pill active toggle, sélection↔détail synchro, lien employeur externe, lien Matcher catwalks.io, infinite-scroll 25→50. tsc + build OK. Captures : emplois-1440-b (offre sélectionnée), emplois-1440-dropdown (Secteur ouvert), emplois-390 (mobile), offre-1440.
  - **Non implémenté (volontaire) : tri « Plus récentes ».** La maquette montre un contrôle de tri `.sort` ; la donnée n'expose aucun tri (fixe, `datePosted` desc côté serveur). On n'ajoute pas de commande morte (doctrine : pas de fausse affordance). À NE PAS chercher en recette — rebranchable quand un vrai tri sera exposé par la donnée.
  - **Complément mobile /offre : barre CTA sticky** (validé Loïc) — `position:fixed` bas, fond blanc, filet pointillé haut, 2 boutons D18 ; CTA inline masqués sur mobile. Desktop inchangé. Écart assumé à offre.html.
- **Étape 6 ✓** Maisons + fiche Maison + 404 + états.
  - **/entreprises (Maisons, §5.4)** : en-tête 4+6 (« Maisons » serif 44 + phrase avec vrai `data.total`), chips catégorie `.pill` à compteurs réels (« Toutes » active par défaut, filet pointillé haut), champ « Rechercher une Maison » 280px dans un `.field` bordé (AutocompleteField remis dans son wrapper via nouveau prop `className`), grille `.maisons` 3/2/1 sans boîte (filet du `<a>`, logo 56px **monogramme** — jamais de logo cassé, nom FA Display 24, « Secteur · Groupe », compteur FA Display + « emplois ouverts », villes body-2 « Paris (182) · … +N »), « Charger plus » + scroll infini conservés. État vide §4.13 pleine largeur. `getCompanies` inchangé sauf ajout du champ `group` (colonne `parentGroup` déjà lue).
  - **/entreprise/[slug] (fiche, §5.5)** : hero vert-nuit + grain (comme la home, faute de photo), logo 96px blanc bordé + « Secteur · Groupe » + nom serif ; **intro éditoriale masquée** (aucune `description` ingérée — on n'invente pas ; bouton « Site carrières » rendu seul si l'URL existe) ; chiffres clés serif vert **offres · villes** (pays **omis** — non exposé par la donnée) ; « Offres chez X » = barre légère D20 (ville autocomplete + pills contrat, refetch serveur scopé) + split-view partagé (JobCard/JobDetail) ; « Par ville » grille de cellules → `/emplois?maison=&ville=`. Logique filtres/loadMore/sélection préservée.
  - **404 (`not-found.tsx`, §4.13)** : colonne gauche vide (6 col) + titre serif vert uppercase + bouton outline « Accueil ». Header blanc, footer normal.
  - **États** : résultat vide /emplois & /entreprises (caption verte « Résultat vide » + titre serif + termes cherchés + « Voir toutes les offres » — **pas de bouton alerte** : le compte vit sur Catwalks, pas de fausse affordance) ; **offre expirée** = bandeau `.banner` (chip `--warn` « Expirée » + « Voir les offres similaires ») — voir décision D22-révisé ci-dessous ; **toast** `.toast` défini comme primitive (non câblé : aucun flux ne le déclenche encore) ; **barre de progression** `.progress` 2px verte en haut sur navigation (`NavProgress`, Suspense, remplace tout spinner).
  - **D22 révisé (validé Loïc 2026-09-03)** : une offre fermée renvoie toujours le **statut 410 + noindex** (SEO tenu) MAIS le middleware `rewrite` vers la vraie page (au lieu d'une page-stub codée en dur) → le candidat voit l'offre + le bandeau « Expirée » + un pont vers les offres vivantes. `getJobStatus` renvoie désormais l'offre aussi en `closed` (aucune requête en plus). JSON-LD JobPosting supprimé sur une offre fermée.
  - Parité vérifiée en live : no-hscroll, 7 cartes Maison, logo monogramme (fallback OK), chip catégorie ↔ URL secteur (écrit/effacé), recherche Maison ↔ URL q, navigation → fiche, cellule ville → /emplois filtré ; offre fermée = HTTP **410** + `x-robots-tag: noindex` + page rendue avec bandeau, puis réactivée (200). tsc + build OK. Captures : entreprises-1440, fiche-1440-top, fiche-1440-offers, etat-404, etat-empty, expired-1440.
- **Étape 7 ✓** QA finale + purge legacy.
  - **Purge legacy (D5)** : les 13 primitifs shadcn `components/ui/*` + `company-logo.tsx` + `rotating-word.tsx` sont orphelins (0 import, vérifié) après la refonte → supprimés ; `@import "tw-animate-css"` retiré (aucune classe utilisée) ; `error.tsx` (état D1) restylé DA.

## H. QA finale (étape 7)

Serveur : dev Docker Postgres local (`catwalks`, 1 996 offres, 7 Maisons). Perf mesurée aussi sur **build de prod** (`next start`) car le dev n'est pas représentatif.

### 1. Greps interdits — tous 0 en source (`app/ components/`)
```
grep -rniE 'text-\[#000\b|color:\s*#000\b|text-black\b' app components   → 0
grep -rniE '#fafafa' app components                                      → 0
grep -rniE 'rounded-(full|xl|lg|md)\b' app components                    → 0
grep -rniE 'shadow-(sm|md|lg|xl)\b' (className) app components            → 0
grep -rniE 'font-(semibold|bold)\b' app components                       → 0  (1 match = commentaire dans globals.css)
grep -rniE 'catwalks_font' app components public                         → 0
grep -rniE 'googleapis|gstatic' app components lib                       → 0  (fonts self-hosted)
grep -rniE 'lacoste' app components public                               → 0
```
Restes légitimes dans `globals.css` : neutralisations (`--shadow-*: none`, `--radius-*: var(--fa-radius)`) et remaps de tokens (§13) — ce sont les définitions qui NEUTRALISENT, pas des usages.

### 2. Fonts (inspecteur + réseau)
- Titre d'offre → `font-family: "FA Display", …serif` ; caption → `"FA Sans", …` **weight 500** (le 600 demandé est mappé sur Medium 500 — `document.fonts` : `FA Sans 500 600 loaded`).
- Réseau : **4 woff2** chargées (`FADisplay-Regular`, `FADisplay-Italic`, `FASans-Regular`, `FASans-Medium`), **0 × 404**, preload OK (2 dans `<head>`).

### 3. Captures côte à côte (scratchpad) vs maquettes
home (top transparent / scrolled), /emplois (offre sélectionnée + dropdown), /offre, /entreprises, /entreprise/[slug] (hero + offres), 404, état vide, offre expirée — à 1440 ; /emplois & /entreprises à 1024 ; mobile 390 : /emplois, /offre (barre CTA sticky), menu ouvert.

### 4. Scroll horizontal — **0 débordement** sur 6 pages × 3 largeurs (1440/1024/390) : `scrollWidth ≤ innerWidth` partout (18/18 OK).

### 5. Lighthouse (mobile, navigation)
| Page | a11y | SEO | best-pract. | perf (dev) | perf (**prod**) |
|---|---|---|---|---|---|
| home | 100 | 100 | 96 | 53 | **97** |
| /emplois | 100 | 100 | 96 | 65 | **96** |
| /offre/[id] | 100 | 100 | 96 | 70 | **97** |
| /entreprise/[slug] | 100 | 100 | 96 | 70 | **96** |

Accessibilité **100/100 partout** (seuil ≥95 tenu). Corrections apportées pour y arriver : retrait de `aria-selected` (invalide sur un `<button>` hors listbox — `aria-current` porte la sélection) et ajout d'un `<main>` unique sur home et /emplois. La perf dev (53–70) est un artefact du serveur de dev ; le build de prod donne **96–97**. Pas de baseline Lighthouse de la version Indeed-clone → comparaison avant/après non disponible (à établir sur un déploiement témoin si besoin).

### 6. Clavier — Tab parcourt header → recherche → pills → liste → détail avec **focus vert 2px visible partout** ; sur une pill : Entrée ouvre le dropdown (3 options), Échap le ferme (0 option), flèches naviguent dedans.

### 7. `prefers-reduced-motion: reduce` — toutes les transitions à `0.001s` (header, .searchbar, .offer) ; aucune animation.

### 8. Contraste (WCAG AA, seuil 4.5:1)
- Blanc sur vert-nuit `#000A05` = **20.08:1** ; blanc sur le point le plus clair réel du dégradé hero = **9.75:1** ; pire cas absolu (couleur radiale brute `#487056`, jamais atteinte car voilée) = **5.63:1** → tous ≥ 4.5.
- ink-muted `#6B6B6B` sur paper-alt `#F7F7F5` = **4.97:1** → ≥ 4.5.

### 9. Parité fonctionnelle — **14/14 OK** (live, serveur hydraté)
recherche + autocomplete · filtres Secteur/Contrat/Ville/Maison (chacun écrit puis efface son paramètre) · sélection ↔ détail · lien employeur externe · lien Matcher → catwalks.io · infinite-scroll (25→50) · chips catégorie (écrit/efface) · recherche de Maison → URL q · navigation → fiche Maison · cellule ville → /emplois filtré · offre fermée = HTTP 410 + bandeau · 404 rend `.notfound` · retour arrière Cartier↔Hermès cohérent.
