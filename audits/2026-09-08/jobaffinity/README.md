# Intersport et Blackstore : sources directes, contrôlées le 8 septembre 2026

**Livraison en production vérifiée le 8 septembre 2026 à 21:26 UTC.** PR27 fusionnée, commit applicatif `75f0ff5`, main `030a101`, quatre services Railway déployés. Deux sources activées, une nouvelle enseigne canonique (Blackstore), source Intersport existante conservée.

**+940 offres distinctes, dont +933 France. Totaux : 72 359 actives / 10 684 France.** 978 représentations, 38 rapprochements entre portails, zéro erreur d’ingestion. Les six anciennes offres Intersport (dont cinq actives), leurs RAW et leurs historiques sont identiques. Les 978 articles et cartes source sont identiques aux captures ; seule l’empreinte HTML globale du nouveau balayage diffère.


Les domaines officiels relient explicitement les deux portails fournis. Blackstore est une enseigne du groupe Intersport, confirmé par https://www.blackstore.fr/qui-sommes-nous/. Intersport existe déjà dans Catwalks avec un autre portail Teamtailor ; cette source supplémentaire ne le remplace pas. Blackstore possède sa propre identité canonique et le lien de groupe est conservé.

## Mesure avant import

- Portail Intersport : 993 lignes de liste, 993 articles détaillés récupérés par IDs. WordPress contient aussi des articles anciens : son total brut ne définit pas les offres actives.
- Blackstore : 54 lignes et articles détaillés.
- 41 liens JobAffinity communs, même identifiant, même titre, même ville et marque Blackstore. Total : 1 006 liens uniques.
- Vérification des 1 006 candidatures : 952 formulaires accessibles, 46 pages indiquant explicitement que le poste est fermé, 8 HTTP 404.
- Parmi les formulaires accessibles, 12 titres annoncent « modèle expiré » : contradiction conservée et publication suspendue, pas fermeture inventée.
- Quatre articles sans mission portent des titres de saisie tels que « azert » ; leurs candidatures renvoient 404.
- Intersport émet « Temps plein » sur les 993 cartes, y compris des titres « Temps partiel ». Ce défaut de template n'est pas transformé en horaire canonique certain.
- Certains codes postaux et coordonnées se contredisent. Deux points géographiques pour Thiais/Morteau sont aux États-Unis. Aucun pays n'est déduit du domaine `.fr`.

## Correctif et traçabilité

L'adaptateur JOBAFFINITY_WORDPRESS lit la liste complète sans filtre pays, exige les IDs uniques et le compteur, récupère chaque article de cette liste via l'API WordPress, et vérifie le lien JobAffinity du détail. Il examine chaque formulaire direct ; HTTP 403, timeout et réponse inconnue font échouer le balayage, pas disparaître les offres. Les appels sont bornés et passent par le contrôle HTTP commun. Une majorité de candidatures fermées exige une nouvelle revue, pour ne pas convertir une panne générale en clôture massive.

RAW conservé : carte et attributs, article WordPress complet, assertion du formulaire, preuves géographiques et provenance des champs. `date_gmt` est la publication du portail employeur ; ni la modification WordPress ni la première observation Catwalks ne la remplacent. Le titre actuel de l'ATS est privilégié, avec l'ancien titre conservé. Les identifiants de candidature empêchent de fusionner des réquisitions différentes simplement parce que titre et ville se ressemblent.

Les coordonnées et le code postal doivent concorder dans le référentiel communal gouvernemental. Si les coordonnées sont erronées, une concordance exacte ville/code postal peut prouver le pays, sans reprendre les coordonnées. Les localisations encore contradictoires restent documentées. Les abréviations Saint/Sainte et la ponctuation sont normalisées ; aucune ville n'est remplacée par une ville supposée.

Les entrées retenues sont publiées par le pipeline canonique habituel. Les autres restent dans SourceObservation, avec leur motif et leur RAW. Une fermeture explicite désactive seulement sa représentation via le gestionnaire de cycle de vie existant ; les autres sources actives et l'historique survivent. Une attestation plus récente protège contre un retrait observé auparavant. Une contradiction non résolue ne constitue jamais une preuve de fermeture.

## Limites explicites

L'exhaustivité porte sur ces deux portails au moment de la mesure. Elle ne prouve pas que tous les portails Intersport internationaux sont couverts. Les candidatures accessibles ne suffisent pas à certifier chaque texte, adresse ou décision de Google Jobs. Les enseignes Intersport Montagne/Outlet restent des formats de l'identité Intersport ; le libellé original est conservé. La recherche des autres portails mondiaux et le réaudit général restent ouverts.

