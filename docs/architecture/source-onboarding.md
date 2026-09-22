# Ajouter et qualifier une source

Une source enregistrée est un périmètre de collecte, pas une certification d’employeur. Le point d’entrée maintenu est [source-onboard.mts](../../apps/aggregator/scripts/ops/source-onboard.mts). Les commandes ci-dessous se lancent depuis la racine, avec les accès de l’environnement choisi déjà configurés. Les secrets et captures restent hors Git.

## Contrat des étapes

| Commande | Effet | Condition d’écriture |
|---|---|---|
| `register candidat.json` | Vérifie le candidat et les collisions ; crée une DRAFT avec une nouvelle révision | Aperçu par défaut ; `--apply` pour enregistrer |
| `profile CLÉ` | Lit les identifiants exacts à reprendre dans le dossier d’identité | Lecture seule |
| `evidence CLÉ --purpose=identity\|access --url=URL --revision=RÉVISION` | Archive la page et chaque redirection, sans décision métier | `--apply`, but, URL et révision explicites obligatoires |
| `relation CLÉ --capture=CAPTURE --official-domain=DOMAINE` | Inspecte les liens de la page archivée vers le portail configuré | Lecture seule ; aucune revue ni activation |
| `identity revue.json` | Relit la capture native, inspecte la relation et enregistre la décision du réviseur | Aperçu par défaut ; `--apply` pour enregistrer |
| `access revue-acces.json` | Inspecte les requêtes et robots archivés puis enregistre le périmètre d’accès | Aperçu par défaut ; `--apply` pour enregistrer |
| `collect CLÉ --deadline-ms=30000` | Capture avec l’adaptateur réel, archive puis valide hors réseau | `--apply` obligatoire |
| `validate CAPTURE_ID` | Revalide une collecte scellée, depuis S3 si nécessaire | `--apply` obligatoire |
| `status CLÉ` | Lit un instantané cohérent des portes et de leurs dernières décisions | Lecture seule |
| `promote CLÉ --revision=RÉVISION` | Contrôle les portes sous verrou puis active la source | `--apply` et révision explicite obligatoires |

Toutes les commandes acceptent `--out=/chemin/rapport.json` : fichier privé de mode `0600`, sans suivre de lien symbolique. Les options inconnues, dupliquées ou ambiguës sont refusées avant ouverture de la base ou lecture du dossier. Les fichiers d’entrée sont bornés ; les dossiers JSON doivent être en UTF-8 valide. Le statut et les sorties d’opération n’exportent ni configuration privée ni corps d’offre. Les échecs rendent un code de diagnostic connu, sans recopier les exceptions pouvant contenir des paramètres de base, extraits du dossier ou URLs privées.

### Candidat

```json
{
  "key": "exemple",
  "maison": "Maison Exemple",
  "kind": "ashby",
  "config": { "board": "identifiant-observe" },
  "careersDomain": "jobs.ashbyhq.com",
  "tier": "ATS_OFFICIAL"
}
```

`jobUrlPattern` est facultatif. Les autres champs sont obligatoires ; aucun statut, compteur ou verdict ne peut être ajouté au dossier. La configuration doit être un objet JSON fini non vide, sans paramètres d’exécution. La famille doit avoir une entrée dans le dispatch maintenu. Ce contrôle structurel ne remplace pas la validation des paramètres propres à chaque ATS par la collecte native.

Les tiers admis dans ce parcours sont `EMPLOYER_DIRECT`, `GROUP_OFFICIAL` et `ATS_OFFICIAL`. Les éditeurs d’offres et cabinets exigent encore un contrat de rôle distinct avant extension de ce parcours.

```sh
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts register /chemin/candidat.json
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts register /chemin/candidat.json --apply
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts profile exemple
```

La répétition d’un candidat identique retrouve la même source sans réécrire sa configuration ni son statut. Une configuration ou un motif d’URL différent est un conflit à examiner. Le même tenant ne peut pas être créé sous une seconde clé. Une source RETIRED n’est jamais réactivée par réenregistrement ou import CSV.

### Preuves indépendantes

Les pages officielles et les documents d’accès ont leur propre capture, liée à la révision examinée :

```sh
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts evidence exemple --purpose=identity --url=https://maison.example/carrieres --revision=REVISION_EXAMINEE --apply
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts evidence exemple --purpose=access --url=https://maison.example/robots.txt --revision=REVISION_EXAMINEE --apply
```

