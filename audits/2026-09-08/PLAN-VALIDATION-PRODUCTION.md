# Plan complet d'audit et de validation de production

> Mise à jour après corrections autorisées : voir le [deuxième lot et état de préparation](./LIVRAISON-LOT-2.md). La validation locale ne vaut pas certification de la production.

**Catwalks / Mode Careers — 8 septembre 2026**

Ce plan intègre la pièce jointe, la dernière livraison du développeur et les constats de l'[audit initial](/Users/lmelane/Downloads/catwalks-job-aggregator/audits/2026-09-08/AUDIT-PRODUCTION.md). Il définit les preuves nécessaires pour déclarer le système exploitable, puis pour élargir sa couverture. La nouvelle autorisation de l'utilisateur permet les corrections locales ; elle ne transforme pas ce document en certification de la production.

## 1. Lecture de la livraison : acquis et réserves

| Livraison | Appréciation | Preuve encore nécessaire |
|---|---|---|
| Refus de corriger AZ/AR/NH sans preuve | Bonne décision : une ambiguïté ne justifie pas une modification du pays | Inventaire reproductible des cas et statut des preuves disponibles |
| Refus d'utiliser la seule signature « ville, code » | Fondé : cette forme décrit aussi des données correctes | Mesure des faux positifs sur témoins corrects et ambigus |
| `countryIntegrity` existe mais reste vide | Ce n'est pas un contrôle actif ; vide ne signifie pas « pays vérifié » | Contrat précisant non évalué, ambigu, contradictoire et confirmé |
| Renommage `countryCode` | Le schéma nomme désormais correctement une valeur ISO | Compatibilité pendant le déploiement ; validité du pays réel, distincte de la validité syntaxique du code |
| `structuralValuesOf` | Le code local sépare le nom de colonne et le vocabulaire historique des événements | Parcours création → correction de pays → événement → replay → statistiques |
| Post-conditions génériques | Base utile pour exprimer et compter les violations de propriétés | Preuve que chaque outil simule l'état entier, exécute les contrôles et bloque effectivement les écritures |
| Correctif SQL et tests de fumée | Présents dans la révision locale `c353ed3`, tests exécutés avec succès lors de l'audit précédent | Fixtures de cohérence des résultats ; une requête qui s'exécute peut calculer un mauvais total |
| « Toutes les surfaces en 200 » | Contrôle de disponibilité utile | Vérifier contenu, totaux, filtre, fiche et destination ; un 200 peut contenir un message d'erreur |
| Health Score annoncé | Prochaine étape pertinente si elle expose les preuves | Contrat des dimensions, des dénominateurs et des règles d'attestation avant pondération |

Les incidents doivent rester distincts : le défaut SQL `employmentTerm` décrit par le développeur et l'incompatibilité temporaire `Job.country` observée dans les journaux sont deux défauts différents. Le rétablissement des pages n'efface pas le besoin de tester le processus de migration.

Le module `trust/postconditions.ts` inspecté évalue les invariants sur les lignes reçues. Il ne garantit pas, à lui seul, la constitution de l'état simulé complet, l'isolation concurrente ou l'arrêt de tous les appelants. Un compteur exact n'est pas une preuve de cohérence ; une propriété de réconciliation portant sur des comptes, telle que « somme des pays + inconnus = total », est en revanche un invariant valable.

### Ajustements à la proposition d'architecture jointe

- Conserver les observations et la provenance, mais définir une rétention, une minimisation et les possibilités d'effacement nécessaires : « ne jamais détruire aucune donnée » ne doit pas devenir une conservation illimitée de tout contenu.
- Une famille d'ATS ne constitue pas une autorité universelle. L'autorité est celle de la source et du champ observé, avec fraîcheur et preuves ; un champ ATS incorrect ne gagne pas automatiquement.
- Un identifiant canonique relie des observations. Il ne faut pas supposer qu'il existe une clé universelle fiable pour tous les recrutements.
- L'idempotence concerne l'état métier : le même événement ne crée pas une nouvelle offre. Les traces de chaque tentative peuvent légitimement différer.
- Un graphe logique d'entreprises, marques, offres et lieux peut rester dans PostgreSQL. Une base de graphes et l'ajout de personnes/articles ne sont pas des prérequis de production de cet agrégateur.
- Ne pas imposer « 95–99 % automatique » avant mesure. L'automatisation doit satisfaire les seuils d'erreur, et les inconnues doivent rester visibles.

