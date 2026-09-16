# Ajouter et qualifier une source

Une source enregistrée est un périmètre de collecte, pas une certification d’employeur. Le point d’entrée maintenu est [source-onboard.mts](../../apps/aggregator/scripts/ops/source-onboard.mts). Les commandes ci-dessous se lancent depuis la racine, avec les accès de l’environnement choisi déjà configurés. Les secrets et captures restent hors Git.

## Contrat des étapes

| Commande | Effet | Condition d’écriture |
|---|---|---|
| `register candidat.json` | Vérifie le candidat et les collisions ; crée une DRAFT avec une nouvelle révision | Aperçu par défaut ; `--apply` pour enregistrer |
| `profile CLÉ` | Lit les identifiants exacts à reprendre dans le dossier d’identité | Lecture seule |
| `evidence CLÉ --purpose=identity\|access --url=URL --revision=RÉVISION` | Archive la page et chaque redirection, sans décision métier | `--apply`, but, URL et révision explicites obligatoires |
| `identity revue.json --artifact=preuve.txt` | Vérifie le dossier et ses octets ; enregistre une décision immuable | Aperçu par défaut ; `--apply` pour enregistrer |
| `collect CLÉ --deadline-ms=30000` | Capture avec l’adaptateur réel, archive puis valide hors réseau | `--apply` obligatoire |
| `validate CAPTURE_ID` | Revalide une collecte scellée, depuis S3 si nécessaire | `--apply` obligatoire |
| `status CLÉ` | Lit un instantané cohérent des portes et de leurs dernières décisions | Lecture seule |
| `promote CLÉ --revision=RÉVISION` | Contrôle les portes sous verrou puis active la source | `--apply` et révision explicite obligatoires |

Toutes les commandes acceptent `--out=/chemin/rapport.json` : fichier privé de mode `0600`, sans suivre de lien symbolique. Les options inconnues, dupliquées ou ambiguës sont refusées avant ouverture de la base ou lecture du dossier. Les fichiers d’entrée sont bornés ; JSON et preuves textuelles doivent être en UTF-8 valide. Le statut et les sorties d’opération n’exportent ni configuration privée ni corps d’offre. Les échecs rendent un code de diagnostic connu, sans recopier les exceptions pouvant contenir des paramètres de base, extraits du dossier ou URLs privées.

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

La [revue d’identité](../employer-identity.md) reprend la révision explicite du profil. Elle ne se rattache jamais automatiquement à une révision plus récente. Répéter le même dossier ne crée pas de décision et ne remplace pas une contradiction ultérieure.

La [validation native](native-capture.md) utilise les réponses brutes, le manifeste scellé et le lecteur actuel. Elle produit une décision immuable distincte du statut opérationnel de la source. Un refus technique sort en erreur tout en conservant son rapport. Elle n’enregistre aucune offre publique et ne certifie aucune absence.

```sh
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts identity /chemin/revue.json --artifact=/chemin/preuve.txt --apply
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts collect exemple --apply --deadline-ms=30000
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts status exemple
node --import tsx apps/aggregator/scripts/ops/source-onboard.mts promote exemple --revision=REVISION_EXAMINEE --apply
```

Une promotion répétée sur une source déjà ACTIVE vérifie à nouveau les portes, puis retourne le statut sans réécrire la ligne. Une révision différente, une contradiction ou une preuve expirée reste un refus. La promotion ne déclenche aucune ingestion ; cette dernière garde ses propres contrôles.

## Limites avant release

- La porte d’accès actuelle lit encore `robotsVerdict` et `robotsCheckedAt`. Le statut indique `revisionBound: false`. Cette preuve mutable doit être remplacée par une décision immuable couvrant les cibles HTTP exactes ; la CLI ne la fabrique pas lors de la collecte.
- La validation du dossier d’identité ne prouve pas à elle seule que la page officielle désigne le tenant et le site ATS configurés. L’archivage est disponible ; la vérification de cette relation et le rattachement de la revue à cette capture restent à livrer.
- Les rôles employeur, groupe et éditeur, la réouverture explicite d’une source retirée, les paramètres privés d’accès et les ingestions de sources déjà actives restent des travaux distincts.
- Un certificat calculé avec le lecteur local ne certifie pas une release Railway différente.

`promotionGatesPass` indique que les portes actuelles permettent une transition ; ce champ ne constitue pas une attestation de préparation globale à la production. Les préconditions sont revérifiées lors de l’écriture.

## Découverte et anciens outils

[source-discovery.mts](../../apps/aggregator/scripts/ops/source-discovery.mts) fournit `inspect URL` et `prepare DOSSIERS_JSON_OU_CSV`, en lecture seule. Les indices de domaine, de nom et de groupe aident à examiner les doublons ; ils ne prouvent aucune couverture mondiale ni identité. Une inspection HTTP n’est pas une collecte native d’offres et ne rend pas une ancienne validation obsolète.

Les orchestrations P3/B6 et la validation par volume fourni ont été supprimées. Le générateur ancien de preuve par recherche de sous-chaîne a également été retiré : un commentaire HTML pouvait lui suffire, sans lien vers le site ATS configuré. `raw-capture.mts` reste réservé à l’inspection et au rejeu des archives. Les alias d’identité et de promotion de l’ancienne CLI générale sont refusés. Les rapports historiques décrivent leur époque ; leurs anciennes commandes ne sont plus des procédures courantes.