Le transport conserve chaque réponse et chaque redirection (six réponses au maximum), avec un budget explicite de 60 secondes par défaut. Il ne réessaie pas les refus. Les requêtes passent par le limiteur partagé ; les réponses 429 alimentent aussi son délai d’attente. Les octets incomplets et les échecs sans réponse restent inspectables mais ne constituent pas une capture complète. `status` présente les dix dernières captures d’identité ou d’accès de la révision courante, séparément de la dernière collecte d’offres. Le corps se lit avec `raw-capture.mts --capture=IDENTIFIANT_REPONSE --out=/chemin/prive`.

Le manifeste privé conserve l’URL demandée et la chaîne exacte des réponses. Les paramètres d’URL et les en-têtes de redirection peuvent être sensibles ; ils restent dans le stockage privé des captures. La lecture vérifie le manifeste, toutes les empreintes et chaque destination sans refaire de requête. **Archiver une réponse 200 ou un document robots ne certifie ni l’identité de l’employeur ni une autorisation d’accès.** Une page de challenge peut être archivée ; son contenu devra être refusé par l’évaluation métier.

### Relation entre page officielle et portail

```sh
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts relation exemple --capture=CAPTURE_ID --official-domain=maison.example
```

Le domaine officiel est une donnée explicitement examinée par l’opérateur, jamais déduite du nom de la source. La commande vérifie une capture `SOURCE_IDENTITY` de la révision courante, observée depuis moins de trente jours, puis analyse son HTML hors réseau. `LINK_MATCHED` signifie qu’un véritable lien ou iframe désigne le portail configuré ; le rapport conserve les références de réponse, empreintes, révision de l’inspecteur et emplacement du témoin. `NOT_PROVEN` rend un code de sortie non nul et un motif. Une panne de stockage reste une erreur d’opération.

Le contrat actuel couvre les boards Ashby, les sous-domaines Recruitee, les sites Workday sous `myworkdayjobs.com`, depuis le lot F3 (16/09/2026) les sites carrière Teamtailor sur leur origine HTTPS exacte, puis (F3b) les boards Greenhouse (`boards`/`job-boards`, variantes `.eu`, formulaire `embed/job_board?for=`), les pages SmartRecruiters (`careers`/`jobs.smartrecruiters.com/<Company>`), les sites Lever (`jobs(.eu).lever.co/<site>`), Personio (`<hôte>/`, `/search`, `/jobs`), Workable (`apply.workable.com/<compte>/` ou `<compte>.workable.com`), les sites carrière sur leur propre origine (SuccessFactors, Phenom, Jibe, Talentsoft, DigitalRecruiters : racine, préfixe de langue, `/search`, `/jobs`, `/careers`, `/annonces`, `/content/…`), Flatchr, Talentview, LVMH (`lvmh.com/join-us/our-job-offers`) et les listings génériques (page configurée exacte, ses seules clés de pagination tolérées ; un sitemap désigne la racine du site). Chaque contrat est un témoin de `sourcePortal.test.ts` (positifs et négatifs). Teamtailor (domaine personnalisé comme `careers.ohmycream.com` ou hôte `*.teamtailor.com`) : la référence attendue est `/` ou `/jobs`, avec les seuls filtres natifs de liste (`query`, `split_view`, `geobound_coordinates[…]`, `department_id`, `location_id`, `remote`), qui désignent un sous-ensemble du même site sans en attester la couverture ; un autre hôte, une origine `http://`, un alias `www`, une page d'offre ou un préfixe de langue ne désignent jamais le site configuré. Il reprend les paramètres natifs utilisés par leurs collecteurs. Le tenant, le site et la casse des chemins sont contrôlés ; les mentions textuelles, commentaires, scripts, templates et iframes remplacées par `srcdoc` ne constituent pas des références utilisables. Les paramètres de suivi/langue sont admis ; pour Workday, les facettes `jobFamily` et `locations` à identifiants natifs hexadécimaux, observées dans une page officielle archivée, sont reconnues. Les autres configurations, domaines personnalisés, formats et paramètres non qualifiés restent `NOT_PROVEN`.

