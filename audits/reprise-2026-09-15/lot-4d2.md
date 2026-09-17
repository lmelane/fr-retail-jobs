# Lot 4D2 — JSON-LD historique, dates et texte Recruitee

**Validé localement. Aucun déploiement ni changement de stock distant. Ce sous-lot ne clôture pas la reprise historique.**

## Corrections

Le lecteur de récupération accepte désormais les formats conservés d’iCIMS, Altamira et Radancy. iCIMS et Altamira exigent un unique `JobPosting`, un identifiant natif extrait de l’URL, la concordance du portail et de la page enregistrée, ainsi qu’une empreinte HTML correctement formée. Une empreinte seule ne permet pas de reconstituer ni de vérifier le HTML disparu : la provenance reste `RETAINED_RAW`. Une ambiguïté de nœuds, un conflit géographique ou une URL contradictoire bloque la récupération. Altamira lie aussi l’identifiant d’équipe à l’URL et utilise désormais son échéance JSON-LD dans le lecteur d’expiration version 2.

Les champs du JSON-LD passent par le parseur déjà utilisé par la collecte. Radancy réutilise le même lecteur et la même identité d’URL que son adaptateur générique. Les textes visibles de page qui n’ont pas été conservés ne sont pas inventés.

Le lecteur Recruitee restitue les deux rubriques natives `description` et `requirements`. Sur les 542 champs `requirements` non vides du snapshot, **528 contiennent du texte utile**, intégralement restitué ; 14 ne contiennent que du balisage vide. Le [format de flux officiel Recruitee](https://docs.recruitee.com/docs/feed) distingue bien description et exigences dans le contenu de l’offre. Aucune traduction ou rubrique artificielle n’est ajoutée.

## Dates

- **WordPress :** `date_gmt` fournit la date de publication en GMT. La date locale `date` ne permet pas d’inférer un fuseau. Les 478 RAW portent la date GMT. Le comportement est vérifié sous trois fuseaux du worker. [Schéma officiel](https://developer.wordpress.org/rest-api/reference/posts/).
- **Greenhouse :** `first_published` est conservé ; le repli sur `updated_at` est supprimé. Les 2 545 RAW examinés portaient déjà le premier champ : cette correction évite un faux rajeunissement lorsqu’il manque, elle ne redéfinit pas les 2 545 dates du stock. [API officielle](https://docs.greenhouse.io/job-board.html).
- **Recruitee :** le lecteur utilise `published_at`, avec le suffixe UTC explicitement conservé dans le flux. Les 639 dates diffèrent des dates de création auparavant utilisées. L’[API publique](https://docs.recruitee.com/reference/offers) porte les offres publiées ; la distinction des champs et leur format UTC ont été contrôlés sur les RAW. La page publique AMI examinée déclare également le jour de publication dans son JSON-LD.

Un lecteur d’instant partagé refuse les timestamps sans fuseau, les jours calendaires invalides, les dépassements d’horloge et les valeurs hors stockage. Les dates inconnues restent inconnues. Ces corrections ciblées ne qualifient pas les dates de tous les autres adaptateurs.

## Rejeu du stock

Les **85 327 représentations** du snapshot sont relues hors ligne. **49 205** produisent une présentation valide, soit 130 de plus que le lot 4D1 : 21 iCIMS, 56 Altamira et 53 Radancy. Il reste **36 122 cas** à traiter. Ce compteur mesure la reconstruction depuis les données conservées, pas l’ouverture actuelle des offres ni la certification des employeurs.

Les **1 511 cas iCIMS restants avec texte** proviennent du hub URBN : la liste se trouve sur `hub-urbn.icims.com` et les fiches sur des sous-domaines de recrutement distincts. Le nœud JSON-LD et la page conservée désignent le même hôte et le même chemin ; leur paramètre d’iframe diffère. Le refus vient du périmètre de portail actuellement déclaré dans le catalogue. Ces cas exigent une validation explicite de la relation entre le hub et les portails de détail ; ils ne sont pas déclarés faux ni perdus.

La répétition locale reconstruit **66 publications réelles couvrant 22 familles**, avec leurs textes et dates propres, puis les relit via l’API. Aucun écart, aucun `CaptureBatch` créé et aucune actualisation des dates d’observation. Les groupes volontairement incorrects sont des témoins locaux. L’application de la CLI et sa réapplication idempotente passent, avec un plan en mode `0600` et aucune dérive du schéma.

## Validation et audit défensif

**2 953 tests réussis** : 2 236 unitaires agrégateur, 458 d’intégration, 254 API et 5 Python ; deux tests de corpus optionnels ignorés. TypeScript, build API et application des 55 migrations sur base vierge réussis. Aucune dérive de schéma. [Validation](preuves/lot-4d2-validation.json). Les onze contre-épreuves couvrent la perte du GMT, la substitution d’une date d’édition ou de création, la perte des exigences, le report d’un jour invalide, un détail ambigu, un mauvais type JSON-LD, un portail étranger, un autre poste, un conflit géographique et une échéance Altamira ignorée. Toutes déclenchent des échecs d’assertion et la restauration repasse au vert. [Contre-épreuves](preuves/lot-4d2-counterproofs.json).

Le premier passage complet a relevé un témoin d’expiration figé sur `readerVersion: 1`. Le comportement attendu de fermeture et les valeurs d’échéance étaient corrects ; le témoin vérifie désormais la version du lecteur effectivement publiée.

## Suite requise

Les formats restant non qualifiés doivent être distingués des pertes de données. L’inspection du code a déjà montré que certains anciens lecteurs conservaient la liste mais perdaient le texte récupéré ensuite : SmartRecruiters, WTTJ, CareerConnect et plusieurs variantes de pages HTML demandent une recollecte ou une autre capture native disponible. Une description conservée dans le groupe `Job` n’est jamais utilisée comme preuve de remplacement.

La validation des domaines de détail des portails multiples, les dates des autres lecteurs, la reprise des captures anciennes avec un nouveau lecteur, la migration du stock complet et les regroupements historiques restent des conditions de sortie. La recherche par pays et les filtres doivent encore remplacer les anciennes normalisations.

## Preuves

- [Corpus complet](preuves/lot-4d2-corpus.json) et [dates et exigences](preuves/lot-4d2-dates-content.json).
- [Reconstruction et lectures API](preuves/lot-4d2-shadow.json) et [CLI idempotente](preuves/lot-4d2-cli-smoke.json).
- [Préservation des 86 fichiers de travail initiaux](preuves/lot-4d2-preservation.json) : 85 identiques ; les trois scripts npm utilisateur restent préservés, avec les seuls changements du manifeste venant des lots précédents.
