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

Le contrat actuel couvre les boards Ashby, les sous-domaines Recruitee et les sites Workday sous `myworkdayjobs.com`. Il reprend les paramètres natifs utilisés par leurs collecteurs. Le tenant, le site et la casse des chemins sont contrôlés ; les mentions textuelles, commentaires, scripts, templates et iframes remplacées par `srcdoc` ne constituent pas des références utilisables. Les paramètres de suivi/langue sont admis ; pour Workday, les facettes `jobFamily` et `locations` à identifiants natifs hexadécimaux, observées dans une page officielle archivée, sont reconnues. Les autres configurations, domaines personnalisés, formats et paramètres non qualifiés restent `NOT_PROVEN`.

**Une référence filtrée vers un portail ne prouve ni sa couverture complète ni l’identité de tous ses employeurs.** Le rapport indique toujours `identityApproved: false` et `coverageAttested: false`. La revue d’identité relit obligatoirement cette archive et refait l’inspection. L’ancien dossier textuel n’est pas transformé en capture HTTP et ne peut plus certifier une source.

### Décision d’identité

La [revue d’identité](../employer-identity.md) contient exclusivement la décision humaine et les identifiants de sa source, de sa révision et de sa capture :

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

La [validation native](native-capture.md) utilise les réponses brutes, le manifeste scellé et le lecteur actuel. Elle produit une décision immuable distincte du statut opérationnel de la source. Un refus technique sort en erreur tout en conservant son rapport. Elle n’enregistre aucune offre publique et ne certifie aucune absence.

```sh
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts identity /chemin/revue.json --apply
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts collect exemple --apply --deadline-ms=30000
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts status exemple
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts promote exemple --revision=REVISION_EXAMINEE --apply
```

Une promotion répétée sur une source déjà ACTIVE vérifie à nouveau les portes, puis retourne le statut sans réécrire la ligne. Une révision différente, une contradiction ou une preuve expirée reste un refus. La promotion ne déclenche aucune ingestion. Chaque démarrage exige à nouveau les trois portes et conserve leurs décisions dans une [admission immuable](source-ingestion.md). Le nouveau résultat doit ensuite réussir sa propre validation hors réseau avant publication.

## Limites avant release

- Le [lecteur de règles](source-access.md) utilise maintenant l’identité réelle CatwalksBot, combine les groupes applicables et borne les comparaisons. Il calcule une observation ; il ne qualifie pas la portée de tout un adaptateur.
- La porte d’accès exige une décision immuable liée à la révision et aux requêtes HTTP observées. `revisionBound: true` décrit ce contrat, même quand aucune décision n’existe. Le navigateur et les captures historiques sans provenance complète restent non certifiants.
- Les certifications positives d’identité sont limitées aux trois contrats natifs qualifiés ci-dessus. Les domaines personnalisés, documents de groupe et autres familles exigent un contrat d’inspection adapté avant leur admission ; aucune preuve textuelle ne sert de contournement.
- Les rôles employeur, groupe et éditeur, la réouverture explicite d’une source retirée, les paramètres privés d’accès et les preuves d’absence liées aux captures restent des travaux distincts. Les écrivains d’ingestion exigent désormais une capture admise liée au registre, y compris à la frontière transactionnelle des retraits : voir le [contrat d’ingestion](source-ingestion.md).
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