**Références actives admises (politique `official-html-link/3`).** Le témoin est un lien `a[href]` ou un cadre `iframe[src]` de la page officielle vers le listing configuré ; depuis F3b, aussi le `src` d’un script d’embarquement qui charge le board (`boards.greenhouse.io/embed/job_board/js?for=<board>`, jamais le texte inline d’un script), et un lien vers **l’une des offres publiées par le portail** (`job-boards.greenhouse.io/<board>/jobs/<id>`, `jobs.lever.co/<site>/<uuid>`, `<tenant>.recruitee.com/o/<slug>`, `careers.maison.example/jobs/<id>-…`, `jobs.smartrecruiters.com/<Company>/<id>`, `<hôte personio>/job/<id>`, `apply.workable.com/<compte>/j/<code>`, `<site workday>/job/…`, ou toute page du site carrière d’un tenant servi sur sa propre origine) : l’URL porte l’identité du tenant, donc la page officielle désigne ce tenant, et le témoin le dit (`reference: 'posting'`). Mesure du 17/09/2026 sur les captures finales : les pages officielles des sites Greenhouse refusés ne référencent ni le board ni ses offres dans le DOM actif (listes rendues côté client depuis `boards-api.greenhouse.io`, texte de script inerte) ; cinq chargent le script d’embarquement, reconnu. Le listing exact reste préféré quand les deux existent ; aucune de ces références n’atteste la couverture.

**Preuve par le document (lot F3, politique `official-html-link/3`).** Deux cas prouvent la relation sans lien HTML, sous les mêmes conditions de fraîcheur, de statut 200 HTML et d’absence de défi, avec la méthode `OFFICIAL_DOMAIN` et un témoin `document` :

- **le portail servi sur le domaine officiel revu** (ordinal 0) : la page archivée est le portail configuré lui-même, sur un sous-domaine du domaine officiel (`careers.maison.example`) ou, pour un listing configuré sur l’apex ou `www`, sur cette page exacte ; la page d’accueil d’une Maison n’est jamais un portail Teamtailor, mais `www.maison.example/carrieres/` est bien le listing configuré. La Maison a délégué ce nom par son DNS ;
- **le portail redirigé par son éditeur vers son hôte canonique** (ordinal ≥ 1) : le portail configuré, demandé tel quel (`maison.teamtailor.com/`, `maison.recruitee.com/`), est redirigé nativement (301/302/307/308, chaîne archivée de deux à six réponses) vers le même listing sur un sous-domaine propre du domaine officiel revu ; chaque saut est servi par l’origine configurée ou sous le domaine officiel, jamais par un autre tenant du vendeur, et la page finale, réécrite sur l’origine configurée, doit rester le portail (une page d’offre ne l’est pas ; l’apex ou `www` non plus : un éditeur renvoie aussi un site carrière dépublié vers l’accueil de la Maison). Le rapport porte `canonicalPortal` (égal à la page de preuve, imposé par SQL) et `redirectChain`. Mesure du 16/09/2026 sur le registre de production : 44 des 113 origines Teamtailor et 13 des 22 Recruitee sont des hôtes vendeur ainsi redirigés. Cette preuve repose sur l’unicité du domaine personnalisé chez l’éditeur (un tenant ne peut réclamer un hôte qu’il ne sert pas) ; les flux Teamtailor lus sur l’hôte vendeur réécrivent leurs URL sur cet hôte, les offres Recruitee portent leur `careers_url` sur le domaine personnalisé.

Un portail hébergé chez l’éditeur sans redirection canonique (`maison.teamtailor.com` servi tel quel, `jobs.ashbyhq.com/maison`) reste prouvé uniquement par un lien actif d’une page du domaine officiel. La preuve par le document établit une relation de domaine, pas l’état du site : un sous-domaine carrière mort qui répond 200 la satisfait, et c’est la validation native de la collecte, distincte, qui décide alors de la capacité. Une redirection ou une page servie sous un autre domaine d’employeur (groupe, distributeur, franchise) n’est jamais une preuve : la campagne la rend `DOMAINE_OFFICIEL_DIVERGENT`, relation à instruire, sans présumer que le registre a tort. Une redirection vers un autre domaine d’employeur (`nikin.ch` → `nikin.com`, `saksglobal.com` → `exemplarluxurygroup.com`) n’est pas une preuve : c’est un écart du registre, rendu `DOMAINE_OFFICIEL_DIVERGENT` par la campagne.

**Une référence filtrée vers un portail ne prouve ni sa couverture complète ni l’identité de tous ses employeurs.** Le rapport indique toujours `identityApproved: false` et `coverageAttested: false`. La revue d’identité relit obligatoirement cette archive et refait l’inspection. L’ancien dossier textuel n’est pas transformé en capture HTTP et ne peut plus certifier une source.

### Décision d’identité

