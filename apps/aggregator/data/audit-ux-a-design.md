# Évaluation A — Revue de design UX, Mode Careers

> Direction artistique · 2026-09-07
> Référence de jugement : `design_2.md` v1.0 (« Corporate Elegance »), gravée D17 dans `CLAUDE.md`.
> Preuves : captures desktop 1440 / mobile iPhone 13 (`scratchpad/audit-ux/`), lecture du code, mesures `curl` sur modecareers.com exécutées le 2026-09-07.

---

## ⚠️ Avertissement de méthode : le brief de mission contredit la DA

Le brief qui m'a été transmis énonce comme « invariants NON NÉGOCIABLES » :
« monochrome strict », « UNE SEULE GRAISSE 400 », « titres de poste en CAPITALES », « pastilles rayon 100vmax ».

**Trois de ces quatre affirmations sont l'inverse de ce que `design_2.md` prescrit.** Vérifié à la source :

| Affirmation du brief | Ce que dit réellement `design_2.md` |
|---|---|
| « monochrome strict, le vert est le seul accent » | La DA a **un accent chromatique assumé** : `--fa-green #105A33`, avec 6 usages listés (§2.1 l.112-114). Le « monochrome » était le **site AVANT** la refonte (§0.1), décrit comme une **faiblesse** (« ressemble à un template SaaS »). |
| « UNE SEULE GRAISSE 400 » | La DA impose **deux familles** (serif display + sans) et **plusieurs graisses** : `t3` en 600, `title` 600, `caption` 600, `ui-small` 500 (§2.3). « Une graisse unique » est listée comme **faiblesse de l'ancien site** (§0.1 l.28). |
| « titres de poste en CAPITALES » | §1 principe 6, l.63 : « Les titres d'offres **ne sont plus en capitales** ». Et §15 DON'T : « titres d'offres en capitales ». |
| « pastilles rayon 100vmax » | §1 principe 4 : « **Pas de pills.** » ; §15 DON'T : « pills ». Le rayon est **5px, unique**. |

**Conséquence** : j'ai jugé la fidélité à `design_2.md`, la source, et non au résumé. Un audit conduit sur le brief aurait déclaré « violation » tout ce que l'équipe a correctement implémenté, et « conforme » ce qu'elle a raté. **Point à trancher par Loïc** : si le brief reflète une intention plus récente que `design_2.md`, c'est la DA qu'il faut regraver — aujourd'hui le code suit `design_2.md`, fidèlement.

---

## 1. Verdict de spécificité — le critère jugé avant tout le reste

**Verdict : SPÉCIFIQUE. C'est la vraie réussite de ce site.**

La question posée est : « un produit sans rapport pourrait-il réutiliser cette composition telle quelle ? » Réponse : **non**, et pour des raisons structurelles, pas décoratives.

Ce qui est intransférable :

1. **Le couple serif/sans porte une thèse métier.** Le serif dit *le contenu* (le titre du poste, le nom de la Maison, le chiffre), le sans dit *l'interface*. Sur `desktop-emplois.png`, « Women's Senior Sales Professional » en serif face à « Rechercher » en sans : la typographie **classe l'information par nature**, pas par importance. Un SaaS générique ne peut pas emprunter ça sans emprunter la thèse.
2. **Le filet pointillé à la place de la carte.** Sur `desktop-entreprises.png`, les 9 Maisons ne sont pas 9 boîtes : ce sont 9 cellules séparées par un filet 4px×1px. Le résultat est un **annuaire éditorial**, pas une grille de cartes SaaS. C'est la signature la plus reconnaissable du site.
3. **La carte du monde (`desktop-intel-geo.png`)** en séquentiel une-teinte, sans légende colorée, Antarctique retirée. Elle ne ressemble à aucun dashboard analytics du marché — ceux-ci utilisent tous des échelles bleu/rouge divergentes.
4. **Le hero de `/intelligence`** : vert-nuit, serif 4.5rem, KPI en chiffres serif blancs sur filets pointillés atténués. Aucun observatoire de marché ne ressemble à ça (ils ressemblent tous à Tableau).

