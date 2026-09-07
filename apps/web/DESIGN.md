# DESIGN.md — Mode Careers

> **La direction artistique de référence est [`design_2.md`](../../design_2.md)**, à la racine du dépôt :
> « Corporate Elegance », v1.0 du 3 septembre 2026, 57 ko, auto-suffisante
> (tokens §2, composants §4, pages §5, responsive §6, accessibilité §7).
> C'est elle qu'implémente `app/globals.css`. Elle est **postérieure** à la
> décision D17 de `CLAUDE.md` et la remplace sur tous les points de style.

## Deux pièges documentés ici, parce qu'ils ont déjà égaré des audits

**1. Ce fichier a porté une DA Material 3 périmée.** Jusqu'au 2026-09-07 il
décrivait une direction bleu Google (surfaces teintées, bordures interdites,
rayons 12–28 px), écrite le 1er septembre pour une refonte **abandonnée deux
jours plus tard**. Un audit s'y fiant aurait recommandé de repeindre le site.

**2. D17 dans `CLAUDE.md` décrit l'ancien site, pas la cible.** D17 grave
« monochrome strict, graisse 400 partout, titres en capitales, pastilles
100vmax ». `design_2.md` §0.1 liste précisément ces traits comme les
**faiblesses** de l'ancien site (« ressemble à un template SaaS… une graisse
unique, pas de contraste serif/sans, arrondis génériques, pas d'accent »), et
§1 prescrit l'inverse. Le code suit `design_2.md`. **En cas de doute, la DA
gagne sur D17**, et un audit mené sur D17 condamnerait le travail bien fait.

## Les invariants réels (source : `design_2.md` §1)

1. **Le serif porte le sens, le sans porte l'usage.** Contenu (titre d'offre,
   nom de Maison, titre de section, chiffre clé) en serif display ; interface
   (nav, filtres, libellés, boutons, métadonnées) en sans.
2. **Une seule couleur d'accent**, réservée à l'action principale, l'état
   actif/sélectionné, les liens d'emphase, les chiffres clés et les libellés de
   rubrique. Jamais en aplat décoratif de grande surface.
3. **Le filet pointillé remplace la carte.** On sépare par des filets, pas par
   des boîtes ; les bordures pleines sont réservées aux champs et boutons.
4. **Aucune ombre, un seul rayon (5 px). Pas de pastilles.** Pas de rayon sur
   les images ni sur les conteneurs.
5. **Blanc, pas gris.** Fond de page `#FFFFFF` ; le gris clair ne sert qu'aux
   surfaces de saisie et aux états désactivés.
6. **Capitales = serif display de hero, ou caption.** Les titres d'offres ne
   sont **plus** en capitales.
7. **La photo est le seul décor.** Pas d'illustration, pas de dégradé, pas de
   motif ; aucune photo dans le moteur hors logos de Maisons.
8. **Densité utile.** Vues éditoriales aux grands pas (64–160 px), vues moteur
   aux petits pas (8–24 px).

Accessibilité (§7) : contraste ≥ 4.5:1, focus visible partout, cibles tactiles
≥ 44 × 44, filets décoratifs `aria-hidden`, l'accent jamais seul porteur d'une
information, `prefers-reduced-motion` respecté, un seul H1 par page.

## Écart connu entre le code et la DA

`design_2.md` fixe l'accent à **`#105A33`** (vert, 8.3:1 sur blanc).
`app/globals.css:56` pose `--fa-green: #022026` — un bleu-pétrole très sombre.
Le nom de la variable dit « green », la valeur n'en est pas un.
**Non tranché : à arbitrer par Loïc** (aligner le code sur la DA, ou regraver la
DA sur la couleur réellement retenue). Ne pas « corriger » l'un ou l'autre sans
décision.

## Où lire le reste

| Sujet | Source |
|---|---|
| Tokens, typographie, grille, composants, pages | `design_2.md` §2 à §5 |
| Points de rupture responsive | `design_2.md` §6 |
| Accessibilité | `design_2.md` §7 |
| Photographie et imagerie | `design_2.md` §8 |
| Décisions produit qui contraignent l'UI | `CLAUDE.md` — D13, D18, D20, D22 (D17 : périmé sur le style) |
| Implémentation | `app/globals.css` |
