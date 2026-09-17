# Lot 5G3B2 — décisions d’accès natives et immuables

**16 septembre 2026. Validé localement, schéma 67. Aucun push, déploiement, changement de production ou activation de CRON.** Le lot porte sur le contrat d’accès HTTP ; il ne certifie pas encore toutes les sources ni la préparation globale du produit à la production.

## Résultat

La promotion ne dépend plus d’un texte modifiable dans Source. `SourceAccessDecision` conserve la décision du réviseur, sa révision de source, le lecteur, la politique, le périmètre et les faits reconstruits depuis les captures brutes. La dernière décision enregistrée prévaut, y compris un refus. Rejouer un ancien dossier ne le replace pas devant une révocation.

Les règles robots observées, la qualification de surface publique et l’autorisation sectorielle déjà fournie restent distinctes. Un DISALLOWED observé demeure DISALLOWED. Les surfaces inconnues ne sont plus reconnues publiques par défaut. Chaque origine, chemin, méthode, paramètre et redirection est vérifié ; chaque méthode et nom de paramètre variable déclaré exige un témoin natif. Les valeurs variables permettent notamment la pagination dans le périmètre examiné.

Le contrat courant est limité aux requêtes HTTPS observées. Une capture historique sans provenance complète, un DOM dérivé ou un amorçage navigateur/WAF ne peut obtenir ce certificat. Les collectes gardent explicitement HTTP_ONLY, UNSUPPORTED_TRANSPORT ou l’absence historique de marqueur. L’inspection contrôle les corps, empreintes, manifests, buts et révisions, ainsi que l’identité réellement passée au transport. Elle refuse les faux documents robots, corps invalides et périmètres sans témoin.

Une ingestion liée à une source ACTIVE charge sa décision avant le batch et le premier appel HTTP. Chaque requête est contrôlée immédiatement avant son envoi. Le batch conserve la décision qui le gouverne. La publication vérifie cette décision sous verrou : une révocation ou une nouvelle révision bloque le résultat en cours. Un refus capturé par un adaptateur reste fatal pour sa collecte ; les traces des requêtes déjà parties sont conservées. Les appels déjà partis ne sont pas rappelés rétroactivement.

## Nettoyage et parcours

- Commande maintenue : `source-onboard access dossier.json`, aperçu par défaut, `--apply` pour enregistrer. Une révocation explicite peut être enregistrée sans inventer de capture.
- Promotion, statut, snapshots et rapports d’exploitation utilisent le même validateur. PostgreSQL choisit la dernière décision par source ; les rapports ne chargent pas l’historique entier en mémoire.
- Suppression de `Source.robotsVerdict`, `robotsCheckedAt`, de l’ancien prédicat ALLOWED annoté, de ses tests et des classements qui supposaient toutes les sources publiques.
- Retrait du champ robots du seed et du diagnostic associé. Les 83 configurations initiales restent identiques.
- Migration : verrou du registre avant lecture, copie exacte dans `SourceAccessArchive`, protection de l’historique en écriture, puis suppression des champs. Aucune note nominale d’autorisation n’est perdue ou transformée en preuve native.
- Mise à jour des guides [accès](../../docs/architecture/source-access.md), [onboarding](../../docs/architecture/source-onboarding.md), [capture](../../docs/architecture/native-capture.md) et [commandes ops](../../apps/aggregator/scripts/ops/README.md), vérifiés contre leurs appelants.

Les dossiers de revue, URLs privées et octets d’offres restent hors des rapports publics. Les diagnostics par première URL et les cassettes ont encore des consommateurs utiles ; ils ne délivrent aucune certification.

## Vérifications et audit défensif

La [validation](preuves/lot-5g3b2-validation.json) porte sur **3 565 tests réussis** : 2 585 unitaires, 710 d’intégration, 259 API et 11 Python. Deux tests API optionnels restent ignorés. Les types, le build API et les **67 migrations depuis une base neuve** passent.