## 2. Cadre de la campagne

**Unité auditée.** Distinguer famille d'adaptateur, source configurée, tenant ATS, marque et employeur. Le dépôt inspecté compte 38 fichiers d'implémentation d'adaptateurs ; les 440 sources du catalogue ne sont pas 440 adaptateurs indépendants.

**Environnements.** Revue et mesures bornées en lecture seule sur la production ; reproductions, interruptions, migrations, charge et restauration sur environnements isolés. Les contrôles réseau doivent reproduire l'environnement effectif du processus concerné avant d'attribuer une panne à l'hébergement. Aucune fermeture ou correction massive pour « essayer » en production.

**Versions.** Chaque campagne fixe commit, état des migrations, version de configuration des sources, normaliseur, taxonomie, référentiels, horloge de référence et identifiant du jeu de données. Toute modification pendant la campagne invalide les preuves qu'elle affecte, pas nécessairement tout le dossier.

**Statuts d'un contrôle :** non mesuré ; défaut confirmé ; correction locale ; validé en staging ; validé en production. Un point n'est jamais clos parce qu'un fichier a été ajouté ou qu'un développeur annonce sa résolution.

**Fiche de preuve obligatoire :** identifiant du contrôle, risque, scénario et données, résultat attendu, commande ou procédure, résultat obtenu, version, date, lien vers la preuve, responsable de correction, responsable de validation, effets secondaires et retour arrière.

### Échantillonnage

1. Invariants structurels : tout le corpus, par lots et avec cohérence de lecture ; rapport complet des violations, exemples limités dans l'interface.
2. Contrats techniques : toutes les familles d'adaptateurs et toutes les sources prioritaires, avec fixtures des formes de pagination et réponses réellement rencontrées.
3. Précision sémantique : corpus annoté indépendant du code, stratifié par ATS, langue, pays, métier, taille d'employeur et ambiguïtés. Séparer corpus de développement et corpus de validation.
4. Couverture : référentiel d'employeurs distinct du catalogue ; comparer offres attendues et retrouvées sur les canaux autorisés. Une source inconnue et un employeur sans poste sont deux états différents.
5. Statistiques : publier numérateur, dénominateur, cas exclus et incertitude. Quelques centaines d'exemples ne démontrent pas une précision de 99,9 %.

## 3. Inventaire géographique à produire maintenant

Je recommande de livrer cet inventaire **avant ou avec le Health Score**, en lecture seule, sans corriger AZ/AR/NH et sans table ad hoc « Phoenix → Arizona ».

Chaque cas doit porter : identifiant Job et JobSource ; pays/ville/région stockés ; localisation brute ; observation et version d'extracteur ; preuve indépendante disponible ou absente ; motif du soupçon ; degré d'incertitude ; date ; version de règle ; décision humaine éventuelle.

Employer des catégories explicites : **ambiguïté de suffixe**, **contradiction indépendante**, **absence de preuve**, **preuve confirmante**. Une ville absente du reste du corpus est un signal d'investigation, pas une preuve que son pays est faux. Berlin/DE, Munich/DE, Toronto/CA et Buenos Aires avec « Argentina » servent de contre-exemples obligatoires ; Los Angeles/CA et Bentonville/AR restent à départager selon leurs observations propres.

La dépendance au corpus ne rend pas toute analyse irrémédiablement non déterministe : on peut figer le corpus de référence et sa version. En revanche, elle ne doit pas entrer comme état implicite changeant dans le normaliseur. L'inventaire relève du diagnostic ; la normalisation pure dépend d'entrées et référentiels explicites. L'égalité ingest/replay doit comparer le résultat métier à versions et horloge identiques, hors identifiants de tentative.