Les reçus de staging, répétition, commit, déploiement et preuves après production accompagnent ce dossier au fur et à mesure de leur réalisation. Ne pas assimiler validation locale et livraison en production.

## Répétition validée avant activation

940 offres distinctes supplémentaires : 930 créées depuis le portail Intersport, puis 10 créations et 38 rapprochements depuis Blackstore. 933 pays FR prouvés ; 7 pays restent inconnus (Thiais, Morteau et Val Thorens), avec contradiction source archivée. 978 représentations publiables, toutes leurs charges RAW exactes après ingestion. 69 représentations retenues hors publication correspondent à 54 liens fermés uniques et 12 contradictions uniques, avec chevauchement des portails.

Second passage : 0 création, 0 nouvelle fusion, 978 mises à jour des mêmes représentations ; volumes inchangés. 1 400 tests unitaires et 199 tests d’intégration passent, ainsi que le typecheck des deux applications. Ces chiffres sont une répétition locale, pas encore une preuve de production.

## Comparaison avec les compteurs FashionJobs

| Enseigne | Annuaire FashionJobs capturé | Offres directes actives France en production | Monde direct |
|---|---:|---:|---:|
| Intersport | 577 | 867 | 879 |
| Blackstore | 66 | 66 | 66 |

Les 879 Intersport comprennent les cinq offres actives du portail international antérieur. Les 66 Blackstore exigent le rapprochement des deux nouveaux portails : le portail de l’enseigne seul fournit 48 offres publiables. Ce sont des volumes de snapshots différents, pas une équivalence offre par offre. Aucune offre FashionJobs n’a été importée.

## État précis du lot

| Finding | Fixé ? | Commit applicatif | Main ? | Déployé ? | Données réparées / intégrées ? | Preuve prod |
|---|---|---|---|---|---|---|
| Deux portails directs manquants | Oui | 75f0ff5 | 030a101 | Oui | 940 offres supplémentaires | production-proof.json |
| Doublons des deux portails | Oui | 75f0ff5 | Oui | Oui | 38 rattachements, 978 représentations / 940 offres | production-proof.json |
| Fausses annonces ouvertes | Oui pour les fermetures prouvées | 75f0ff5 | Oui | Oui | 54 liens fermés exclus, preuves conservées | application-audit.json et traces d’ingestion |
| Templates expirés avec formulaire accessible | Identifiés, non résolus | 75f0ff5 (mise en attente) | Oui | Oui | 12 liens non publiés ; aucun statut ouvert inventé | live-validation.json |
| Pays non renseignés dans la nouvelle cohorte | Partiel | 75f0ff5 | Oui | Oui | 933 pays France prouvés ; 7 restent non renseignés | final-metrics.json |
| Dates originales, lot PR26 | Oui sur la cohorte prouvée | 9ae6b7b | 1b3fe6e | Oui | 2 844 Jobs et 3 740 JobSources réparés ; 1 477 dates restent inconnues globalement | ../publication-dates/production-proof.json |

Les références officielles de magasins permettent d’avancer sur six des sept pays restants (Thiais et Morteau). `additional-store-geography-proof.json` les distingue : preuves documentées après gel du lot, non encore intégrées au traitement récurrent, donc pas de backfill isolé qui serait annulé à la prochaine ingestion. Val Thorens reste à rapprocher précisément.

Le statut source DEGRADED est explicite : Intersport conserve 12 contradictions, et Blackstore a six lignes fermées dans son listing. Zéro erreur technique. Le premier run n’accorde aucun droit d’attester l’absence ; Intersport reste bloqué pour les clôtures par simple absence tant que les contradictions persistent. Les retraits explicites par formulaire utilisent le gestionnaire de cycle de vie et conservent les autres sources actives.

La préparation Google Jobs est contrôlée sur trois pages réelles : date, pays, employeur et temps partiel correspondent à la base. Cela ne garantit pas l’indexation Google ni l’éligibilité des offres dont un champ requis manque. Le réaudit global, les 1 477 dates restantes et la qualification des autres employeurs mondiaux restent ouverts.

Le contrôle navigateur confirme aussi le compteur réellement affiché : 10 684 sur `/emplois?pays=FR`, 72 359 sur l’accueil. L’accueil affiche 1 043 Maisons qui recrutent, distinctes des 1 567 fiches du catalogue. **Le P1 Douglas reste ouvert : cinq dates futures sont toujours visibles sur l’accueil.** Le lot de réparation des dates prouvées n’a pas corrigé ces cinq cas ; aucun certificat global de production-grade n’est délivré.
