# Catwalks — Direction artistique

**Direction : Material 3 Expressive — le langage de Gemini.**

Implémentée avec notre stack (shadcn/ui + Tailwind + Lucide + Motion). Les
primitives shadcn sont retokenisées en Material 3 : on garde les composants,
on remplace le langage visuel. Aucun composant écrit à la main.

---

## 1. Le principe Material 3

Trois piliers, qui expliquent chaque décision plus bas :

1. **Surfaces teintées, pas de bordures.** La hiérarchie vient de plans colorés
   superposés (`surface`, `surface-container`, `surface-container-high`), jamais
   d'un filet gris. Une bordure est un aveu d'échec de la hiérarchie.
2. **Formes généreuses.** Rayons larges (12–28px) et pilules complètes sur les
   contrôles. C'est la signature visuelle la plus reconnaissable de Gemini.
3. **Motion physique.** Ressorts, pas des courbes linéaires. Le mouvement doit
   sembler avoir une masse.

---

## 2. Couleur — palette Material 3 (source : `#0b57d0`)

Rôles Material appliqués aux variables shadcn, pour que les composants suivent
sans être modifiés.

| Rôle Material | Valeur | Usage |
|---|---|---|
| `primary` | `oklch(48% 0.19 264)` — le bleu Google `#0b57d0` | Actions, état actif, pins |
| `on-primary` | `oklch(100% 0 0)` | Texte sur primary |
| `primary-container` | `oklch(92% 0.05 264)` | Fonds d'accent doux, chips actives |
| `on-primary-container` | `oklch(28% 0.11 264)` | Texte sur container |
| `surface` | `oklch(99% 0.004 264)` | Fond de page |
| `surface-container-low` | `oklch(97% 0.006 264)` | Zones surélevées |
| `surface-container` | `oklch(95.5% 0.008 264)` | Barres, panneaux |
| `surface-container-high` | `oklch(93% 0.01 264)` | Survol, sélection |
| `on-surface` | `oklch(20% 0.015 264)` | Texte principal |
| `on-surface-variant` | `oklch(45% 0.02 264)` | Texte secondaire |
| `outline-variant` | `oklch(88% 0.008 264)` | Séparateurs, en dernier recours |

**Règle :** toute surface est teintée sur la teinte 264. Un gris pur (chroma 0)
casse le système — c'est ce qui fait qu'une interface « ressemble à Bootstrap »
plutôt qu'à Material.

---

## 3. Typographie — échelle Material 3

Poppins (Google Sans n'est pas distribuée publiquement ; Poppins en est la
géométrique la plus proche).

| Rôle Material | Taille | Interligne | Graisse | Interlettrage | Usage |
|---|---|---|---|---|---|
| `headline-small` | 24px | 32px | 400 | 0 | Titre de page |
| `title-medium` | 16px | 24px | 500 | +0.15px | Titre d'offre |
| `title-small` | 14px | 20px | 500 | +0.1px | Nom de Maison |
| `body-medium` | 14px | 20px | 400 | +0.25px | Corps |
| `label-large` | 14px | 20px | 500 | +0.1px | Boutons, chips |
| `label-medium` | 12px | 16px | 500 | +0.5px | Métadonnées |

**Interlettrage positif** — c'est l'inverse d'un système Linear-like, et c'est
volontaire : Material privilégie la lisibilité posée sur la densité.

---

## 4. Formes

| Élément | Rayon | Token Material |
|---|---|---|
| Chips, boutons | `9999px` (pilule) | `corner-full` |
| Cartes, lignes | `16px` | `corner-large` |
| Conteneurs, carte | `28px` | `corner-extra-large` |
| Champs de saisie | `28px` (pilule) | `corner-extra-large` |

Le rayon large **est** la signature. Sous 12px, l'interface cesse de ressembler
à Gemini.

---

## 5. Élévation — teinte, pas ombre

Material 3 remplace les ombres portées par des **surfaces teintées**. Une carte
n'est pas « au-dessus », elle est « plus dense en couleur ».

