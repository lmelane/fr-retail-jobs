# Refonte UI — « Corporate Elegance » (Fashion Atlas)

## Résumé (10 lignes)
Refonte **UI complète** de Fashion Atlas, du clone Indeed monochrome vers la DA « Corporate Elegance » (design_2.md + 7 maquettes). Deux familles self-hosted : **FA Display** (Instrument Serif, contenu) + **FA Sans** (Mona Sans, UI) ; blanc pur, un seul accent **vert #105A33**, filets pointillés, radius 5px, aucune ombre au repos. Refondues : header 2 étages + footer globaux, home (hero vert-nuit + grain), moteur `/emplois` (barre sticky, filtres en pills, split-view, cartes serif, panneau détail à scroll interne), fiche offre autonome, annuaire Maisons, fiche Maison, 404, états vides, offre expirée, barre de progression. **Logique préservée** (URL-state, autocomplete, filtres, infinite-scroll, sélection↔détail, double CTA D18) — parité 14/14 vérifiée en live. Accessibilité **100/100** et perf prod **96–97** (Lighthouse mobile) sur les 4 pages clés. Tout le legacy shadcn (`ui/*`, `company-logo`, `rotating-word`, `tw-animate-css`) est **supprimé** (D5). Périmètre : UI + 2 touches data display-only (voir §Écarts).

## Décisions produit appliquées (D14–D22)
- **D14 / D18** — Fashion Atlas owns the search, Catwalks owns the candidate. Double CTA honnête sur chaque offre : « Voir l'offre chez [Maison] » (lien direct employeur) + « Matcher mon profil avec Catwalks » (catwalks.io/inscription + UTM, ne promet jamais de transmettre la candidature). Nav « Matching » et « À propos » = liens externes catwalks.io (↗, _blank) ; footer « Créer une alerte » idem ; **pas de page /matching interne** (Fashion Atlas n'a pas de backend candidat — un formulaire CV serait un doublon ou une promesse non tenue).
- **D17** — DA noir/blanc/gris + un vert, weight 400 partout (600 → Mona Sans Medium 500, pas de fausse graisse : `font-synthesis-weight: none`), titres serif, pills radius 5px, transitions 0.3s.
- **D19** — Monde par défaut, filtre Pays.
- **D20** — Fiche Maison : barre légère (ville + contrat) scopée, refetch serveur.
- **D22 (révisé, validé Loïc 2026-09-03)** — Offre fermée : **statut 410 + noindex** (SEO tenu, Google déréférence) MAIS le middleware `rewrite` vers la vraie page → le candidat voit l'offre réelle + un **bandeau « Expirée »** + un pont vers les offres vivantes, au lieu d'une page-stub. `getJobStatus` renvoie l'offre en `closed` (0 requête en plus) ; JSON-LD retiré sur offre fermée.

## Écarts assumés avec les maquettes (justifiés)
- **matching.html non construit** : sa page contient un formulaire profil + upload CV (« visible par les Maisons ») que Fashion Atlas ne peut pas honorer (backend candidat = Catwalks, D14/D18). Remplacé par un lien externe.
- **Pages légales (CGU/Confidentialité/Mentions)** : gardées **externes** vers catwalks.io (marque Catwalks, source légale unique) plutôt que dupliquées — 5 URLs vérifiées 200.
- **Fiche Maison — intro éditoriale masquée** : aucune `description` n'est ingérée ; on ne l'invente pas (le bouton « Site carrières » reste si l'URL existe).
- **Fiche Maison — stat « pays » omise** : non exposée par la donnée (on affiche offres + villes).
- **Tri « Plus récentes » non implémenté** : la donnée n'expose aucun tri (fixe `datePosted` desc) — pas de commande morte.
- **CTA sticky mobile /offre** : ajoutée (position fixed bas) alors que offre.html ne l'a pas — validé pour la conversion mobile.

## Suites hors scope à ouvrir en tickets
1. **[BUG SEO] `addressCountry: 'FR'` en dur dans le JSON-LD JobPosting** (`app/offre/[id]/page.tsx`) alors que le site est monde (D19) : une offre Milan/London déclare la France. À dériver du vrai pays de l'offre.
2. **Photos hero à fournir** (home, fiches Maison) : le fond vert-nuit + grain est le fallback (`data-hero`), prêt à recevoir une photo 16:5.
3. **Tri des offres non exposé par la donnée** : rebrancher le contrôle `.sort` quand un tri réel existera côté serveur.
4. **Graisse 600 absente** : ajouter Mona Sans SemiBold si on veut des captions plus fermes (aujourd'hui 600 → 500).
5. **Commentaire périmé** sur `suggestCities`/`suggestTitles` (`lib/jobs.ts`) : mentionne D12 (FR-only) alors que le code est monde (D19) — mettre à jour pour éviter une régression future.

## Vérifications (voir PLAN_REFONTE.md §H)
- Greps interdits (8) → tous 0 en source.
- Fonts : 4 woff2, 0×404, FA Display sur titres, FA Sans 500 sur captions.
- 0 scroll horizontal sur 6 pages × 3 largeurs (1440/1024/390).
- Lighthouse mobile : a11y **100**, SEO **100**, best-practices **96**, perf **96–97** (build prod) sur home/emplois/offre/fiche.
- Clavier : focus vert visible, dropdown Entrée/Échap/flèches ; `prefers-reduced-motion` : transitions à ~0.
- Contraste ≥ 4.5:1 (hero blanc/vert-nuit pire cas 5.63, ink-muted/paper-alt 4.97).
- Parité fonctionnelle : 14/14.

## Plan de test (à rejouer en recette)
- [ ] `/emplois` : rechercher un poste + une ville (autocomplete), appliquer puis retirer chaque filtre (Pays/Secteur/Contrat/Ville/Maison/Groupe), sélectionner une offre (détail sync), « Voir l'offre » → employeur, « Matcher » → catwalks.io, scroller (page suivante), bouton retour navigateur.
- [ ] `/entreprises` : chips catégorie, recherche Maison, cliquer une Maison → fiche.
- [ ] `/entreprise/[slug]` : barre légère ville/contrat, « Par ville » → /emplois filtré, alterner deux Maisons (offres cohérentes).
- [ ] Offre fermée → HTTP 410 + bandeau ; id inexistant → 404 ; recherche sans résultat → état vide.
- [ ] Mobile 390 : menu plein écran, barre CTA sticky sur /offre, champs de recherche empilés.