**Livrable :** inventaire versionné, résumé par source, résultats sur témoins corrects, commande de reproduction et zéro modification de pays. Le champ `countryIntegrity` n'est pas assimilé à une validation tant que son évaluation n'est pas définie.

## 4. Les douze lots d'audit

### L0 — Déploiement, schéma et reprise

**À tester :** application précédente avec migration prévue ; nouveaux lecteurs et travailleurs ; colonnes accédées dynamiquement ; SQL brut ; relations et index ; arrêt entre étapes ; indisponibilité DB ; restauration et retour arrière.

**Preuves :** matrice de compatibilité, restauration chronométrée, invariants avant/après sur état complet, sondes de contenu après bascule. Ne pas limiter les tests à une base vide. Préférer une migration coordonnée et un seul responsable d'exécution ; respecter la stratégie de renommage atomique retenue, avec ses contraintes de bascule explicites.

**Sortie :** stratégie sans lecteur incompatible ; récupération démontrée ; aucune erreur masquée par une page HTTP 200. Références audit : A01, A17.

### L1 — Observations, provenance et replay

**À tester :** première observation, mise à jour plus courte, remplacement d'un champ, valeur absente, plusieurs sources contradictoires, nouveau rattachement, correction de taxonomie, replay partiel puis complet.

**Preuves :** observation utilisée pour chaque champ critique, version de règle, comparaison du brut et du canonique, replay déterministe à versions fixées. Qualifier les bruts absents et la capacité réelle à les retrouver ; un ancien payload ne doit pas être présenté comme la dernière observation.

**Sortie :** valeurs importantes explicables et reconstruisibles ; aucune source secondaire ne remplace une valeur employeur sans règle fondée. Références : A04, A05, A14.

### L2 — Identité des entreprises et des offres

**À tester :** groupe/marque/employeur légal ; aliases ; homonymes de villes ; pays contradictoires ; responsable/adjoint ; horaires et contrats distincts ; sources de même tenant ; republication ; corrections d'un identifiant existant ; arrivée concurrente ; ordre d'arrivée inversé ; source intermédiaire sans pays ; réconciliation hebdomadaire.

**Preuves :** corpus annoté de paires et de groupes, taux de fausse fusion et de doublon résiduel, conservation des références d'origine, tests réels en base. Répéter un même input ne doit pas dupliquer l'offre ; deux travailleurs ne doivent pas contourner l'identité transactionnelle.

**Sortie :** scénarios connus protégés dans tous les chemins d'écriture ; ambiguïtés conservées ; réparation historique proposée séparément. Références : A02, A03, A10, A28.

### L3 — Collecteurs et complétude

**À tester :** succès complet, total annoncé absent/faux, pagination répétée ou bouclée, page intermédiaire cassée, payload tronqué, changement de schéma, 403/429/challenge, HTML 200 sans offres, timeout, filtrage sectoriel et écriture partielle.

**Preuves :** résultats typés avec périmètre, éléments annoncés/lus/éligibles/écrits, erreurs et motif de fin ; fixtures par famille et comparaison sur sources représentatives. Le curseur ne devient durable qu'après les observations/écritures nécessaires.

**Sortie :** pas de succès complet sans preuve ; un travail annulé ne poursuit pas ses écritures ; reprise après interruption sans perte. Références : A06, A07, A11, A19.

### L4 — Activité, expiration et liens de candidature

**À tester :** absence après collecte complète ; absence après collecte partielle ; source indisponible plusieurs jours ; vrai résultat vide ; expiration explicite ; réouverture ; retrait de source ; disparition de la meilleure URL ; collecte simultanée au refresh.

**Preuves :** machine d'états et invariants partagés par ingest, refresh, purge et reconcile. Distinguer dernière tentative, dernière observation positive et dernier parcours complet. Tester le contenu de la destination, pas seulement son code HTTP.

**Sortie :** aucune fermeture fondée sur un échec ; aucune offre annoncée fraîche sans observation correspondante ; source canonique valide ; opérations volumineuses bornées. Références : A07–A10.