- Niveau 0 : `surface`
- Niveau 1 : `surface-container-low`
- Niveau 2 : `surface-container` + ombre très douce `0 1px 2px rgba(11,87,208,0.06)`
- Niveau 3 : `surface-container-high`

L'ombre reste teintée bleu, jamais noire.

---

## 6. Espacement

Incréments de **4px** (`gap-1` = 4px, `gap-2` = 8px…). Material est plus aéré
qu'un outil dense : une ligne d'offre respire à `p-4` (16px), pas `py-3`.

---

## 7. Motion — ressorts, pas des courbes

Material 3 Expressive utilise un motion **physique**. Avec Motion :

```ts
// Spatial (position, taille) — rebond léger
{ type: 'spring', stiffness: 380, damping: 30 }
// Effets (opacité, couleur) — sans rebond
{ type: 'spring', stiffness: 400, damping: 40 }
```

- Entrée de liste : cascade 20ms/ligne, spring spatial
- Filtrage : `layout` sur les lignes, spring
- Pas de `duration` fixe : c'est le ressort qui décide

---

## 8. Composants

Tout vient de `npx shadcn add`, **retokenisé** via les variables CSS. Ce qui
change par rapport au défaut shadcn :

- `--radius: 1rem` (16px) au lieu de 0.5rem
- Chips et boutons forcés en `rounded-full`
- Fonds `surface-container` au lieu de bordures
- Ondulation Material approximée par une transition de fond au survol

---

## 9. Contrôle avant livraison

- [ ] Aucun gris pur : toute surface est teintée 264
- [ ] Rayons ≥ 16px, pilules sur les contrôles
- [ ] Hiérarchie par surfaces superposées, pas par bordures
- [ ] Interlettrage positif conforme à l'échelle Material
- [ ] Motion par ressorts, sans durées fixes
- [ ] Ombres teintées bleu, jamais noires
- [ ] Tous les composants issus du CLI shadcn
- [ ] `prefers-reduced-motion` respecté

---

## 10. Modèle d'interface : Indeed, langage Gemini

**Liste à gauche (~40 %), détail de l'offre à droite (~60 %).** Cliquer une offre
ouvre son détail dans le panneau, sans quitter la page ni perdre les filtres.
C'est le modèle des jobboards parce qu'il fonctionne : comparer plusieurs offres
demande de garder la liste sous les yeux.

La carte n'occupe pas la moitié de l'écran en permanence — elle devient un
onglet du panneau de droite (Détail · Carte · Analytics). Une carte est un mode
d'exploration, pas la vue par défaut d'un candidat qui lit des annonces.

Le détail contient : titre, Maison, localisation, contrat, date, description
complète, sources ayant vu l'offre, et un bouton **Postuler** qui pointe vers
l'URL canonique employeur.

---

## 11. Analytics — palette validée

Palette catégorielle, **validée par `scripts/validate_palette.js`** (5/5 en mode
clair). Ne pas modifier sans revalider : deux teintes voisines mal choisies
deviennent indiscernables en deutéranopie.

```
#1a73e8  bleu     (série 1)
#c5221f  rouge    (série 2)
#00897b  turquoise(série 3)
#b06000  ambre    (série 4)
#9334e6  violet   (série 5)
#3f7d20  vert     (série 6)
```

L'ordre est **fixe** : une teinte appartient à une entité, jamais à un rang. Un
filtre qui change le nombre de séries ne doit pas repeindre les survivantes.

Séquentiel (volumes sur carte, densité) : une seule teinte `#1a73e8`, du clair
au foncé. Jamais d'arc-en-ciel.

Formes retenues :
- **Répartition géographique** → carte à cercles proportionnels (déjà en place)
- **Publications dans le temps** → aire empilée par secteur
- **Contrats / secteurs** → barres horizontales triées
- **Top employeurs** → barres horizontales, 10 max puis « Autres »

Règles non négociables : un seul axe Y (jamais de double échelle), légende dès
2 séries, libellés directs quand ≤ 4 séries, survol avec infobulle partout.
