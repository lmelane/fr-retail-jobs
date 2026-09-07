# Évaluation B — Audit TECHNIQUE mesuré de Mode Careers

> **Périmètre** : implémentation uniquement (accessibilité, performance, responsive, thématisation, intégrité). Ce n'est **pas** une critique de design.
> **Cible mesurée** : `https://modecareers.com` (la vérité de production), pages `/`, `/emplois`, `/offre/women-s-senior-sales-professional-cmtpunrth2oefl35mpr5vt0qt`, `/entreprises`, `/intelligence`, `/intelligence/{marche,metiers,geographies,methodologie}`.
> **Tailles** : desktop 1440×900 et iPhone 13 (390×844), plus un balayage 320 → 1440 px.
> **Référence de jugement** : `design_2.md` §6 (ruptures) et §7 (accessibilité) — les exigences que le produit s'est lui-même données.
> **Date des mesures** : 2026-09-07. Outil : Playwright + `sharp` (lecture de pixels réels). Scripts jetables supprimés après exécution.

---

## Tableau de notation

| # | Dimension | Note | Justification en une ligne |
|---|---|---|---|
| 1 | **Accessibilité** | **3 / 4** | Socle très solide (0 élément interactif sans nom, 1 seul H1/page, focus 2px vert conforme, vert jamais seul) ; deux manques réels : pas de lien d'évitement, blocs du panneau détail non balisés en titres. |
| 2 | **Performance** | **3 / 4** | CWV excellents (LCP 192–660 ms, CLS ≈ 0) et zéro `will-change` au repos ; **mais 4,4 Mo de MP4 servis à l'iPhone**, y compris quand la vidéo est masquée. |
| 3 | **Responsive** | **3 / 4** | 0 débordement horizontal partout, zoom 200 % propre, CTA sticky conforme ; le header reste à 114 px sous 768 px et le burger bascule à 1024 au lieu de 768 (§6). |
| 4 | **Thématisation** | **4 / 4** | Tokens `--fa-*` appliqués sans fuite : **0 couleur hors tokens** sur `/emplois` et `/entreprises` ; les seules valeurs libres sont des alphas de voile, intentionnels et documentés. |
| 5 | **Intégrité d'implémentation** | **3 / 4** | Système cohérent, honnête, non interchangeable ; un écart de gouvernance (licence CC BY 4.0 republiée alors que D38 la retirait en attente d'arbitrage) et un correctif de couverture manquant (`.kpi__sub`). |

### **Total : 16 / 20 — bande « solide »**

Le produit est nettement au-dessus de la moyenne d'un jobboard : mesuré, pas supposé, il n'a **aucun** défaut critique de rendu, de contraste courant ou de débordement. Ce qui le retient sous 18/20 tient à trois choses concrètes et peu coûteuses : le poids vidéo sur mobile, deux ruptures §6 non respectées, et deux trous d'accessibilité ponctuels.

---

## 1. Accessibilité — 3/4

### MAJEUR

**A1. Aucun lien d'évitement (« Aller au contenu ») sur les 9 pages.**
Mesure : détection de `a[href^="#"][class*=skip]`, `a[href="#main"]`, `a[href="#content"]` → `skipLink=false` sur **18/18** combinaisons page × taille. Confirmé par l'ordre de tabulation réel : sur `/emplois`, il faut **11 tabulations** (logo, langue, 5 entrées de nav, 2 champs, bouton Rechercher) avant d'atteindre le premier filtre, et **17** avant la première offre — répété à chaque page.
Conséquence : un utilisateur clavier ou lecteur d'écran retraverse tout l'en-tête à chaque navigation. `design_2.md` §7 ne le nomme pas explicitement, mais c'est le corollaire direct de « navigation clavier » sur un site dont la valeur est une liste.

