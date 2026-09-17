# Lot F6 — Contrat d'identifiants canoniques étendu aux familles d'adaptateurs

Date : 2026-09-17. Suite directe de [5G3C](lot-5g3c.md), dont la section « Limites et
suite » nommait le reste : « déclarer le contrat canonique dans les 41 autres
familles ». Aucun push de production, aucune activation du CRON, aucune base
touchée.

## Pourquoi ce contrat existe

Le contrat autorise une source à **prouver l'absence** d'une offre, donc à la
fermer. L'asymétrie du risque commande la sévérité : un contrat déclaré à tort
ferme une offre **réellement ouverte** — le candidat ne la voit plus, la Maison
perd une candidature. Un contrat absent laisse seulement une offre morte visible
plus longtemps. Dans le doute, on ne déclare pas.

## Résultat mesuré

| | avant | après |
|---|---:|---:|
| familles déclarant le contrat | 5 / 44 | **28 / 44** |
| familles non qualifiables, motif établi | — | 16 |

Les cinq familles d'origine (Ashby, Workday, TalentRecruiter, DigitalRecruiters,
Teamtailor) sont inchangées. `wttjSector` déclare par **héritage** : il reprend les
preuves de chaque lecture `wttj` au lieu d'en fabriquer, et une seule organisation
aux lignes anonymes retire le droit d'attester pour le secteur entier.

## Les 16 refus, et leur raison

Aucun refus n'est un échec : c'est le contrat qui fait son travail.