### L5 — Géographie, métiers, contrats et salaires

**À tester :** ambiguïtés ISO/subdivisions, multi-lieux et remote restreint ; langues et écritures différentes ; séparation intitulé source/métier/séniorité ; temps de travail/programme/engagement ; devises et salaires horaires décimaux ; valeurs inconnues.

**Preuves :** inventaire L1/L2, précision annotée par dimension, règles versionnées et contre-exemples. Une valeur typée ou conforme ISO peut rester sémantiquement fausse.

**Sortie :** aucune donnée inventée ; inconnus visibles ; précision mesurée avant activation de nouveaux filtres. Références : A20, A21, A24.

### L6 — Health Score et supervision

**À tester :** cas de la section suivante, chaque compteur jusqu'au digest, heartbeat et code de sortie ; panne de l'alerteur ; une source saine au milieu de sources arrêtées ; run récent mais partiel ; absence de baseline.

**Preuves :** contrat des métriques, événements sous-jacents, dénominateurs, classement des incidents, réception réelle d'alertes sur environnement de test et sonde externe.

**Sortie :** une défaillance critique ne peut être compensée par un bon score de remplissage ; risques et incertitudes inspectables ; aucune suppression pilotée par une simple note globale. Références : A11, A14, A17.

### L7 — Sécurité, sources et droits

**À tester :** activation et exécution avec verdict défavorable ou périmé ; SSRF DNS/redirections/sous-requêtes navigateur ; propagation des cookies entre origines ; HTML/JSON-LD malveillants ; validation des paramètres API ; rôles DB et isolation ; secrets dans logs et bruts ; dépendances.

**Preuves :** essais dans un réseau de test, inventaire de droits et conditions par source, permissions réellement attribuées, politique de rétention, mécanisme de retrait et résultats des scans avec atteignabilité qualifiée.

**Sortie :** aucune cible interne joignable par les contenus collectés ; activation conforme au contrat ; risques exploitables traités. Références : A12, A13, A27. Les obligations juridiques propres à chaque source nécessitent un examen adapté ; le plan ne les certifie pas.

### L8 — Recherche, facettes et produit mondial

**À tester :** plus de 300 entreprises, longue traîne, facettes combinées, inconnus, FR/EN, saisie d'un pays dans Lieu, pagination pendant ingestion, changement de filtres sous réseau lent, clavier, lecteur d'écran et mobile.

**Preuves :** rapprochement des totaux, corpus de requêtes et jugements de pertinence, parcours navigateur, filtres et URL cohérents, aucune réponse obsolète ajoutée à une nouvelle recherche.

**Sortie :** toutes les offres attendues restent atteignables ; filtres exacts ; parcours publié dans chaque langue effectivement pris en charge. Références : A15, A18, A22–A24.

### L9 — Charge, coûts et dimensionnement

**À tester en staging :** catalogue actuel puis 3× ce volume ; trafic de pointe prévu puis 3× ; collecte et recherche simultanées ; grands tenants ; backlog après interruption ; limites de connexions et stockage.

**Preuves :** distribution réaliste de descriptions, sources et lieux ; plans SQL ; p50/p95/p99, erreurs, saturation, durée et coût par 1 000 observations/offres confirmées. Rendre le trafic attendu et le budget explicites avant de dimensionner. Aucun chiffre de capacité ne découle du seul succès d'un build.

**Sortie :** budget de latence et coût respecté avec marge ; comportement sous surcharge prévisible ; reprise bornée. Prioriser PostgreSQL/index/projections/cache avant d'introduire un service supplémentaire sans mesure. Références : A17–A19.

### L10 — SEO et intelligence de marché

**À tester :** identité des URL, canonique, sitemap, date et devise inconnues, expiration, fusion et anciennes URL ; quotas d'indexation et retries ; historique après purge ; panel de sources constant ; données observées/reconstruites.

**Preuves :** événements de publication durables et acquittés, rapprochement page/JSON-LD/canonique, reconstruction des métriques historiques et effets des ajouts de sources. L'activation des intégrations externes reste à faire selon les décisions produit existantes.