**Réserve, et elle est sérieuse** : la spécificité est **empruntée à Lacoste corporate**, pas inventée pour Mode Careers. `design_2.md` l'assume (§0.2, §0.3) et se protège juridiquement (aucun signe de marque). Le langage est cohérent et de haut niveau — mais il ne dit encore rien de *mode/luxe/beauté* en propre. Le seul élément qui pourrait porter cette spécificité sectorielle est la photographie (§8) — et c'est précisément là que ça casse (voir CRITIQUE-2).

**Note de spécificité : 8/10.** Très au-dessus du marché des jobboards. Perd 2 points parce que l'identité est portée par une grammaire empruntée et que le seul levier sectoriel propre (la photo) est raté.

---

## 2. Les 10 heuristiques de Nielsen

Notation 0-4. Le mode Operate (parcours candidat) et le mode Read (Intelligence) sont notés séparément quand ils divergent.

| # | Heuristique | Operate | Read | Justification (preuve) |
|---|---|---|---|---|
| 1 | Visibilité de l'état du système | **3** | **4** | Operate : compteur « 70 131 OFFRES » toujours visible, offre sélectionnée marquée par bordure gauche + fond (`globals.css:502`). Manque : aucun état de chargement visible entre deux offres. Read : exemplaire — chaque bloc porte `FAIT OBSERVÉ` / `MÉTRIQUE DÉRIVÉE` et sa date de disponibilité. |
| 2 | Correspondance système / monde réel | **4** | **3** | « Maison » et non « entreprise », « offre » et non « job » (§9 respecté, visible sur toutes les captures). Read perd un point : « Hiring Momentum · 0-100 », « Global Hiring Pulse », « Taux de repost » sont du jargon d'analyste sur un site par ailleurs francophone. |
| 3 | Contrôle et liberté | **3** | **3** | Fil d'Ariane présent (`desktop-offre.png` : « ← Toutes les offres »). Filtres effaçables. Manque : pas de « Réinitialiser » visible tant qu'aucun filtre n'est actif — conforme à la DA (§4.3) mais le retour arrière après 3 filtres reste coûteux. |
| 4 | Cohérence et standards | **4** | **4** | Remarquable. Le même `JobDetail` sert `/emplois` et `/offre` (commenté `page.tsx:132-134` : « une seule identité visuelle pour une offre »). Tokens centralisés, aucune dérive constatée entre les 9 captures. |
| 5 | Prévention des erreurs | **3** | **3** | Peu de saisie donc peu d'erreurs possibles. Les liens morts sont traités en amont (D23/A5). Non mesuré : le comportement d'un filtre menant à 0 résultat combiné. |
| 6 | Reconnaissance plutôt que rappel | **2** | **3** | **Faiblesse d'Operate.** Sur `desktop-emplois.png`, les 6 pills de filtre sont **muettes** : « Pays », « Secteur », « Contrat », « Ville », « Maison », « Groupe » — aucune ne montre sa valeur ni son volume avant ouverture. Le candidat doit ouvrir chaque menu pour savoir ce qu'il contient. La DA prévoit pourtant des compteurs (§4.3 : « France · 6 870 »). |
| 7 | Flexibilité et efficacité | **3** | **2** | Operate : split-view + sélection auto de la 1re offre = efficace. Read : **aucun tri, aucun filtre, aucun export** sur les tableaux (`desktop-intel-metiers.png`) — un analyste ne peut pas réordonner « Les 25 fonctions » par part ni par nouvelles. |
| 8 | Esthétique et sobriété | **4** | **4** | Le point le plus fort du site. Aucune ombre, aucun dégradé, aucune illustration, densité maîtrisée. Conforme §15 DO. |
| 9 | Aide au diagnostic d'erreur | **3** | **n/a** | État vide vérifié en prod : « Aucune offre ne correspond, pour l'instant. » — phrase juste, ton juste (mesuré par `curl` sur `/emplois?q=zzzzqqqxyz`). Pas d'erreur serveur observée. |
| 10 | Aide et documentation | **2** | **4** | Read : `/intelligence/methodologie` est un modèle du genre (`desktop-intel-methodo.png`) — fréquence, déduplication, employeur/groupe, lieu, tout est expliqué. Operate : **rien**. Aucune explication de ce qu'est le « Matching », ni d'où viennent les offres, sur le parcours candidat. |