- **Identifiant dérivé d'une URL** — iCIMS (`/jobs/(\d+)/` sur le href, et le champ
  « ID » natif diffère : `2026-31555` pour l'offre `31555`), Swatch Group, jobaffinity
  (dernier segment de l'URL de candidature), SuccessFactors en dialecte HTML,
  rivoliTypesense, Altamira, Eqwa, Avature.
- **Hash d'URL** — le lecteur JSON-LD générique : `externalId = sha1(pageUrl)`.
- **Aucune preuve d'énumération à compléter** — Greenhouse, Flatchr, Pinpoint,
  SmartRecruiters, geodirectory : identifiant natif disponible en principe, mais
  la preuve n'existe pas ; la construire de zéro sort du périmètre.
- **Hors nature** — `personioDetail` est un lecteur de fiche, pas d'énumération : il
  reçoit l'identifiant en argument au lieu de l'observer. FashionJobs ne rend
  jamais d'offre (source de découverte seule, décision du 11/09).

## Trois trous réels fermés au passage

L'invariant « tout identifiant observé doit avoir un devenir connu » a révélé des
lignes qui disparaissaient **silencieusement**, et des offres publiées sous une
identité instable :

- `talentsoft.ts:339` — item RSS sans `idOffre` ni référence : `RSS_ITEM_WITHOUT_NATIVE_ID`.
- `wttj.ts:288` — hit sans `reference` ni `slug`, que `externalId` rabattait sur
  **le titre** : `HIT_WITHOUT_NATIVE_ID`.
- `wordpress.ts:92` — billet sans `id`, rabattu sur `post.link` : `POST_WITHOUT_NATIVE_ID`.

Phenom, Rituals, TalentFunnel et Recruitee jetaient des lignes sans titre par un
`if (!job) continue` sans trace ; elles sont désormais des rejets nommés portant
leur identifiant.

Ces lignes ne sont plus publiées. Le choix est assumé : une identité tirée d'un
titre change à chaque reformulation de l'annonce et produit des doublons. Mesuré
sur les captures réelles du dépôt (`g6-wttj-diptyque.json`, `w1-wttj-sector.json`) :
**0 hit sur 3 serait refusé** — l'échantillon est petit, et ne prouve pas que le cas
n'arrive jamais.

## Le garde-fou, prouvé opérant

`canonicalAbsenceProofUsable` n'est pas décoratif. `refreshPlan.ts:180-186` refuse
l'éligibilité à trois étages : contrat non déclaré, contrat rompu, lignes
anonymes observées. Un ensemble canonique **vide** reste une preuve valide — un
board réellement vide, à terminaison démontrée, prouve que plus rien n'y est
publié.

Contre-épreuve exécutée : la branche des lignes anonymes neutralisée en
`else if (false)` fait passer au rouge le témoin « des lignes sans identifiant
rendent la source non recevable, même parcours complet ». Restauration vérifiée
par `git diff` vide, 43/43 verts.

## Preuves d'exécution

- **725 témoins verts sur 69 fichiers** (`apps/aggregator/src/ats`), contre 652
  avant le lot : 73 témoins ajoutés.
- **Chaque famille qualifiée porte un témoin prouvé ROUGE** par retrait temporaire
  de `canonicalIds`, puis restauré.
- **Types verts**, code de sortie vérifié explicitement — et le typecheck éprouvé
  par injection d'une erreur volontaire, pour écarter le piège du garde qui rend
  vert sur un dépôt à références de projet.
- `refreshPlan` : 43/43.

## Audit défensif

**Technique — GO.** Zéro CRITICAL, HIGH ou MEDIUM sur les 23 familles et le moteur
partagé. Vérifié famille par famille que le chemin d'identité de `canonicalIds` est
exactement celui d'`externalId`, et que l'identifiant entre dans la preuve AVANT
toute validation de titre. Contre-épreuves sur quatre familles (14 rouges sur 48),
restauration prouvée. Un point LOW informatif sur le dédoublonnage
cross-organisation de `wttjSector`, sans action requise : WTTJ borne
`reference`/`slug` par organisation.

Vérifié aussi : les 17 nouveaux motifs de rejet ne correspondent à aucun
`FAILURE_REASON` de `pipeline/rejectedRows.ts`, donc aucune source ne bascule à
tort en `DEGRADED` ou `BROKEN`.

**Réconciliation.** Les 16 familles refusées ne déclarent effectivement rien
(vérifié fichier par fichier) ; 28 + 16 = 44, le compte est complet. Aucun fichier
partagé n'a été modifié : le lot est confiné aux adaptateurs et à leurs témoins.

**Métier / produit — GO avec correctifs.** Aucun CRITICAL : aucun chemin ne ferme une
offre réellement ouverte. Les quatre modes de panne instruits échouent tous vers le
refus — pagination tronquée (`INCOMPLETE`, `LISTING_FETCH_FAILED`,
`PAGE_BUDGET_EXHAUSTED`), réponse vide légitime (exige un `declaredTotal` à zéro
explicite), limitation de débit (`TIMEOUT`, `CHALLENGED`, `BROKEN` n'attestent
jamais). Trois HIGH, dont deux corrigés dans ce lot :

**Jobylon, corrigé.** Le lot avait posé `termination: 'FULL_RESPONSE'` — une
terminaison **probante**, donc autorisant la fermeture — sur une pagination jamais
démontrée : la seule mesure connue porte sur un locataire de 27 offres, et
`declaredTotal` vaut `listing.length`, si bien que le contrôle de troncature compare
une valeur à elle-même et ne peut jamais se déclencher. Un locataire au-delà d'un
plafond éventuel aurait vu ses offres fermées alors qu'elles sont ouvertes.
Remplacée par `CLIENT_SIDE_LITERAL_READ`, non probante ; le contrat canonique reste
déclaré, seule la fin de parcours cesse d'être affirmée. Témoin prouvé rouge par
retour à `FULL_RESPONSE`.

**Contrats inertes, documentés et gardés.** Six familles — oraclehcm, wordpress,
workable, talentview, taleo, volcanic, plus wttjSector — ont reçu un contrat exact
alors que leur terminaison nominale est absente de `PROVING_TERMINATIONS`. Leur
contrat ne servira jamais : c'est du garde-fou livré sans appelant, et leur code a
toutes les apparences d'un adaptateur habilité. Le relevé
`DECLARED_BUT_NOT_PROVING` (`pipeline/refreshPlan.ts`) les nomme, et deux témoins
gardent l'écart : l'un vérifie qu'aucune de ces terminaisons n'autorise une
fermeture, l'autre que les deux ensembles restent disjoints — il passe au rouge si
une terminaison est promue sans que le relevé suive. Tous deux prouvés rouges par
promotion de `CURSOR_EXHAUSTED`.

**Ce qui n'est pas corrigé, et pourquoi.** Promouvoir une de ces six terminaisons
revient à décider qu'elle DÉMONTRE la fin d'un parcours : un arbitrage sur ce qui
fait preuve, qui appartient au propriétaire. L'ajouter sans cette démonstration
ouvrirait la fermeture d'offres ouvertes. À soumettre en décision.

**Deux points remontés, non tranchés ici.** La granularité du gel : une seule ligne
anonyme retire le droit d'attester pour la source entière, indéfiniment — conception
prudente et délibérée, mais son coût n'est pas instrumenté. Et le libellé opérateur
`cli.ts:159` parle de « broken sources » pour des familles dont la capacité est
simplement absente par conception, ce qui accuse la source à tort et rend l'alarme
permanente donc illisible.

## Changements de signature

Trois fonctions changent de forme, toutes absorbées :

- `fetchMagnetJobs` et `fetchWordpressJobs` rendent un `AdapterResult` au lieu d'un
  tableau — un tableau nu ne peut pas porter de preuve d'énumération. Seul appelant
  hors témoins : la table `ADAPTERS` d'`index.ts`, dont `normalizeAdapterResult`
  accepte déjà les deux formes (`index.ts:57`).
- `parseBashListing` rend trois champs de plus ; ses appelants ne déstructurent que
  `jobs` et `declaredTotal`.

`publication/recovery.ts`, chemin de reconstruction depuis le RAW, n'appelle que des
fonctions pures internes dont les signatures sont inchangées.

## Limites

- Les qualifications reposent sur **le code et les captures du dépôt**, pas sur une
  collecte en direct. Aucun réseau vers une source tierce pendant ce lot.
- Sur le stock actuel, aucune source n'a encore de capture attestante : déclarer le
  contrat ne ferme rien par lui-même. La re-qualification et la ré-ingestion admise
  de chaque source restent nécessaires, et le CRON demeure gelé
  (`PIPELINE_PAUSED=1` sur les trois workers, vérifié le 2026-09-17).
- Les 16 familles non qualifiables resteront non vérifiables pour l'absence même
  ré-ingérées. Leur nombre de sources et d'offres actives n'a pas été mesuré ici :
  **NON VÉRIFIÉ**, faute d'accès base en lecture dans ce lot.
