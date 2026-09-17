# Lot F0 — preuves, release et travail local réconciliés

Bilan daté du **16 septembre 2026**, premier lot de la suite de mission (`INSTRUCTION-FINALISATION-LOCAL-CATALOGUE-2026-09-16.md`, non suivie par Git comme la passation).

## État retrouvé, vérifié

| Dépôt | Trouvé | Fait |
|---|---|---|
| A (`codex/production-foundations-20260915`) | HEAD `2974343` ; 3 fichiers du propriétaire modifiés, 25 non suivis + la passation + l’instruction ; **10 worktrees enregistrés** hérités de l’ère codex, 5 sans répertoire | métadonnées des 5 worktrees absents purgées (`git worktree prune`, aucun répertoire touché) ; les 4 vivants inventoriés : le checkout de vérification (détaché `9504c9f`, fichiers synchronisés), `lot4-source-validation` (détaché, propre), `catwalks-docs-worktree` (`codex/lot4-final-docs`, fusionnée), `catwalks-p10` (`p10-optique-pharmacie`, PR #160, 1 commit non repris) |
| W (`front-f1-sauvegarde`) | 50 modifiés, 16 non suivis ; 9 fichiers du propriétaire (pages légales, `next.config.mjs`) inchangés depuis le lot 0 | **commit local `9882894`** des 63 entrées de chantier (lots 6C à 9, validés au lot 9 : 69 fichiers / 752 témoins, `tsc`, `next build`) ; les 9 fichiers du propriétaire restent seuls non committés ; hook de typecheck passé |
| B (`main`) | 6 modifiés, 9 non suivis ; `DECISIONS.md`, migration D-425, script D-424 inchangés depuis le lot 0 ; `schema.prisma` mêle le hunk `anciensSlugs` du propriétaire et les hunks 6B | **commit local `45a9b23`** de 13 fichiers (outbox D-423, `country_code` D-435, `catalogue-public`, rattrapage, preuve, migration) avec `schema.prisma` filtré du hunk du propriétaire (`git apply --cached` d’un patch à 3 hunks) ; 3 fichiers / 24 témoins verts sur la base jetable backend encore vivante ; hook passé |
| BO (`main`, `75c594b`) | propre | rien |
| M (`main`, `a916ac2`) | 1 modifié, 3 non suivis (radar, patron d’article, rédactions), tous étrangers au lot 11 | rien, préservés |

Processus : seul le serveur API du propriétaire (port 3010) et le tunnel de la base de test écoutent ; conteneurs de test, du clone et Supabase `*_dix` intacts ; 4,5 Gio libres.

## Code commité, local, installé, déployé

- **Commité** : `c9b520b` (code et lock) puis documentation ; l’archive exacte de `c9b520b`, sans les trois fichiers Ba&sh du propriétaire, rend API 26 / 262, intégration 68 / 776, unitaire 2 607 / 2 611 avec **4 rouges de harnais** (`opsPaths.test.ts` exige un `.git`, absent d’un `git archive`) ; rejoués sur un clone partagé doté d’un `.git` : 7 / 7. **Le travail Ba&sh du propriétaire ne masque donc rien.**
- **Local** : les trois fichiers Ba&sh du propriétaire et ses 25 scripts, hors commit.
- **Installé dans le checkout de tests** : worktree détaché `9504c9f` dont les fichiers sont synchronisés depuis l’arbre de travail (donc avec Ba&sh propriétaire) ; c’est le runtime des suites de lots.
- **Déployé** : Railway `dd3e24d` sur quatre services, base à 44 migrations sur 77 (lu en lecture seule le 16/09).

## Release : affirmation corrigée

La version du matin déclarait les migrations additives et `dd3e24d` capable de relire la base migrée. **Réfuté** : dix des 33 migrations en attente sont destructrices pour cette révision (`SourceCursor`, `verifiedJobCount`, `robotsVerdict`/`robotsCheckedAt`, tables d’archive d’observation, clé étrangère `JobSource_jobId_fkey`, index, contraintes), et `git grep` sur `dd3e24d` retrouve leurs lecteurs. Le dossier de release porte désormais la stratégie de **base parallèle** (copie restaurée, migrée 44 → 77, servie par la nouvelle révision ; l’ancien couple image + base reste le retour arrière) et la répétition chronométrée reste due en F6.

## PR #160 et #168

- **#160** (taxonomie v2, optique et pharmacie, décision propriétaire du 14/09) : la reprise de `7cf74cf` s’applique sans conflit mais réécrit 7 545 lignes de JSON pour 51 lignes de sens ; **repris structurellement** dans le format de HEAD : identifiant `catwalks-occupations-20260914-v2` et bloc de revue, alias d’`optometrist`, `dispensing-optician`, `pharmacy-support-worker` (dont « Dispenser » et variantes → pharmacie, mesuré 306 / 306 en production), occupation et règle `optical-assistant`, témoins d’engine de la PR (Dispenser ≠ optique, assistant ≠ opticien ≠ optométriste, exemple d’ajout renommé). Témoins : `engine.test.ts` + `taxonomy.test.ts` 308 / 308. **Conséquence opérationnelle** : le manifeste change d’identifiant, donc la base cible devra passer par `occupation-preview` puis `occupation-activate` (reclassification), à inscrire au déroulé F6.
- **Correction (lot F1, même jour)** : la reprise n’avait été validée que par les témoins purs. La suite d’intégration, rejouée en F1, a montré que `pipeline/occupation.test.ts` exige la version embarquée comme ligne `OccupationRelease` de la base (seule la v1 y est insérée par migration, et la PR #160 ne portait aucune migration) et prenait « Optical Assistant » comme exemple d’ajout, désormais classé par la v2. Le témoin publie maintenant la version embarquée quand elle manque, exactement comme une activation, et prend « Gemstone Sorter » comme exemple en affirmant sa prémisse (`NO_RULE` sous la version active). Aucune migration d’insertion : l’activation crée elle-même la ligne.
- **#168** (lot 4A) : aucun fichier de témoin ; `employment.ts` déjà intégré, `facettes-marche.ts` disparu au lot 6, 29 lignes dépassées. Rien à reprendre.
- Aucune PR fermée, aucun merge, aucun push.

## Cartes remplacées par les décisions de la section 4

Indexation fermée jusqu’à bascule ; 410 jamais systématique ; `/offres` inchangée ; langues DE/IT/ES/NL/CN à terminer localement depuis les déclarations natives ; i18n distincte de la traduction d’annonces, cible `next-intl` ou alternative démontrée ; domaine conservé ; pause de collecte ≠ fermeture, fraîcheur mesurée par source ; vocabulaire de matching à sortir du runtime. La liste unique des écarts du dossier de release en tient compte ; seules restent externes les levées de restriction de production et l’activation du CRON.

## Limites

- Le retour arrière n’est **pas encore démontré** : la répétition sur copie (base parallèle, 33 migrations, comptes) est le premier objet de F6.
- Les commits locaux de W et B ne sont validés que par les suites déjà rejouées (lot 9 pour W, base jetable pour B) ; la stack locale de F2 les remettra sous test de bout en bout.