Les [20 contre-épreuves](preuves/lot-5g3b2-counterproofs.json), soit 16 mutations applicatives et quatre SQL, échouent toutes comme attendu. Elles couvrent notamment les surfaces inconnues, origines, méthodes, paramètres, recouvrements, identité du collecteur, preuves robots, navigateur incomplet, dernier refus, collecte sans décision, publication d’une sonde, erreur avalée et protections d’immutabilité. **85 tests repassent après restauration du code et des gardes SQL.**

L’audit a reproduit puis corrigé trois défauts intermédiaires : perte du reçu déjà observé après refus d’une redirection ; ajout d’une méthode jamais vue à un périmètre connu ; ajout d’un nom de paramètre jamais vu. Les journaux RED puis GREEN sont conservés dans la sauvegarde privée et identifiés par empreinte dans la validation. Les tests de réparation utilisent désormais une revue native puis une nouvelle collecte autorisée, sans assouplissement de la porte.

Le [runtime vérifié](preuves/lot-5g3b2-runtime-match.json) contient 280 fichiers, identiques entre le répertoire de travail et la copie de vérification :

`local-sha256:ded5137c5e0f6dca5f4911dc3a88f86334fcf9654c7f2fb2d9fbce59e2a9b6be`

Cette empreinte inclut les travaux utilisateur conservés localement. Elle ne prétend pas certifier une image de release construite depuis le seul commit Git.

## Preuve native et archive Railway

La [preuve AMIRI / Lever](preuves/lot-5g3b2-live-access.json) observe **40 offres natives**, une requête au feed public et une requête robots. Les enveloppes archivées sont comparées aux arguments réels du transport. L’observation robots du feed est ALLOWED ; la décision reprend le fondement d’autorisation existant.

Les **six blocs nécessaires à l’inspection d’accès** sont envoyés sur le bucket Railway isolé, relus et purgés du stockage chaud. Deux réinspections rendent la même décision depuis le stockage froid, avec **zéro appel HTTP au portail**. Le SDK S3 continue naturellement à lire le bucket. La source reste DRAFT et inchangée : aucune offre publiée, aucune certification d’employeur ni activation implicite. Les sorties dérivées individuelles des offres ne font pas partie de cette purge d’accès.

## Migration sur la copie du stock

La [migration 66 → 67](preuves/lot-5g3b2-stock-migration.json) conserve exactement les lignes et colonnes maintenues de six tables :

| Table | Lignes conservées |
|---|---:|
| Job | 87 607 |
| JobSource | 90 764 |
| SourceObservation | 141 933 |
| Source | 536 |
| SourceRevision | 536 |
| SourceIdentityReview | 112 |

Les **536 notes historiques** et leurs dates ont une empreinte identique avant archivage et après migration. Aucun accord natif n’est fabriqué ; aucune source n’est activée. Cette copie ne contient pas de capture native historique. La restauration complète du dump de schéma 60, déjà répétée au lot 5D, n’est pas présentée comme refaite : sa reprise exige ensuite les migrations 61 à 67.

Les [travaux utilisateur](preuves/lot-5g3b2-preservation.json) sont préservés : **82 fichiers initiaux sur 86 inchangés**, quatre exceptions documentées et sauvegardées ; 83 configurations de seed intactes. Les trois fichiers utilisateur modifiés et les 25 fichiers non suivis initiaux restent hors du commit de ce lot.

## Suite avant release

La prochaine étape est le contrôle complet d’admission à l’ingestion : identité et qualification technique courantes, traitement explicite des anciens chemins sans liaison au registre, puis ordre de publication des collectes concurrentes et preuves d’absence liées à leur périmètre. Les contrats navigateur, autres preuves d’identité ATS/domaines personnalisés et rôles groupe/éditeur restent à qualifier. Les renouvellements de preuves et l’activation du CRON restent distincts.

Ce lot retire le circuit d’accès remplacé et fournit un refus explicite pour les cas non qualifiés. Il ne ferme pas ces écarts par une hypothèse ni par une déclaration générale « production-ready ».