**Moyenne Operate : 3,1 / 4** · **Moyenne Read : 3,3 / 4** (heuristique 9 exclue du calcul Read).

---

## 3. Défauts classés

### CRITIQUE

---

**CRIT-1 — `/intelligence/metiers` : la colonne « Nouvelles · 30 j » affiche exactement la colonne « Demande ». Un observatoire qui publie un faux.**

*Nature : défaut de vérité produit (pas un écart à la DA).*

**Preuve.** Sur `desktop-intel-metiers.png` : Conseil de vente `24 995` / `24 995` · Conseil beauté `10 425` / `10 425` · Direction de boutique `8 101` / `8 101` · Opérations boutique `4 683` / `4 683`. Quatre lignes sur quatre, égalité parfaite.

Mesure exécutée en prod le 2026-09-07 :
```
curl -s "https://modecareers.com/intelligence/metiers" | grep -o 'class="num"[^<]*>[0-9 ]*<'
→ 979 / 979 · 854 / 854 · 849 / 849 · 762 / 762 · 734 / 734 · 671 / 671 · 512 / 512 …
```
**Dix lignes sur dix.** Ce n'est pas un hasard d'affichage.

**Cause racine, lue à la source.** `lib/intelligence/facts.ts:114` :
```sql
count(*) FILTER (WHERE j."firstSeenAt" >= now() - interval '30 days')
```
Le filtre est correct. Mais **aucune offre en base n'a un `firstSeenAt` de plus de 30 jours** — le catalogue a été consolidé le 2026-09-06 (cf. D38 : `OBSERVATION_START = 2026-09-07`). Le filtre matche donc 100 % des lignes.

**Pourquoi c'est CRITIQUE et non MAJEUR.** Le site affiche `FAIT OBSERVÉ` au-dessus de ce tableau (`metiers/page.tsx:34`, `level="fact"`). Toute la crédibilité de Catwalks Intelligence repose sur la discipline FACT/DERIVED et sur le fait que les KPI disent honnêtement « disponible à partir du 7 oct. 2026 » quand ils ne savent pas. **Ce tableau trahit cette discipline sur la page la plus consultable de l'observatoire.** Un journaliste ou un concurrent qui repère l'égalité conclut que les chiffres du site sont fabriqués — et il aura raison sur celui-là.

**Correction.** Appliquer à cette colonne la règle déjà écrite ailleurs dans le produit : tant que `OBSERVATION_START + 30 j` n'est pas atteint, afficher `disponible à partir du 7 oct. 2026` (le même composant `NA` que `desktop-intel-marche.png` utilise déjà pour « NOUVELLES · 30 J »). Le code du garde-fou **existe déjà** — il n'est simplement pas branché sur ce tableau. Correction de quelques lignes dans `app/intelligence/metiers/page.tsx:56` et `:67`.

---

**CRIT-2 — Le hero de l'accueil est une photo floue illisible. Le seul levier d'identité sectorielle du site est gâché.**

*Nature : écart à la DA (§8) ET défaut d'ergonomie.*

**Preuve.** `desktop-accueil.png` et `mobile-accueil.png` : le fond du hero est une image abstraite, brune/verte, en flou de mouvement. **Aucun sujet n'est identifiable.** On ne sait pas si on regarde un tissu, une vitrine, un néon ou un artefact de compression.

**L'écart à la DA est explicite.** `design_2.md` §8 l.555 : « Sujets : **matières, gestes d'atelier, vitrines, architecture de boutique, plans larges de bureaux de création**. Palette naturelle, lumière du jour, légère désaturation (−10 %) ». §1 principe 7 l.64 : « **La photo est le seul décor.** » Une photo qui ne montre rien n'est pas un décor : c'est une texture.

**Pourquoi CRITIQUE.** C'est le premier écran du produit, et c'est le **seul endroit de tout le site** où l'identité *mode/luxe/beauté* peut s'exprimer visuellement (la DA interdit illustrations, dégradés, motifs — §1 principe 7). Aujourd'hui, un visiteur qui arrive sur l'accueil ne reçoit **aucun signal sectoriel** : sans le mot « MODE · LUXE · BEAUTÉ » en surtitre, ce hero pourrait être celui d'un fournisseur d'énergie. La réserve du §1 (« la spécificité est empruntée à Lacoste ») se paie exactement ici.