La [revue d’identité](../employer-identity.md) contient exclusivement la décision et les identifiants de sa source, de sa révision et de sa capture. Elle est humaine, ou rendue par la campagne de qualification (`source-campaign.mts`, réviseur fourni par `--reviewer=IDENTIFIANT`, ou `source-campaign` par défaut) dont chaque énoncé est factuel (page archivée, témoin, domaine officiel lu dans le registre avec sa provenance) : la campagne n'invente ni domaine officiel, ni rôle de portail (`portalScope` nul), ni configuration. Le domaine officiel vient du registre ; la campagne consigne sa provenance (`manual`, `wikidata`, ou `source-careers`, c'est-à-dire dérivé par le catalogue de l'hôte carrière, donc non revu indépendamment) pour que le registre livré la rende visible :

```json
{
  "sourceKey": "exemple",
  "sourceRevisionId": "REVISION_EXAMINEE",
  "captureBatchId": "CAPTURE_IDENTITE",
  "verdict": "VERIFIED",
  "officialDomain": "maison.example",
  "statement": "La page officielle archivée désigne le portail exact examiné pour cette source.",
  "reviewer": "IDENTIFIANT_DU_REVISEUR",
  "checkedAt": "DATE_ISO_DE_LA_REVUE",
  "portalScope": null
}
```

Le domaine, son propriétaire et le périmètre éventuel restent à examiner explicitement. `portalScope` vaut `null`, `SINGLE_BRAND` ou `MULTI_BRAND` ; la présence d’un lien ne le détermine pas. Les champs supplémentaires sont refusés, notamment un texte, une empreinte, un rapport d’inspection ou une URL censés remplacer l’archive. Un périmètre SINGLE_BRAND peut compléter un employeur absent ; il ne suffit pas à assimiler un nom natif explicite à la marque du portail. Le [contrat d’employeur](../employer-identity.md) distingue ces deux chemins et leur provenance.

Pour `VERIFIED`, la relation doit être `LINK_MATCHED` sous la politique courante et désigner le portail exact. Les verdicts `CONTRADICTED` et `UNRESOLVED` requièrent aussi une capture d’identité complète, récente et liée à la révision, mais pas un lien positif : une réponse 403 peut étayer un refus. Ils exigent `portalScope: null`. Le statement doit expliquer la décision ; un refus HTTP n’est pas automatiquement une contradiction d’employeur.

L’archive est lue avant l’acquisition des verrous SQL. La révision est ensuite revérifiée sous verrou. Les empreintes, URLs publiques expurgées et références de réponse sont dérivées des octets archivés. SQL impose la liaison à la capture et à sa réponse finale ; le parseur applicatif établit le témoin HTML. Aucune requête de secours vers le portail ne peut remplacer une archive indisponible.

La capture et la décision doivent dater de moins de trente jours ; la décision ne peut pas précéder son observation de plus de cinq minutes de tolérance d’horloge. Le dossier ne se rattache jamais automatiquement à une révision plus récente. Répéter le même dossier ne crée pas de décision et ne remplace pas une contradiction ultérieure, même si l’heure de réinspection change. La politique versionnée détermine l’acceptation de l’inspection ; son empreinte de runtime est conservée pour audit, sans imposer une nouvelle décision humaine à chaque changement de code sans rapport avec cette politique.

La [validation native](native-capture.md) utilise les réponses brutes, le manifeste scellé et le lecteur actuel. Elle exige que le rejeu hors réseau reproduise exactement la collecte (les preuves d’énumération sont donc horodatées à l’instant d’observation de la capture, jamais à l’horloge murale) et que chaque offre soit reconstituable depuis son seul RAW par le lecteur de publication (`publication/recovery.ts`) : depuis F3b, ce lecteur couvre aussi SmartRecruiters (annonce `/postings/{id}` retenue dans `raw.jobAd`), SuccessFactors (lignes RMK v2, et chemin HTML avec le lien de listing et le détail microdonnées retenus dans `raw.successfactorsDetail`), DigitalRecruiters (page d’offre retenue dans `raw.postingEvidence`), les JSON-LD génériques (page d’origine retenue dans `raw.catwalksPageUrl`) et Personio avec l’évidence de sa page de détail. Un flux Teamtailor nativement vide (JSON Feed 1.1 sans page suivante) est validé à zéro, comme un flux Ashby vide. Elle produit une décision immuable distincte du statut opérationnel de la source. Un refus technique sort en erreur tout en conservant son rapport. Elle n’enregistre aucune offre publique et ne certifie aucune absence.

```sh
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts identity /chemin/revue.json --apply
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts collect exemple --apply --deadline-ms=30000
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts status exemple
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts promote exemple --revision=REVISION_EXAMINEE --apply
```