**A2. Les blocs du panneau détail ne sont pas des titres.**
Mesure : hiérarchie relevée sur `/emplois` et `/offre/<id>` → séquence de titres = `1` **seule**, aucun H2/H3.
Code : `components/job-detail.tsx:93` `<span className="t-caption green">Détails de l'emploi</span>` et `components/job-detail.tsx:162` `<span className="t-caption green">Description</span>`.
`design_2.md` §7 exige : « un seul H1 par page (hero ou titre d'offre), H2 = sections, **H3 = blocs du panneau** ». Le H1 est bien là (`job-detail.tsx:133`), les blocs manquent. Sur la page où le candidat lit le contenu le plus long du site, un lecteur d'écran ne dispose d'aucun point de saut interne.

**A3. Les champs de recherche n'ont pas d'indicateur de focus propre.**
Mesure : aux arrêts de tabulation 9 et 10 sur `/` **et** `/emplois`, `outlineStyle=none`, `outlineWidth=0px`, `boxShadow=none` sur l'`<input>` lui-même. Origine : `app/globals.css:490` `.field input { border: 0; outline: 0; … }` — un `outline: 0` sans remplacement sur l'élément, ce que §7 interdit nommément (« Jamais `outline: none` sans remplacement »).
**Nuance mesurée, qui abaisse la gravité** : un retour visuel existe quand même au niveau du conteneur — `app/globals.css:484` `.search:focus-within { border-color: var(--fa-green); }`. Preuve par pixels : **2,12 %** des pixels de la zone (champ + 24 px de marge) changent à la prise de focus, la bordure du groupe passant à `rgb(2,32,38)`. Ce n'est donc pas un focus invisible, mais un focus **porté par le groupe entier** : avec deux champs côte à côte, l'indicateur ne dit pas *lequel* des deux est actif. C'est le vrai défaut.

### MINEUR

**A4. Contraste sous le seuil sur `.kpi__sub` du hero Intelligence.**
Mesure : `/intelligence`, `span.t-body2.kpi__sub` (« base 100 le 6 sept. 2026 »), `rgb(107,107,107)` sur `rgb(1,13,16)` → **3,70:1**, seuil 4,5:1 (14 px, graisse 400). Identique en desktop et mobile.
Cause exacte : `app/globals.css:600-609` réécrit pour fond sombre `.t-caption`, `.t-caption-soft`, `.kpi__value` et `.kpi__na`, **mais pas `.kpi__sub`**, qui reste sur `--fa-ink-muted` (`app/globals.css:617`), une encre calibrée pour le papier blanc. Un seul oubli dans une série de cinq.

**A5. Contraste à la limite sur le compteur des pills actives.**
Mesure : `/entreprises`, `span.count.tabular-nums` dans `.pill.is-active` → `rgb(107,107,107)` sur `rgb(228,237,238)` = **4,48:1** pour un seuil de 4,5:1. Un écart de 0,02 — techniquement un échec, pratiquement imperceptible. Origine : `app/globals.css:237` `.pill .count { color: var(--fa-ink-muted) }` non ajusté au fond `--fa-green-tint`.

### Ce qui est CONFORME (mesuré, et qui porte la note à 3)

- **Noms accessibles** : arbre ARIA de Chromium sur `/emplois` → **0 élément interactif sans nom** sur 269 lignes d'arbre. Les deux champs de recherche portent `aria-label="Poste ou mot-clé"` et `"Lieu"`.
- **Focus visible ailleurs** : `outline: solid 2px rgb(2,32,38)`, `outline-offset: 2px` sur **20 des 22** premiers arrêts de tabulation — exactement la spécification §7.
- **Un seul H1 par page** : vérifié sur les 9 pages × 2 tailles, `h1=1` partout, aucun saut de niveau (séquences `1,2,2,2…`).
- **Landmarks** : `main=1`, `header`, `footer` présents partout ; `nav` **toujours étiqueté** (`navSansLabel=0` sur 18/18).
- **Le vert n'est jamais seul** (§7) : l'offre sélectionnée cumule `background: rgb(247,247,245)`, `box-shadow: inset 2px 0 0 rgb(2,32,38)` **et** `aria-current="true"`.
- **Filets pointillés** : 32 porteurs de `.rule*`, dont 1 seul purement décoratif — et il est bien `aria-hidden="true"`. Conforme §7.
- **Formulaires** : 0 champ sans libellé sur l'ensemble des pages. **SVG** : 0 icône ni `aria-hidden` ni titrée, sur 12 à 24 SVG par page. **Images** : 0 image sans attribut `alt`.
- **Aucun faux bouton** : 0 `div`/`span` avec `onclick` ou `role="button"` sur les 9 pages.
- **Clavier sur le filtre** : la pill porte `aria-expanded="true"` et `aria-haspopup="listbox"`, le panneau `role="listbox"` avec 119 `role="option"`, **Échap ferme et rend le focus à la pill**. Pas de piège.
- **Contraste du texte blanc sur le hero photo/vidéo** : mesuré en masquant le texte et en lisant le fond réellement rendu — **pire cas 5,85:1** (logo mobile), moyenne 8,9–12,4:1 sur les entrées de nav et le H1. Le voile §8 fait son travail.

---

## 2. Performance — 3/4

### MAJEUR

**P1. 4,4 Mo de vidéo MP4 téléchargés sur iPhone — y compris quand la vidéo est masquée.**
Mesures (3 contextes, comptage des réponses `.mp4`) :

| Contexte | Requêtes MP4 | Octets | `display` de la vidéo |
|---|---|---|---|
| iPhone 13, normal | 1 | **4 423 ko** | `block` (lit) |
| iPhone 13, `prefers-reduced-motion: reduce` | 1 | **4 423 ko** | `none` |
| Desktop, `prefers-reduced-motion: reduce` | 1 | **4 423 ko** | `none` |

Poids total de `/` = **4 522 ko**, dont **97,8 % de vidéo** (les autres pages pèsent 53 ko). Le budget « landing page » des règles projet est de 150 ko de JS ; il n'y a pas de budget média écrit, mais 4,4 Mo sur un réseau mobile est l'ordre de grandeur d'une page entière de magazine.
Deux défauts distincts, tous deux mesurés :
1. **`app/globals.css:207-209`** masque la vidéo en `display:none` sous `prefers-reduced-motion` — correct visuellement — mais le téléchargement a déjà eu lieu : `readyState=4`, `buffered=37 s`. L'utilisateur qui demande moins d'animation paie quand même 4,4 Mo. `components/landing-view.tsx:67` porte `preload="metadata"`, ce qui n'empêche pas Chromium de poursuivre le chargement une fois `autoPlay` déclenché.
2. **Aucune coupure par taille d'écran** : le même fichier desktop part vers un écran de 390 px.
Le poster `/brand/hero-poster.jpg` (46 ko) est déjà en place comme fond de section (`landing-view.tsx:58`) : le repli existe, il n'est simplement pas utilisé pour épargner le mobile.

### MINEUR

**P2. `.progress` anime `width` — seul cas réel du site, et son coût est négligeable.**
Le détecteur d'origine signalait `components/nav-progress.tsx:61`. **Confirmé, mais à requalifier** : mesure d'une navigation réelle → `transitionProperty: "width, opacity"`, `transitionDuration: "0.2s, 0.2s"`, `position: fixed`, `height: 2px`. C'est bien une animation de propriété de layout, contraire à la règle « propriétés compatibles compositeur ». Mais l'élément est un trait fixe de 2 px **sans enfant** : le recalcul de mise en page qu'il déclenche ne touche aucun contenu. Coût réel proche de zéro ; à corriger par principe (`transform: scaleX()`), pas par urgence.

**P3. Poids JS de ~400 ko décodés par page.**
Mesure (corps de réponse décodés) : `/` 401 ko · `/emplois` 410 ko · `/intelligence` 392 ko · `/geographies` 392 ko de JavaScript, plus 42 ko de CSS et 53 ko de polices. Au-dessus du budget « landing page < 150 ko » des règles projet, dans la fourchette « app page < 300 ko » dépassée d'environ un tiers. À relativiser fortement : ces valeurs sont **décodées**, non compressées, et les CWV réels sont excellents — donc c'est une marge de manœuvre, pas une douleur constatée.

### Ce qui est CONFORME (et qui est remarquable)

- **Core Web Vitals réels**, mesurés via `PerformanceObserver` sur le site en ligne :

| Page | LCP desktop | LCP mobile | CLS | DOM |
|---|---|---|---|---|
| `/` | 636 ms | 660 ms | **0,0000** | 287 |
| `/emplois` | 400 ms | 344 ms | 0,0001 | 475 |
| `/intelligence` | 304 ms | 192 ms | 0,0001 | 1 201 |

Cibles projet : LCP < 2,5 s, CLS < 0,1, FCP < 1,5 s. **Toutes tenues avec un facteur 4 à 10 de marge.** Un CLS de 0,0000 sur une page à hero vidéo n'est pas un accident : le poster est posé en fond de section et la hauteur est figée à `47.5rem` (`landing-view.tsx:57`).
- **`will-change` : 0 élément** en porte au repos, sur les 9 pages. C'est le défaut classique des sites animés, et il est absent.
- **Images** : sur les 26 logos de `/emplois` et les 22–24 de `/entreprises`, **0 sans dimensions explicites**, **0 sans attribut `loading`**. D'où le CLS nul.
- **Polices** : 53 ko pour 3 fichiers woff2, `font-display: swap` (`globals.css:19-42`), self-hébergées, aucune requête CDN.

---

## 3. Responsive — 3/4

### MAJEUR

**R1. Le header ne descend jamais à 64 px, et le burger bascule à 1024 px au lieu de 768 px.**
`design_2.md` §6 impose : header **114 px** ≥ 1024, **64 px + burger** sous 768.
Mesure sur `/emplois`, hauteur réelle du `<header>` et présence du bouton « Menu » :

| Largeur | Hauteur header | Burger | Liens de nav visibles | Attendu §6 |
|---|---|---|---|---|
| 1440 | 114 px | non | 6 | 114 px ✓ |
| 1200 | 114 px | non | 6 | 114 px ✓ |
| 1024 | 114 px | non | 6 | 114 px ✓ |
| 1023 | 114 px | **oui** | 0 | 114 px, **sans** burger ✗ |
| 900 | 114 px | oui | 0 | 114 px, sans burger ✗ |
| 768 | 114 px | oui | 0 | 114 px, sans burger ✗ |
| **767** | **114 px** ✗ | oui | 0 | **64 px** + burger |
| 390 | **114 px** ✗ | oui | 0 | **64 px** + burger |
| 320 | **114 px** ✗ | oui | 0 | **64 px** + burger |

Deux écarts distincts :
- Le burger apparaît à **1023 px**, soit la rupture Tailwind `lg` (1024), là où §6 place la bascule à **768**. Code : `components/site-nav.tsx:102` (`lg:hidden` sur le bouton Menu) et `site-nav.tsx:109` (`lg:flex` sur la nav). Entre 768 et 1023 px — toute la tablette en portrait — la navigation est repliée dans un burger alors que la DA la veut déployée.
- La hauteur reste figée à 114 px jusqu'à 320 px, parce que `--header-h: 114px` est déclarée une seule fois sur `:root` (`app/globals.css:73`) sans redéfinition mobile. Sur un iPhone 13 (844 px de haut), l'en-tête consomme **13,5 %** de la hauteur d'écran au lieu des 7,6 % prévus — au détriment direct de la liste d'offres.

### Ce qui est CONFORME

- **Débordement horizontal : 0 px**, confirmé sur **18/18** combinaisons page × taille, plus le balayage 320 → 1440 px. Aucune exception.
- **Zoom 200 %** : testé à 1280 px logiques (viewport CSS 640) et par agrandissement du texte seul à `font-size: 32px` → **0 px de débordement** sur `/`, `/emplois`, `/intelligence`. Tailles en `rem`, comme §7 l'exige.
- **Split-view (§6)** : `grid-template-columns` mesurée = `480px 1px 711px` à 1440, `480px 1px 455px` à 1024, puis **colonne unique** dès 900 px avec `.detail` en `display:none`. La bascule « liste seule » est bien à 1024. Conforme.
- **CTA détail sticky (§6 : sticky bas < 1024)** : mesuré sur `/offre/<id>` → `.apply-bar` en `display:none` à 1440/1024/900, puis `display:grid; position:fixed` à 767 et 390, avec masquage simultané des actions inline (pas de doublon). Le comportement est **correct et documenté** (`globals.css:440-462`) ; il diverge de §6 sur le seuil (767 au lieu de 1024) — mais cet écart est **explicitement assumé et validé par Loïc** dans le commentaire du code.
- **Barre de recherche (§6 : empilée < 768)** : `grid-template-columns` passe de 3 colonnes à 1 colonne exactement entre 768 et 767 px. Conforme au pixel près.
- **Grille Maisons (§6 : 3 / 2 / 1 col)** : `globals.css:399-413`, ruptures à 1023 et 767. Conforme.

---

## 4. Thématisation — 4/4

Le mode sombre est hors sujet par décision produit ; il n'entre pas dans la note.

**Résultat mesuré : le système de tokens ne fuit pas.** Balayage de `color`, `background-color`, `border-top-color`, `border-left-color` sur tous les éléments, comparé aux 14 valeurs `--fa-*` calculées :

| Page | Combinaisons hors tokens |
|---|---|
| `/emplois` | **0** |
| `/entreprises` | **0** |
| `/` | 4 |
| `/intelligence` | 10 |
| `/intelligence/geographies` | 5 |

Zéro sur les deux pages fonctionnelles du produit est un résultat rare. Les valeurs hors tokens restantes sont toutes **intentionnelles et justifiables** :
- `rgba(0,0,0,.35)` et `rgb(1,19,23)` sur `/` : le voile du hero et son fond de repli (`landing-view.tsx:58,74`), documentés — §8 demande un voile, non un token.
- `rgba(255,255,255,.5 → .85)` sur `/intelligence` : les encres blanches du hero vert-nuit (`globals.css:601-609`), c'est-à-dire précisément le mécanisme d'adaptation au fond sombre.
- Les cinq `oklab(…)` de `/geographies` : l'échelle séquentielle de la carte, dérivée par calcul du vert de marque — un dégradé de données, pas une couleur codée en dur.

**Cohérence des tokens** : `--radius-sm` à `--radius-4xl` pointent tous sur `--fa-radius` (5 px) et `--shadow-*` sont tous `none` (`globals.css:340-350`) — les utilitaires shadcn/Tailwind hérités sont neutralisés à la source plutôt que combattus au cas par cas. Le pont shadcn (`globals.css:78-109`) mappe chaque variable de composant sur un token `--fa-*`. C'est la bonne architecture.

**Seule réserve, déjà comptée en A4** : `.kpi__sub` prouve que la couverture des surcharges « fond sombre » se fait à la main, sans garde-fou. Le défaut n'est pas le token, c'est l'absence de test.

---

## 5. Intégrité d'implémentation — 3/4

### MAJEUR

**I1. La licence « CC BY 4.0 » est affichée en production alors que D38 l'avait retirée en attendant l'arbitrage de Loïc.**
Mesure : `curl https://modecareers.com/intelligence/methodologie` → 3 occurrences de « CC BY 4.0 » ; le lien est présent sur `/intelligence`, `/marche`, `/metiers`, `/geographies`, `/methodologie` (relevé dans les cibles tactiles des 5 pages).
Source : `apps/web/lib/intelligence/seo.ts:20-21` (`DATA_LICENSE_URL`, `DATA_LICENSE_NAME`), réintroduite par le commit `7c72559` (« … licence CC BY »).
Or `CLAUDE.md`, D38, grave : « licence CC BY 4.0 publiée dans le JSON-LD sans décision → **retirée** (à Loïc de décider d'une licence de données) », et « **Reste ouvert (décisions Loïc)** : licence de publication des données de l'observatoire (aucune n'est affichée) ».
Ce n'est pas un bug de rendu : c'est une **décision métier structurante — les conditions de réutilisation de la donnée — reprise par le code après avoir été explicitement réservée au propriétaire**. CC BY 4.0 autorise la réutilisation commerciale par un concurrent moyennant simple attribution. À remonter à Loïc, pas à corriger unilatéralement.

### MINEUR

**I2. `prefers-reduced-motion` est un « kill » global à 1 ms, sans alternative conçue.**
Code : `app/globals.css:578-585`, `*, *::before, *::after { animation-duration: 1ms !important; transition-duration: 1ms !important; transition-delay: 0ms !important; animation: none !important; }` — exactement le motif que le protocole désigne comme suspect.
Mesure sous `reducedMotion: 'reduce'` : `.btn` → `transitionDuration: 0.001s`, `.u-line::after` → `0.001s`, 0 animation en cours.
**Verdict nuancé, appuyé sur la mesure** : ce kill est *moins* dommageable ici qu'ailleurs, pour deux raisons vérifiées. (a) Les contenus révélés au scroll ne disparaissent pas : les 3 éléments `[data-stagger-index]` mesurés sont `revealed: true`, `opacity: 1`, `transform: none` — donc pas d'écran vide, le piège classique est évité. (b) La vidéo du hero est remplacée par son poster (`globals.css:207-209`), ce qui est une vraie alternative pensée. Ce qui reste perdu, c'est le **retour visuel des interactions** : le remplissage de bouton et le soulignement de lien passent de 150/300 ms à 1 ms, donc en saut instantané. C'est acceptable, mais `design_2.md` §2.7 prescrit lui-même ce bloc — le produit applique donc sa propre spécification. Défaut mineur, hérité de la DA.

**I3. Trois logos servis très au-delà de leur taille d'affichage.**
Mesure sur `/entreprises` : `ulta.com` **1024×1024 → 56×56** (facteur 18), `crocs.com` 256×256 → 56×56, `mango.com` 128×128 → 56×56, via `/api/logo?domain=…`. Sans impact CWV mesurable (CLS nul, LCP 304–400 ms) car les dimensions sont déclarées et le chargement différé ; c'est de la bande passante gaspillée, pas une régression d'expérience.

### Ce qui témoigne d'une VRAIE intégrité (et vaut la note de 3)

- **Le produit n'est pas interchangeable.** La grammaire de `design_2.md` est appliquée jusque dans le détail vérifiable : radius unique 5 px, `box-shadow: none` généralisé, filets pointillés en `background-image` (`globals.css:132-141`) au lieu de bordures, serif pour le contenu / sans pour l'interface. On ne peut pas remplacer ce CSS par un thème shadcn générique.
- **Pas de contenu décoratif trompeur.** Les blocs Intelligence portent leur niveau de preuve (`.lvl--insight`, `FACT/DERIVED/INSIGHT`), la ligne de couverture (`.coverage`) et un `.na` explicite (`globals.css:639`) qui affiche « n/d » plutôt qu'un chiffre reconstruit. Le hero ne dit plus « en direct » (crons gelés). C'est de l'honnêteté d'affichage codée en dur.
- **Les commentaires du CSS documentent des causes réelles**, pas des intentions : le piège du `*/` dans un commentaire (`globals.css:10-12`), le `overflow:hidden` retiré de `.search` parce qu'il clippait les suggestions (`globals.css:477-478`), le liseré blanc du hero (`globals.css:480-482`), le `--rule-gap` qui écrasait les `pb-*` (`globals.css:133-137`). Chaque rustine porte sa mesure et sa date.
- **Aucun raccourci répété détecté** : 0 faux bouton, 0 champ sans libellé, 0 SVG non étiqueté, 0 image sans `alt`, sur 9 pages.

---

## Faux positifs écartés, et pourquoi

**FP1 — « 22 à 258 cibles tactiles < 44×44 » : le compte brut est trompeur ; les vrais problèmes sont bien plus rares.**
Décomposition mesurée du pic annoncé (`/intelligence/geographies` mobile, 258 éléments) :

| Nature | Nombre | Taille médiane | Verdict |
|---|---|---|---|
| Liens de pays dans la **carte SVG** (`a` dans `svg`) | 93 | **6,2 × 5,8 px** | **Faux positif** — voir ci-dessous |
| Liens de **cellules de tableau** (`a` dans `td`) | 116 | 15 px de haut | **Faux positif** — voir ci-dessous |
| Liens en `span` dans une phrase | 34 | 15 px de haut | **Faux positif** : lien inline dans du texte courant |
| Entrées de nav du menu mobile (`li`) | 11 | 16 px de haut | **Vrai problème mineur** |
| Boutons de bascule de la carte | 2 | 34 px de haut | **Vrai problème** |
| Divers (logo, footer, méthodologie) | 2 | 12–18 px | Faux positif (liens inline) |

- **Les 93 pays de la carte** ne sont pas une cible tactile ratée : la page fournit **une alternative en tableau des mêmes données** (`tableAlternative: true`, mesuré), les 95 liens sont tous nommés (`aria-label="États-Unis : 27 773 offres"`) et focalisables au clavier. Une carte choroplèthe ne peut pas avoir des frontières de 44 px sans cesser d'être une carte ; le critère WCAG 2.5.8 exempte explicitement les cibles dont la fonction est dupliquée ailleurs sur la page. **Écarté.**
- **Les 116 liens de tableau** (« France », « Canada »…) font 15 px de haut mais **58 à 74 px de large**, dans une ligne de tableau — la cellule entière est cliquable en pratique et l'espacement vertical entre lignes (`padding: 12px`, `globals.css:659`) porte la zone utile bien au-delà de 15 px. Critère WCAG 2.5.8 : l'exception « espacement » s'applique. **Écarté**, avec réserve : la zone cliquable *déclarée* reste le texte seul.
- **Les liens inline dans une phrase** (« CC BY 4.0 », « Lire la méthodologie ») : le protocole le dit lui-même — un lien de 12–16 px dans un paragraphe n'a pas à faire 44 px. WCAG 2.5.8 exempte nommément les liens en flux de texte. **Écarté.**

**Ce qui reste comme vrai problème de cible tactile, après tri** — et c'est un ordre de grandeur plus petit que le chiffre brut :
- Les **6 pills de filtre** de `/emplois` et les **10 de `/entreprises`** : **34 px de haut** (`globals.css:231`), pour 80 à 121 px de large. Ce sont les contrôles principaux du produit sur mobile. §7 impose ≥ 44×44 et prévoit même le remède (« les boutons 36px reçoivent un padding tactile via `::before` sur mobile ») — ce `::before` n'existe nulle part dans `globals.css`. **Vrai défaut, MAJEUR par sa position dans le parcours.**
- Les **boutons `.btn` à 36 px** (`globals.css:144`) : « Charger plus de Maisons », « Voir les Maisons ». Même remède prévu, même absence. **Vrai défaut, mineur.**
- Les **11 entrées du menu mobile** à 16 px de haut : leur conteneur `li` est plus grand, mais la zone cliquable déclarée est le texte. **Vrai défaut, mineur.**

**FP2 — « `components/nav-progress.tsx:61` anime `width` » : réel, mais son coût est nul.**
Confirmé (`transitionDuration: 0.2s` sur `width`). Requalifié en MINEUR (P2) : l'élément est un trait `position:fixed` de 2 px sans enfant, donc le recalcul de layout ne touche aucun contenu.

**FP3 — « 158 à 1 811 éléments animent des propriétés de layout » : 404 sur 405 ont une durée nulle.**
Mon premier détecteur comptait `transition-property` sans lire `transition-duration`. Vérification ciblée sur `.maison__name` : `transitionProperty: "all"` mais `transitionDuration: "0s"`, et **aucune règle CSS auteur ne correspond** à l'élément. Le `all` est la valeur initiale calculée, pas une déclaration. Comptage rigoureux (propriété de layout **et** durée > 0) sur `/emplois` : **1 seul élément réel** (`.progress`) contre **404 à durée nulle**. **Écarté** — et c'est la mesure qui a corrigé mon propre outil.

**FP4 — « Texte blanc à 1:1 de contraste sur le hero » : artefact de mesure, pas un défaut.**
Ma première passe calculait le fond en remontant les `background-color` du DOM ; le hero étant une vidéo/image, elle remontait jusqu'au `body` blanc et concluait 1:1 sur 19 éléments. Ma deuxième passe, en échantillonnant les pixels rendus, se heurtait à l'anticrénelage des glyphes (fonds « mesurés » à 245,244,244). **Méthode retenue** : masquer tout le texte (`color: transparent`), capturer, puis lire le fond réel sous chaque boîte. Résultat : **pire cas 5,85:1**, tout passe. **Écarté** — trois méthodes ont été nécessaires pour ne pas graver un faux constat.

**FP5 — « 27 à 54 éléments tronqués au zoom 200 % ».**
Inspection des cas : `p.offer__preview` (clamp volontaire à 2 lignes, `globals.css:211-217`) et `span.sr-only` (texte réservé aux lecteurs d'écran, invisible par construction). Aucun contenu réellement perdu, 0 px de débordement horizontal. **Écarté.**

**FP6 — Mode sombre absent.** Hors périmètre par décision produit explicite. Non compté.

---

## Corrections, par rapport bénéfice / coût

### Rang 1 — Gain massif, coût très faible

1. **Ne pas servir le MP4 de 4,4 Mo au mobile ni sous `prefers-reduced-motion`.** (P1)
   Retirer `autoPlay`/la `<source>` par media query côté rendu, ou monter la `<video>` en JS uniquement si `min-width: 1024px` **et** `no-preference` de mouvement. Le poster (`landing-view.tsx:58`) fait déjà le repli. Gain : **−97,8 % du poids de `/` sur mobile** (4 522 ko → ~100 ko). Coût : quelques lignes dans `landing-view.tsx`. **C'est de loin le meilleur ratio du lot.**

2. **Corriger `.kpi__sub` sur fond sombre.** (A4)
   Ajouter une ligne à la série existante `globals.css:600-609` : `.intel-hero .kpi__sub { color: rgba(255,255,255,.7) }`. Passe de 3,70:1 à ~9:1. Coût : une ligne. Vraie correction d'accessibilité.

3. **Remonter la licence CC BY 4.0 à Loïc.** (I1)
   Aucune ligne de code à écrire : c'est une décision métier réservée par D38 et reprise sans arbitrage. Coût : une question. Enjeu : les conditions de réutilisation commerciale de l'observatoire.

4. **Donner aux pills et boutons la zone tactile que §7 prévoit déjà.** (FP1)
   Le remède est écrit dans la DA — le `::before` de padding tactile — et absent du CSS. Une règle sous `@media (max-width: 767px)` sur `.pill` et `.btn` porte 34/36 px à 44 px sans changer le rendu visuel. Coût : ~5 lignes. Touche les contrôles principaux du produit sur mobile.

### Rang 2 — Bon gain, coût modéré

5. **Ajouter un lien d'évitement.** (A1)
   Un `<a class="skip" href="#main">` visible au focus dans `app/layout.tsx`. Supprime 11 à 17 tabulations répétées à chaque page. Coût : ~10 lignes CSS + 1 ligne de markup.

6. **Baliser les blocs du panneau détail en `<h2>`.** (A2)
   `job-detail.tsx:93` et `:162` : remplacer les `<span className="t-caption green">` par `<h2 className="t-caption green">`. Rendu visuel **identique** (la classe porte toute la typographie), navigation par titres restaurée sur la page la plus lue. Coût : deux mots.

7. **Porter le focus sur le champ, pas seulement sur le groupe.** (A3)
   `globals.css:490` : remplacer `outline: 0` par un focus propre à l'`<input>` (par exemple `outline: 2px solid var(--fa-green); outline-offset: -2px`), en gardant le `:focus-within` du conteneur. Lève la violation littérale de §7 et distingue les deux champs. Coût : une ligne.

### Rang 3 — À arbitrer, coût réel

8. **Aligner les ruptures du header sur §6.** (R1)
   Deux changements : passer le burger de `lg:` (1024) à `md:` (768) dans `site-nav.tsx:102,109`, et redéfinir `--header-h: 64px` sous 768 px. Gain mobile net : **50 px de hauteur d'écran rendus à la liste d'offres** (13,5 % → 7,6 % sur iPhone 13). Coût : un test de non-régression visuel sur toute la plage 768–1023, car `.page`, `.searchbar` et `.detail` calculent tous leur position sur `--header-h`. **À faire, mais pas à l'aveugle.**

9. **Redimensionner les logos servis par `/api/logo`.** (I3)
   Plafonner à 112 px (2× l'affichage de 56 px). Gain : bande passante seulement, aucun effet CWV mesuré. Coût : une transformation côté route API.

10. **`.progress` en `transform: scaleX()` plutôt qu'en `width`.** (P2)
    Correction de principe. Gain réel proche de zéro (trait de 2 px sans enfant). À faire quand on touchera le fichier, pas avant.

### Explicitement NON recommandé

- **Ne pas « corriger » les 93 pays de la carte ni les 116 liens de tableau** pour atteindre 44 px : la carte cesserait d'être une carte, le tableau doublerait de hauteur, et l'alternative accessible existe déjà (tableau des mêmes données, liens nommés, focalisables). Poursuivre le chiffre brut de 258 dégraderait le produit.
- **Ne pas retirer le `prefers-reduced-motion` global** (I2) : il vient de `design_2.md` §2.7, les contenus révélés au scroll restent visibles et la vidéo a un vrai repli. Le remplacer par des alternatives par composant est un chantier disproportionné au regard du gain.

---

## Note de méthode

Trois constats de ce rapport ont dû être **mesurés trois fois** avant d'être écrits, et deux d'entre eux ont invalidé mon propre outillage :

1. Le contraste du texte blanc sur le hero (FP4) : la mesure par remontée du DOM donnait 1:1, la mesure par pixels bruts donnait 1,09:1 (anticrénelage) ; seule la mesure « texte masqué » a donné la vérité — **5,85:1, conforme**. Deux méthodes sur trois auraient gravé un faux critique.
2. Les transitions de layout (FP3) : 405 éléments signalés, **1 réel**. Le détecteur lisait `transition-property` sans lire `transition-duration`.
3. Le nombre de cibles tactiles : 258 annoncées sur `/geographies`, **13 réelles** après tri par nature.

Conformément à la règle zéro, chaque chiffre de ce document provient d'une exécution sur `https://modecareers.com` — jamais d'un résumé, jamais d'une lecture de code seule. Là où une mesure a échoué, elle est signalée comme telle. Les scripts jetables ont été supprimés.