Effet secondaire mesurable sur `mobile-accueil.png` : les zones claires de la photo passent sous le texte blanc du paragraphe (« Le moteur de recherche des carrières… ») — le contraste y est visiblement inférieur au 4.5:1 exigé §7 l.543, qui prescrit d'augmenter le voile à `.5` dans ce cas. Le voile actuel est à `.42` (`globals.css:60`).

**Correction.** Deux actions distinctes :
1. **Remplacer la photo** par un sujet lisible conforme §8 (geste d'atelier, matière, vitrine). C'est une décision d'achat/licence → **arbitrage Loïc**, comme §8 l.559 l'impose (« photos propres à Catwalks ou banques libres de droits »).
2. **Porter le voile à `.5`** sur mobile (`--fa-veil`, `globals.css:60`) — correction immédiate, indépendante de la photo.

---

### MAJEUR

---

**MAJ-1 — `/offre/[id]` : la page SEO ignore la mise en page prescrite et laisse la moitié droite de l'écran vide.**

*Nature : écart à la DA (§5.3).*

**Preuve.** `desktop-offre.png` : tout le contenu (titre, CTA, détails, description) est contraint dans la moitié gauche ; la moitié droite est **entièrement blanche** sur toute la hauteur. Cause lue à la source : `app/offre/[id]/page.tsx:142` → `className="has-apply-bar max-w-[720px]"`.

**Ce que la DA prescrit** (§5.3 l.496) : « Panneau détail sur **8 col** (col 1-8), **colonne latérale 4 col** (col 9-12) avec : bloc Maison (logo, nom `display-2`, secteur, « 1 397 offres ouvertes → »), bloc « Alerte » (champ e-mail + `btn-outline-green`). »

**Pourquoi MAJEUR et pas mineur.** Ce n'est pas qu'esthétique : `/offre/[id]` est **la page d'atterrissage SEO** du produit (D14 : « Fashion Atlas owns the search »). Un visiteur Google arrive ici. La colonne latérale prévue par la DA porte exactement les deux ponts de rétention : « voir les autres offres de cette Maison » et « créer une alerte ». Les supprimer, c'est transformer la page d'atterrissage en **cul-de-sac** : le candidat lit, clique « Voir l'offre chez Ralph Lauren », et quitte définitivement le site. Le levier de conversion vers Catwalks (D18) est amputé de son support le plus naturel.

**Correction.** Implémenter §5.3 : passer le contenu en 8 colonnes, ajouter la colonne latérale 4 col (bloc Maison + bloc Alerte). Le composant `CompanyProfile` et les compteurs par Maison existent déjà (visibles sur `desktop-entreprises.png`).

---

**MAJ-2 — Mobile : le CTA « Matcher avec Catwalks » est placé AU-DESSUS de « Voir l'offre ». L'ordre inverse l'intention du candidat.**

*Nature : défaut d'ergonomie et de parcours émotionnel.*

**Preuve.** `mobile-offre.png` : la barre fixe basse affiche, dans cet ordre : **1.** « Matcher mon profil avec Catwalks » (bouton plein, vert-nuit) **2.** « Voir l'offre chez Ralph Lauren » (bouton outline). Code : `app/offre/[id]/page.tsx:148-158`.

**Pourquoi c'est un défaut.** Le candidat est arrivé sur cette page depuis Google **pour postuler chez Ralph Lauren**. C'est son intention déclarée. Le bouton qui la sert est le second, et il est visuellement le plus faible. Le premier bouton, dominant, l'emmène **hors du site, vers un autre produit**, pour une action qu'il n'a pas demandée.

D18 a explicitement tranché que le double bouton devait être **honnête** : « Le message ne promet jamais de transmettre à l'employeur ». La hiérarchie visuelle actuelle ne ment pas dans les mots, mais elle **détourne l'intention par la mise en page** — ce qui est le même problème sous une autre forme. Sur mobile, où la barre fixe est le seul point d'action visible, l'effet est maximal.

À noter : sur desktop (`desktop-offre.png`) le même ordre existe mais les deux boutons sont **côte à côte**, donc simultanément accessibles — le défaut y est mineur. **C'est spécifiquement l'empilement mobile qui pose problème.**

**Correction.** Sur mobile, inverser : « Voir l'offre chez [Maison] » en bouton primaire en premier, « Matcher mon profil » en second, outline. Le pont Catwalks reste présent et visible — il cesse d'être le chemin par défaut. **Cet arbitrage touche le modèle économique (D14/D18) : à valider par Loïc**, avec l'argument suivant — un candidat qui postule et réussit revient ; un candidat détourné avant de postuler ne revient pas.

---

**MAJ-3 — Mobile `/emplois` : 6 pills de filtre au lieu du bouton unique prescrit, et un vide de ~180 px sous le header.**

*Nature : écart à la DA (§4.3) + défaut d'ergonomie.*

**Preuve.** `mobile-emplois.png` : six pills sur deux rangées (« Pays / Secteur / Contrat » puis « Ville / Maison / Groupe »), occupant environ 150 px de hauteur. Au-dessus, entre le filet du header et la barre de recherche, **un vide blanc d'environ 180 px** sans aucun contenu.

**Ce que la DA prescrit** (§4.3 l.321) : « Mobile : **un seul bouton “Filtres (2)”** avec icône `sliders-horizontal` ouvrant un panneau plein écran (bottom sheet sans arrondi), sections avec titres `caption` et filets pointillés. »

**Impact ergonomique cumulé.** Sur un iPhone 13, entre le vide de 180 px et les 150 px de pills, **la première offre commence à ~970 px** — soit plus d'un écran et demi de défilement avant de voir un seul résultat. Sur un moteur de recherche, où la scanabilité prime (mode Operate), c'est le défaut de densité le plus coûteux du site. S'y ajoute le point 6 de Nielsen : ces 6 pills muettes forcent le candidat à en ouvrir plusieurs pour comprendre ce qu'elles offrent — six points de décision, là où la charge cognitive recommande d'en montrer au plus quatre.

**Correction.** (a) Implémenter §4.3 mobile : un bouton « Filtres (n) » + bottom sheet. (b) Supprimer le vide — vérifier le cumul `.page { padding-top: var(--header-h) }` (`globals.css:389`, réservé pour 114 px) avec le header mobile qui ne fait que 64 px (§6) : la réserve semble ne pas être ajustée au point de rupture.

---

**MAJ-4 — Les données affichées trahissent la qualité du design : villes fausses, descriptions dupliquées, tableau « Détails » quasi vide.**

*Nature : défaut de données, visible dans l'UI — donc défaut de design perçu.*

**Preuve, sur `desktop-emplois.png` seul, sans chercher :**
- **« Commerce »** affiché comme ville de « Warehouse Supervisor ». Ce n'est pas une ville. (« Central Valley » sur la carte suivante est également douteux.)
- **Trois offres consécutives** (Women's Senior Sales Professional, Warehouse Supervisor, Warehouse Associate) affichent **exactement le même texte d'aperçu** : « COMPANY DESCRIPTION Ralph Lauren Corporation (NYSE:RL) is a global leader in the design, marketing and distribution of… ». L'aperçu de 2 lignes (`globals.css:211`) ne montre que le boilerplate corporate, **jamais le poste**. La liste devient illisible : trois offres différentes se ressemblent trait pour trait.
- **Le tableau « DÉTAILS DE L'EMPLOI » ne contient qu'une seule ligne** (« Lieu »). Ni contrat, ni temps de travail, ni département — alors que la DA (§4.7) en prévoit quatre et que le `.kv` est conçu pour des lignes séparées par filets. Un tableau à une ligne est un tableau raté.

**Pourquoi MAJEUR.** Le design est ici **meilleur que la donnée qu'il sert**, et c'est le design qui en porte le blâme aux yeux du candidat. Le split-view a été conçu pour comparer trois offres d'un coup d'œil ; quand les trois affichent le même paragraphe, la promesse du split-view s'effondre. C'est le défaut qui dégrade le plus l'expérience réelle, quoique sa correction soit côté pipeline.

**Correction.** (a) Aperçu de carte : sauter le bloc « COMPANY DESCRIPTION » et démarrer l'extrait à la première section propre au poste. (b) « Commerce » : passer par le filtre `villes-non-lieux.csv` déjà en place (D37 lot 4). (c) Remplir le `.kv` : le contrat et le temps de travail existent en base pour Ralph Lauren (D37 lot 2 : Foot Locker contrat 26 → 2 779) — vérifier pourquoi ils ne sont pas rendus.

---

**MAJ-5 — `/intelligence/marche` : 6 KPI sur 8 disent « disponible à partir du… ». Une page à 75 % vide.**

*Nature : défaut de parcours émotionnel / d'architecture de l'information.*

**Preuve.** `desktop-intel-marche.png` : sur 8 tuiles, **6 affichent « disponible à partir du 14 sept. / 7 oct. / 13 sept. 2026 »**. Seules « Offres actives » (70 131) et « Maisons qui recrutent » (1 099) portent un chiffre — et ce sont les deux mêmes que la page `/intelligence` affiche déjà juste avant. Idem `desktop-intel-home.png` : 4 tuiles vides sur 8.

Deux tuiles qui portent un chiffre le rendent d'ailleurs suspect : « Durée médiane de publication : **1 j** » et « Taux de repost : **0,0 %** » — mécaniquement produits par la même absence d'historique que CRIT-1, et présentés eux comme des faits.

**Pourquoi MAJEUR.** L'honnêteté du dispositif (« n/d plutôt qu'un faux chiffre ») est **excellente et doit être conservée** — c'est D38 appliqué correctement. Le défaut n'est pas l'honnêteté : **c'est d'avoir publié la page avant qu'elle ait quelque chose à dire.** Règle du pic-fin : un visiteur qui découvre « Global Hiring Pulse » et rencontre six « disponible plus tard » repart avec l'impression d'un produit inachevé — et ne reviendra probablement pas le 7 octobre vérifier.

**Correction.** Deux options, à trancher par Loïc :
- (a) **Dépublier `/intelligence/marche` jusqu'au 7 octobre 2026** (la retirer de `intel-nav`), en gardant les pages qui ont de la matière : `/geographies`, `/metiers`, `/secteurs`, `/methodologie`.
- (b) La garder mais **remplacer les 6 tuiles vides par un seul bloc explicatif** assumé (« L'observation quotidienne a commencé le 7 septembre 2026. Ces indicateurs s'ouvriront à partir du 7 octobre. »), au lieu de six répétitions de la même absence.

Ma recommandation : **(a)**. Une page absente ne déçoit personne ; une page vide déçoit chaque visiteur.

---

### MINEUR

---

**MIN-1 — Logos couleur dans un système monochrome.**
`desktop-entreprises.png` : le logo Ulta Beauty est un aplat **orange vif**, seul élément saturé de toute la page ; il capte l'œil avant le nom de n'importe quelle Maison. Idem le bleu Ralph Lauren (`desktop-emplois.png`). La DA (§8 l.557) autorise les logos avec bordure 1px mais construit toute sa palette sur 5 couleurs. **Correction possible** : désaturation à −60 % au repos, couleur restituée au survol — la Maison reste identifiable, la page reste monochrome. À arbitrer : certains diront que le logo doit rester fidèle.

**MIN-2 — Dix chips de catégorie sur `/entreprises`.**
`desktop-entreprises.png` : Toutes · Retail · Beauté · Mode · Joaillerie · Luxe · Cabinets · Fournisseurs · Médias · Hors référentiel = **10 options** sur deux rangées, à un point de décision unique. Au-delà de 4-5, le balayage devient une lecture. « Hors référentiel · 15 » et « Médias · 40 » exposent surtout du vocabulaire interne. **Correction** : garder les 5-6 premières, replier le reste sous « Plus ▾ ».

**MIN-3 — Colonnes qui se touchent dans le tableau Métiers.**
`desktop-intel-metiers.png` : « 24 995États-Unis · France » — la valeur numérique et le libellé du pays sont **collés**, sans espace. Le `.itable td.num` (`globals.css:658`) pose `padding-right: 0` sur les colonnes numériques ; quand la colonne suivante est textuelle, rien ne les sépare. **Correction** : rétablir un padding droit sur `td.num` lorsque la cellule suivante n'est pas numérique.

**MIN-4 — Jargon analyste non traduit.**
« Global Hiring Pulse », « Hiring Momentum · 0-100 », « Catwalks Global Hiring Index », « Taux de repost » (`desktop-intel-marche.png`, `desktop-intel-home.png`). §9 impose « phrases courtes, sentence case » et un vocabulaire métier français (« Maison », « offre »). L'observatoire bascule en anglais d'analyste sans nécessité. **Correction** : franciser les libellés visibles, garder les noms propres d'indices si Loïc y tient commercialement.

**MIN-5 — L'animation au scroll contredit la DA.**
`globals.css:562-576` : `.anim-ready [data-stagger-index]` fait apparaître les éléments en `translateY(20px)` avec délais échelonnés jusqu'à 675 ms. `design_2.md` §2.7 l.262 : « **Aucune animation d'entrée au scroll** (pas de fade-in des sections). Le contenu est là. » ; §15 DON'T : « animations au scroll ». L'implémentation est propre (dégradation sans JS, `prefers-reduced-motion` respecté `globals.css:578`) mais l'écart à la DA est net. **Correction** : retirer, ou regraver la DA si l'effet est voulu.

---

## 4. Ce qui est BIEN — et qu'il faut protéger

Ces points ne sont pas des consolations : ce sont des acquis fragiles qu'une refonte hâtive détruirait.

1. **La discipline FACT / DERIVED / n-d est le meilleur choix produit du site.** Afficher « disponible à partir du 7 oct. 2026 » plutôt qu'un chiffre reconstruit, sur un produit dont l'argument est la mesure, est un acte de rigueur rare. CRIT-1 est grave **précisément parce que** cette discipline est excellente partout ailleurs.

2. **La cohérence d'implémentation est remarquable.** Le même `JobDetail` sert `/emplois` et `/offre` (`page.tsx:132-134`). Les tokens sont centralisés et le pont shadcn (`globals.css:78-109`) neutralise les défauts hérités : tous les `--radius-*` pointent sur 5px (`:340-346`), toutes les `--shadow-*` sur `none` (`:349-350`). Personne ne peut réintroduire une ombre ou un arrondi par accident. C'est de l'ingénierie de design system, pas du placage.

3. **Les commentaires du CSS sont un actif d'équipe.** `globals.css:10-12` (l'interdiction de la séquence étoile-slash, avec la panne qu'elle a causée), `:133-137` (pourquoi le padding 1px du filet n'est pas décoratif, avec sa mesure datée), `:477-478` (pourquoi pas d'`overflow:hidden` sur `.search`), `:481-483` (pourquoi bordure 0 et non transparente). Chaque décision non évidente porte sa raison et son incident. À conserver absolument.

4. **La page Maisons est la meilleure page du site en mode Operate.** `desktop-entreprises.png` : hiérarchie limpide (nom serif → secteur caption → chiffre serif → villes muted), filets à la place des boîtes, densité juste. C'est exactement §4.8, et ça fonctionne.

5. **La carte du monde et la page Méthodologie portent la crédibilité de l'observatoire.** La carte (`desktop-intel-geo.png`) est le seul élément visuellement inimitable du produit. La méthodologie (`desktop-intel-methodo.png`) répond aux quatre questions qu'un professionnel se pose (fréquence, déduplication, employeur/groupe, lieu) — c'est ce qui sépare un observatoire d'un blog de chiffres.

6. **L'état vide est juste.** « Aucune offre ne correspond, **pour l'instant.** » — vérifié en prod. Le « pour l'instant » fait le travail : il transforme un échec en attente. Conforme §4.13.

7. **La typographie fait son travail de classement.** Serif = contenu, sans = interface, tenu sur les 9 captures sans une seule exception constatée.

---

## 5. Les 5 corrections les plus rentables, ordonnées

L'ordre combine gravité, coût et effet sur la promesse produit.

| # | Correction | Gravité | Coût estimé | Pourquoi en premier |
|---|---|---|---|---|
| **1** | **Neutraliser la colonne « Nouvelles · 30 j » de `/intelligence/metiers`** — afficher `disponible à partir du 7 oct. 2026` via le composant `NA` déjà utilisé sur `/marche`. `app/intelligence/metiers/page.tsx:56` et `:67`. | CRITIQUE | Quelques lignes | Un chiffre faux sous une étiquette `FAIT OBSERVÉ` détruit la crédibilité de tout l'observatoire. Le garde-fou existe déjà : c'est la correction la moins chère du lot pour le risque le plus élevé. |
| **2** | **Corriger l'aperçu des cartes d'offre** (sauter le bloc « COMPANY DESCRIPTION ») **et le tableau `.kv` à une seule ligne.** | MAJEUR (MAJ-4) | Faible côté web, à tracer côté pipeline | C'est ce que le candidat voit en premier et le plus souvent. Trois offres identiques à l'écran annulent le bénéfice du split-view — le cœur du mode Operate. |
| **3** | **Mobile : bouton « Filtres (n) » + bottom sheet (§4.3), et suppression du vide de 180 px.** | MAJEUR (MAJ-3) | Moyen | Ramène la première offre au-dessus de la ligne de flottaison sur mobile. Aligne en même temps le produit sur la DA. Fort effet sur la scanabilité, sur la surface où le trafic SEO arrive. |
| **4** | **`/offre/[id]` : implémenter la colonne latérale 4 col (§5.3)** — bloc Maison + bloc Alerte ; retirer `max-w-[720px]` (`page.tsx:142`). | MAJEUR (MAJ-1) | Moyen | Transforme la page d'atterrissage SEO d'un cul-de-sac en carrefour. C'est la correction avec le meilleur effet sur la rétention et sur le maillage interne. |
| **5** | **Trancher le hero d'accueil** : voile à `.5` (immédiat, `globals.css:60`) **et** commander une photo conforme §8. | CRITIQUE (CRIT-2) | Voile : immédiat · Photo : décision Loïc | Placé en 5 parce que la moitié dépend d'un achat externe, pas parce que l'enjeu est moindre : c'est le seul endroit où le produit peut dire visuellement « mode, luxe, beauté ». Le voile se corrige aujourd'hui ; la photo demande un arbitrage. |

**Hors classement, à remonter à Loïc et non à corriger seul :**
- La **contradiction brief / `design_2.md`** signalée en tête de ce rapport. Tant qu'elle n'est pas tranchée, toute revue future repartira sur de mauvaises bases.
- **`/intelligence/marche`** : dépublier jusqu'au 7 octobre (MAJ-5) — décision de périmètre produit.
- **L'ordre des CTA mobile** (MAJ-2) — décision touchant le modèle économique D14/D18.

---

## Annexe — preuves et mesures exécutées

| Constat | Preuve |
|---|---|
| Égalité Demande / Nouvelles 30 j | `curl -s https://modecareers.com/intelligence/metiers` → 10 paires identiques (2026-09-07) |
| Cause racine de l'égalité | `lib/intelligence/facts.ts:114` (filtre `firstSeenAt >= now() - 30 days`) croisé avec D38 `OBSERVATION_START = 2026-09-07` |
| Largeur contrainte de `/offre` | `app/offre/[id]/page.tsx:142` → `max-w-[720px]` |
| Ordre des CTA mobile | `app/offre/[id]/page.tsx:148-158` |
| Voile photo à .42 | `app/globals.css:60` → `--fa-veil: rgba(0, 10, 5, .42)` ; §7 l.543 exige .5 si contraste < 4.5:1 |
| Animation au scroll | `app/globals.css:562-576` vs `design_2.md` §2.7 l.262 et §15 |
| État vide | `curl -s "https://modecareers.com/emplois?q=zzzzqqqxyz"` → « Aucune offre ne correspond, pour l'instant. » |
| Ombres et rayons neutralisés | `app/globals.css:340-350` |
| Titres d'offres non capitalisés (conforme) | `desktop-emplois.png` — « Women's Senior Sales Professional » en casse d'origine |

**Non mesuré, à ne pas conclure sans vérification** : contrastes exacts du texte sur photo (estimés à l'œil sur capture, non calculés) ; comportement au clavier et au lecteur d'écran ; performance / Core Web Vitals ; rendu sur Firefox et Safari ; états de survol et de focus (les captures sont statiques) ; comportement des dropdowns de filtre ouverts.
