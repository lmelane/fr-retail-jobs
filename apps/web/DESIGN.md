# Catwalks — Direction artistique

Ce document décide à l'avance ce qui est autorisé. Sans lui, chaque composant
ajouté retombe sur les valeurs par défaut de shadcn et l'interface dérive vers le
« SaaS générique ». shadcn fournit des primitives **volontairement neutres** :
les utiliser telles quelles, c'est livrer du shadcn, pas un produit.

---

## 1. Positionnement

**Outil de précision dense** — la famille Linear / Raycast / Vercel.
Ce n'est pas un site marketing : c'est un poste de travail. Un candidat parcourt
des centaines d'offres pour en trouver une ; tout doit servir la vitesse de
balayage.

**Ce que l'utilisateur doit retenir :** « je vois tout le marché d'un coup d'œil,
et chaque offre pointe vers la Maison elle-même. »

**Ton :** sobre, éditorial, précis. Jamais festif, jamais corporate.

---

## 2. Typographie — l'outil de hiérarchie principal

Poppins, en trois niveaux stricts. **Aucun quatrième niveau** ne doit apparaître.

| Rôle | Taille | Graisse | Couleur | Usage |
|---|---|---|---|---|
| Titre d'offre | `text-[15px]` | 500 | `foreground` | Le seul élément vraiment lisible de loin |
| Maison | `text-[13px]` | 500 | `foreground/80` | Deuxième信息 recherchée |
| Métadonnées | `text-[12px]` | 400 | `muted-foreground` | Ville, contrat, date, sources |

Règles :
- **Interlettrage négatif** sur les titres (`tracking-[-0.011em]`) : à 15px, Poppins
  respire trop et perd en densité.
- **Chiffres tabulaires** (`tabular-nums`) sur tous les compteurs, sinon les
  colonnes dansent quand les nombres changent.
- Aucune typographie marketing dans le produit : pas de titre géant, pas de
  `text-4xl` hors de l'en-tête.

---

## 3. Couleur — signal, jamais décoration

Fond neutre très légèrement froid (teinte 264), une seule couleur d'accent.

- **Accent indigo** (`oklch(52% 0.19 264)`) : réservé aux pins de carte, à l'état
  actif d'un filtre, au focus. Rien d'autre.
- **Neutres** : tout le reste — structure, texte, bordures.
- **Interdits** : dégradés décoratifs, palette multicolore, couleur « parce que
  c'est joli ». Si une couleur n'encode pas une information, elle sort.

Une couleur qui apparaît partout ne signifie plus rien.

---

## 4. Profondeur et surfaces

La hiérarchie passe par la **densité et l'alignement**, pas par des boîtes.

- **Pas de cartes** dans la liste : des lignes séparées par un filet 1px.
  Une pile de cartes ajoute 16px de padding par offre sans ajouter d'information.
- **Ombres** : une seule, très basse (`shadow-[0_1px_2px_rgba(0,0,0,0.04)]`), et
  uniquement sur les éléments réellement flottants (barre de filtres collante,
  overlay de carte).
- **Rayons** : `0.5rem` maximum. Les grands arrondis lisent « consumer », pas
  « outil professionnel ».
- **Bordures** : uniquement pour séparer des zones fonctionnelles. Jamais pour
  décorer un bloc.

---

## 5. Densité et rythme

- Ligne d'offre : `py-3 px-5`. Assez compact pour voir ~12 offres sans défiler,
  assez aéré pour rester cliquable au doigt.
- Espacement vertical dans une ligne : `gap-1` maximum. Les blocs de texte d'une
  même offre appartiennent ensemble.
- L'en-tête reste **collant** : les filtres doivent survivre au défilement, sinon
  l'utilisateur remonte constamment.

---

## 6. Motion — une intention, pas des effets

Motion (`motion/react`) sert à **révéler la hiérarchie**, pas à animer.

Autorisé :
- Une cascade d'entrée sur la liste (`delay: index * 12ms`, plafonnée à ~200ms).
- Transition d'opacité/position sur filtrage (`120ms`), pour que l'œil suive le
  changement au lieu de re-scanner.
- `layout` sur les lignes, pour que la réorganisation soit lisible.

Interdit :
- Effets au survol qui ne signalent rien.
- Animations d'entrée sur des éléments statiques (en-tête, carte).
- Toute animation dépassant 200ms dans le produit.

`prefers-reduced-motion` doit rester respecté.

---

## 7. États — c'est là que se joue le « fini »

Ce que l'on néglige d'habitude et qui distingue une interface soignée :

- **Survol de ligne** : fond `muted/60` + le lien externe apparaît. Rien d'autre.
- **Focus clavier** : anneau visible, jamais supprimé. La navigation au clavier
  est un cas d'usage réel sur une liste longue.
- **État vide** : jamais « aucun résultat » seul. Toujours dire pourquoi et
  proposer l'action (retirer un filtre).
- **Chargement** : squelettes aux dimensions réelles, jamais un spinner centré
  qui fait sauter la mise en page.
- **Actif** : un filtre sélectionné doit être évident sans relire son libellé.

---

## 8. Carte

- Fond de carte **en couleur** (CARTO Voyager) : une carte désaturée perd sa
  lisibilité géographique, qui est sa seule raison d'être.
- Pins groupés **par ville**, jamais par offre : les offres d'une même adresse
  partagent les coordonnées et s'empileraient invisiblement sur Paris.
- Rayon proportionnel au volume ; la couleur reste constante. Le volume est une
  quantité, il se lit en taille.

---

## 9. Contrôle avant livraison

- [ ] Aucun composant écrit à la main : tout vient de `npx shadcn add`
- [ ] Trois niveaux typographiques, pas quatre
- [ ] L'accent n'apparaît que sur pins, état actif et focus
- [ ] Aucune carte dans la liste
- [ ] Survol, focus, actif et vide sont tous traités
- [ ] Une seule séquence de motion, sous 200ms
- [ ] Lisible et utilisable au clavier
- [ ] Ne ressemble pas à du shadcn par défaut