Une promotion répétée sur une source déjà ACTIVE vérifie à nouveau les portes, puis retourne le statut sans réécrire la ligne. Une révision différente ou une preuve obligatoire expirée reste un refus. Depuis F5, l’identité opérationnelle repose sur la révision du registre ; la revue d’identité par capture est facultative pour la promotion et l’admission. La validation native et la décision d’accès restent obligatoires. La promotion ne déclenche aucune ingestion. Chaque démarrage revérifie ces conditions et conserve ses décisions dans une [admission immuable](source-ingestion.md). Le nouveau résultat doit ensuite réussir sa propre validation hors réseau avant publication.

## Limites avant release

- Le [lecteur de règles](source-access.md) utilise maintenant l’identité réelle CatwalksBot, combine les groupes applicables et borne les comparaisons. Il calcule une observation ; il ne qualifie pas la portée de tout un adaptateur.
- La porte d’accès exige une décision immuable liée à la révision et aux requêtes HTTP observées. `revisionBound: true` décrit ce contrat, même quand aucune décision n’existe. Le navigateur et les captures historiques sans provenance complète restent non certifiants.
- Les certifications positives couvrent les familles dont le contrat de portail est écrit et éprouvé (voir « Relation entre page officielle et portail ») ; une famille sans contrat, une configuration à clés inconnues ou un portail dont la relation n'est pas démontrée restent `NOT_PROVEN`, jamais certifiés par défaut.
- Les rôles employeur, groupe et éditeur, la réouverture explicite d’une source retirée et les paramètres privés d’accès restent des travaux distincts. Les écrivains d’ingestion exigent une capture admise liée au registre, y compris à la frontière transactionnelle des retraits, et chaque collecte admise se termine par un rapport immuable dont dépend toute preuve d’absence : voir le [contrat d’ingestion](source-ingestion.md). Une source dont l’adaptateur n’archive pas d’identifiants canoniques peut être ingérée sans jamais pouvoir fermer une offre par absence.
- Un certificat calculé avec le lecteur local ne certifie pas une release Railway différente.

`promotionGatesPass` indique que les portes actuelles permettent une transition ; ce champ ne constitue pas une attestation de préparation globale à la production. Les préconditions sont revérifiées lors de l’écriture.

## Découverte et anciens outils

[source-discovery.mts](../../apps/aggregator/scripts/ops/source-discovery.mts) fournit `inspect URL` et `prepare DOSSIERS_JSON_OU_CSV`, en lecture seule. Les indices de domaine, de nom et de groupe aident à examiner les doublons ; ils ne prouvent aucune couverture mondiale ni identité. Une inspection HTTP n’est pas une collecte native d’offres et ne rend pas une ancienne validation obsolète.

Les orchestrations P3/B6 et la validation par volume fourni ont été supprimées. Le générateur ancien de preuve par recherche de sous-chaîne a également été retiré : un commentaire HTML pouvait lui suffire, sans lien vers le site ATS configuré. `raw-capture.mts` reste réservé à l’inspection et au rejeu des archives. Les alias d’identité et de promotion de l’ancienne CLI générale sont refusés. Les rapports historiques décrivent leur époque ; leurs anciennes commandes ne sont plus des procédures courantes.

### Provenance du transport avant décision d’accès