**Sortie :** aucune échéance ou devise créée pour le moteur ; retrait non perdu ; tendances ne confondant pas découverte d'une source et hausse des recrutements. Google prévoit l'omission de `validThrough` si la date est inconnue et demande le traitement des offres expirées. [Documentation Google](https://developers.google.com/search/docs/appearance/structured-data/job-posting).

Références : A09, A25, A26.

### L11 — Couverture, exploitation continue et réception

**À tester :** représentativité pays/métier/marque, onboarding d'une nouvelle source, transfert à un autre opérateur, procédure d'incident, maintenance d'adaptateur, revue des exceptions et suivi de dérive.

**Preuves :** référentiel externe au catalogue, offres uniques marginales par source, couverture mesurée sur panel, responsables et modes opératoires, sept cycles quotidiens examinés sur le périmètre de lancement.

**Sortie :** exploitation possible sans connaissance détenue par une seule personne ; lacunes connues ; engagement de service mesuré. Le leadership mondial nécessite ensuite un benchmark concurrentiel sur le même panel. Références : A16, A17, A28.

## 5. Contrat du Health Score

### Ne pas confondre ses trois responsabilités

1. **Droit d'attester une absence :** booléen fondé sur complétude, périmètre et persistance, avec motif. Il ne résulte pas d'une moyenne.
2. **Santé technique de source :** état de collecte, retard, challenge, dérive et qualité des champs. Chaque dimension garde sa valeur et son statut mesuré/inconnu.
3. **Priorité d'intervention :** gravité, offres distinctes exposées, ancienneté et existence d'autres sources saines. Ce n'est pas une probabilité de perte sans modèle calibré.

### Métriques minimales

| Dimension | Définition de mesure | Protection contre un score trompeur |
|---|---|---|
| Volume | Offres collectées et éligibles comparées à un historique de parcours complets comparables | Une nouvelle source a une baseline inconnue ; pas une qualité parfaite |
| Complétude | Périmètre/pages/identifiants parcourus et persistés ; total déclaré si fiable | Un 200, un nombre positif ou un ratio de champs rempli ne prouve pas la complétude |
| Fraîcheur | Âge du dernier parcours complet et de la dernière observation positive | Un run raté récent ne remet pas la fraîcheur à zéro |
| Champs | Présents/éligibles, par champ et provenance | Exclure correctement le hors-secteur et les champs non applicables ; distinguer manquant et contradictoire |
| Attestation | Décision et motifs issus de L3/L4 | Bloquée si pagination ou écriture incomplète |
| Challenges | Statut, fréquence, hôte et dernière tentative | Un challenge n'est ni une source vide ni une fermeture |
| Contradictions | Nombre de cas avec preuve indépendante et cas seulement ambigus | Un soupçon de suffixe n'est pas une erreur confirmée |
| Dérive | Changements de structure, distributions, nulls, classifications et durées | Comparer des périmètres et dénominateurs stables |

### Offres à risque : calculer des ensembles, pas additionner des volumes

Pour une source en difficulté, compter les **Job distincts** qui en dépendent sans autre observation de source encore suffisamment fraîche et fiable. L'activité du simple booléen `JobSource.isActive` ne suffit pas à établir cette alternative. Pour une contradiction de champ, limiter l'exposition aux offres dont le champ canonique dépend de la source concernée.

Séparer : exposition observée sur les offres connues ; offres jamais découvertes dont le nombre est inconnu ; invalidités confirmées ; cas à vérifier. Calculer le total global par union des identifiants, pas par somme de chaque source. Un risque identifié sur trois sources d'une même offre reste une offre exposée.

**Exemple synthétique :** une source avec 1 000 offres, dont 900 ont une alternative saine, expose 100 offres connues. Une petite source de 150 offres sans alternative expose 150 offres : elle peut donc passer avant. Un incident de sécurité ou une corruption confirmée conserve une priorité supérieure indépendamment du volume.

**Tests obligatoires :** 100 offres collectées dont 20 pertinentes et complètes → qualité de ces 20 offres à 100 %, pas à 20 % ; 200 HTML de challenge → aucune attestation ; 80/100 pages persistées → partiel ; une source sans historique → non mesuré ; panne d'alerte → livraison échouée visible ; une seule source saine → les autres restent en incident ; alternatives périmées → non protectrices.

## 6. Portes de validation et ordre des travaux

| Porte | Conditions | Décision |
|---|---|---|
| **G0 — Preuves reproductibles** | Versions figées, base isolée, scénarios de l'audit reproduits, inventaire géographique et métriques définis | Le travail peut être évalué objectivement |
| **G1 — Intégrité et sécurité** | L0–L7 critiques validés ; aucune fusion destructive connue ; reprise et droits d'attestation démontrés | Autoriser une validation fonctionnelle et de charge complète |
| **G2 — Service exploitable** | L8–L10 validés au volume/trafic cible ; restauration exercée ; alertes reçues ; dossier de déploiement complet | Candidat à un déploiement maîtrisé |
| **G3 — Production surveillée** | Bascule contrôlée, contrôles de contenu, sept cycles quotidiens examinés, incidents traités et exceptions explicites | Élargissement progressif du périmètre |

Les lots se recouvrent : L6 doit démarrer avec l'inventaire et le contrat d'attestation, sans attendre une interface de score finalisée ; L7 accompagne chaque changement. La priorité immédiate est L0 → L1/L2 → L3/L4, avec L5/L6 en appui. Les corrections de résultats web ou de publication incorrecte peuvent être livrées tôt si elles ont une preuve isolée.

**Cibles proposées, à contractualiser :** disponibilité du parcours 99,9 % ; P95 de fraîcheur sous 30 h pour la cadence quotidienne ; 100 % des runs prévus avec résultat explicite ; zéro date/devise/localisation inventée ; zéro offre active sans justification ; faux regroupements visés sous 0,1 % avec preuve statistique appropriée ; P95 de recherche usuelle sous 1 s au trafic cible ; restauration visant RPO 15 min/RTO 60 min seulement si l'architecture et l'exercice le démontrent. Ces cibles ne sont pas des résultats acquis.

Un défaut de sécurité exploitable, une perte d'offre reproductible, une migration incompatible ou une impossibilité de restauration bloque la validation du périmètre concerné. Un pays peu couvert ou une langue non publiée peuvent rester hors périmètre, à condition de l'annoncer clairement. Une exception porte propriétaire, impact, durée et plan de résolution ; une moyenne verte ne la remplace pas.

### Dossier demandé au développeur pour chaque livraison

- Changement final, versions et liste des risques traités ; distinction correctif logiciel/réparation du catalogue.
- Scénario qui échouait avant et passe après, plus scénarios de non-régression pertinents.
- Simulation de l'état complet, invariants évalués, erreurs et exemples identifiables.
- Résultats de CI, SQL, intégration, parcours et charge selon le lot ; tests ignorés explicités.
- Effets sur données historiques, URL, événements, indexation et consommateurs.
- Procédure de bascule, critères d'arrêt et retour arrière, preuves de sauvegarde/restauration concernées.
- Liste des points encore ouverts. « Tests verts » ou « tout en 200 » seuls ne permettent pas la réception.

## 7. Mise en œuvre locale autorisée pendant cette livraison

Le premier lot local traite les garde-fous de fusion pays/niveau de poste/écart de date dans l'ingestion et la réconciliation, les ponts de fusion avec pays inconnu, l'absence de date ou devise inventée dans le JSON-LD, la sélection exhaustive des tests de l'agrégateur et le scénario mobile ouvrant les filtres. Les résultats finaux et limites figurent dans le compte rendu de livraison associé.

Cela ne corrige pas encore les fusions historiques, la concurrence transactionnelle entre travailleurs, la provenance champ par champ, le stockage versionné du brut, les timeout/cursors, les facettes ou le Health Score. Ces points conservent leurs contrôles et portes de validation. Aucune modification de production ni migration de données n'est incluse dans ce premier lot.