Les nouvelles captures conservent la requête réellement passée au transport, son identité de collecteur, sa négociation de contenu et ses redirections dans une archive privée distincte de la clé de rejeu. Les en-têtes d’authentification et les corps de requête ne sont pas copiés. Une ancienne capture sans `requestDataHash` reste inspectable mais ne prouve pas ces informations manquantes. Le [contrat de capture](native-capture.md#provenance-des-requêtes) décrit les quatre origines possibles et les limites navigateur/WAF. La décision d’accès exige désormais ces preuves et le marqueur de transport HTTP_ONLY ; ces captures seules n’activent rien.

### Décision d’accès

Après la collecte de qualification, archiver `/robots.txt` sur chaque origine réellement interrogée et examiner les périmètres publics. Le dossier suivant est un exemple de structure, pas une autorisation de la source fictive :

```json
{
  "sourceKey": "exemple",
  "sourceRevisionId": "REVISION_EXAMINEE",
  "captureBatchId": "CAPTURE_OFFRES",
  "verdict": "ALLOWED",
  "robotsCaptureIds": ["CAPTURE_ROBOTS"],
  "scopes": [{
    "origin": "https://api.ashbyhq.com",
    "path": { "kind": "EXACT", "value": "/posting-api/job-board/identifiant-observe" },
    "methods": ["GET"],
    "query": { "fixed": { "includeCompensation": "true" }, "variable": [] },
    "surface": "PUBLIC_ATS_JOB_API"
  }],
  "statement": "Le périmètre examiné désigne exclusivement les offres publiques du board de cette Maison.",
  "reviewer": "IDENTIFIANT_DU_REVISEUR",
  "checkedAt": "DATE_ISO_DE_LA_REVUE"
}
```

```sh
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts access /chemin/prive/revue-acces.json
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts access /chemin/prive/revue-acces.json --apply
```

Le document est privé et borné à 128 000 octets. Les observations robots sont calculées à partir des captures ; DISALLOWED n’est jamais réécrit en ALLOWED lorsqu’une autorisation sectorielle fonde la décision. Pour révoquer, fournir NOT_AUTHORIZED, `captureBatchId: null`, `scopes: []` et `robotsCaptureIds: []`, avec une nouvelle justification et date. La dernière décision enregistrée prévaut, y compris un refus. Le [contrat d’accès](source-access.md) précise les limites et les contrôles lors de l’ingestion et de la publication.

**Périmètre dérivé des requêtes observées (campagne F3).** Le lanceur de campagne dérive les `scopes` des requêtes HTTP réellement observées pendant la collecte de qualification (`deriveAccessScopeDocument`, [accessScopeDerivation.ts](../../apps/aggregator/src/connectors/accessScopeDerivation.ts)), selon cinq règles : chaque chemin observé est un périmètre EXACT avec son contrat de requête (paramètres constants sur toutes les requêtes en `fixed`, les autres en `variable`), et deux périmètres ne se regroupent jamais s’ils ne partagent pas la même origine et le même ensemble de méthodes (un point d’entrée POST reste déclaré tel quel, jamais absorbé dans le préfixe GET des pages) ; deux chemins frères ou plus sous un même répertoire (jamais la racine) sont déclarés par ce répertoire en PRÉFIXE, même sous le budget, parce qu’un chemin par offre refuserait la première offre de demain ; un préfixe absorbe tout périmètre de sa famille qu’il couvre, un recouvrement étant une ambiguïté que `matchingAccessScope` refuse (Workday sert des offres avec et sans segment de lieu, DigitalRecruiters intercale parfois un identifiant de site, TalentView range les campagnes sous le répertoire de la société) ; tant que la liste dépasse les 64 périmètres admis, seuls les périmètres les plus profonds de l’origine la plus peuplée remontent d’un répertoire, chemin isolé compris (SuccessFactors loge chaque offre dans son propre répertoire), jamais jusqu’à la racine, jamais une autre origine, jamais un point d’entrée moins profond, faute de quoi le motif `ACCESS_SCOPE_BUDGET` nomme l’origine et aucune décision n’est écrite ; la surface déclarée vient du type de contenu servi et de la famille, et pour un périmètre qui mêle plusieurs types, de la majorité, à égalité dans un ordre fixe (jamais l’ordre d’arrivée des captures). L’énoncé de chaque décision dérivée dit ce qu’un préfixe couvre au-delà de l’observé (les entrées futures de son répertoire, rien d’autre), le nombre de remontées, et que les méthodes ne sont jamais fusionnées entre un point d’entrée et des pages ; `etapes.acces.derivation` porte ces comptes dans le verdict. Deux limites nommées : un portail dont les offres vivent à la racine (`jobs.globus.ch/<slug>.html`) ne reçoit que des périmètres EXACT, et sa première offre nouvelle déclenche `ACCESS_SCOPE` à l’ingestion jusqu’à requalification ; les chemins nouveaux sous un préfixe ne sont réévalués contre robots qu’à la décision suivante (validité 30 jours). Toute requête d’une collecte est émise sous l’identité du robot : une requête émise sous un autre agent (le plan de site l’était jusqu’au lot F3b) est étrangère au périmètre et refuse la source entière ; un plan de site qui refuse le robot rend la source INACCESSIBLE, et un `robots.txt` qui l’interdit la rend REFUSEE.

## Golden Path local

Le [Golden Path reproductible](golden-source.md) crée une base dédiée vide et éprouve l’ajout, la qualification, deux ingestions, le rejeu et la lecture API. Il exige en supplément une revue d’identité VERIFIED afin de couvrir ce parcours facultatif. Il ne certifie ni toutes les sources ni une release de production.
