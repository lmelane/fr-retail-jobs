# Lot 5G1 — captures de pages d’identité et d’accès

Validé localement le 16 septembre 2026 : **3 354 tests passent**, build API réussi, onze mutations de code détectées et treize contre-épreuves SQL. Une page réelle est relue depuis l’archive Railway de test après retrait de ses corps locaux. La migration 64 est répétée sur le clone conservé. Aucun déploiement, changement de cron ni écriture en production.

## Résultat et frontière métier

La commande `source-onboard.mts evidence` archive une page avec un but explicite, `SOURCE_IDENTITY` ou `SOURCE_ACCESS`, une URL, la révision examinée et `--apply`. Elle réutilise les journaux, blocs, archives et protections de clôture existants. Le [guide des sources](../../docs/architecture/source-onboarding.md) décrit son utilisation.

Ces pages utilisent le format 3. Les extractions d’offres restent `JOBS`, formats 1 ou 2. Une capture de page ne possède ni sortie d’offre ni ordre de tentative d’offres ; elle n’invalide donc pas une collecte native qualifiée plus tôt. Les contrôles SQL et applicatifs interdisent de l’utiliser comme extraction, validation technique, publication ou observation d’offre.

**`SOURCE_EVIDENCE` signifie que les réponses sont archivées, sans certifier l’identité ou l’accès.** Un refus HTTP ou une page de challenge peut être conservé. Aucun verdict robots, aucune revue d’identité ni statut du registre n’est créé automatiquement.

## Fidélité et transport

- Le manifeste privé conserve l’URL initiale, les réponses et leurs empreintes dans l’ordre. Chaque redirection est archivée, jusqu’à six réponses. La lecture reconstruit la chaîne exacte, vérifie chaque corps et refuse un manifeste qui attribue la page à une autre URL.
- Les octets reçus avant une coupure sont conservés avec `complete=false`. Une erreur sans réponse conserve une tentative sans statut ni corps HTTP. Ces captures restent `FAILED`, consultables dans le statut, et ne peuvent être lues comme des preuves complètes.
- Les paramètres d’entrée sont copiés avant les lectures asynchrones. La capture reste liée à la révision examinée, même si le registre change pendant le transport. Une ancienne révision est refusée avant toute requête.
- Le budget d’exécution, la taille maximale de corps, la validation des destinations publiques et le limiteur partagé s’appliquent. Il n’y a ni retry ni amorçage WAF dans ce parcours. Les cookies sont conservés sous forme de noms uniquement ; les URLs exactes et destinations de redirection restent privées.
- Chaque saut alimente les compteurs de son hôte réel. Les refus ralentissent les appels suivants. Le délai explicite `Retry-After` n’est plus plafonné au maximum de huit secondes prévu pour le rythme adaptatif : trente secondes demandées par le serveur restent trente secondes pour le groupe de requêtes concerné. Les requêtes déjà en attente réservent un nouveau créneau après un refus plus récent. Les attentes dépassant 2³¹−1 ms sont découpées pour éviter le retour immédiat que provoquerait le dépassement de capacité des minuteurs Node.

Le statut présente les dix dernières captures de pages de la révision courante. Leurs dates servent à l’inspection, sans devenir un ordre de décision d’identité ou d’accès.

## Validation et audit défensif

| Contrôle | Résultat |
|---|---:|
| Tests unitaires agrégateur | 2 436 |
| Tests PostgreSQL | 648 |
| Tests API | 259, plus 2 tests de corpus séparés |
| Tests Python | 11 |
| Tests ciblés du parcours des sources | 207 |
| Types, build API, migrations depuis zéro | PASS, 64 migrations |
| Mutations de code détectées | 11 sur 11 |
| Contre-épreuves SQL annulées | 13 sur 13 |

Les mutations retirent successivement la copie immuable des options, la conservation des redirections, la comparaison manifeste/journal, le contrôle de l’URL, les octets partiels, la trace des requêtes échouées, la télémétrie, le ralentissement partagé et le respect du délai serveur, la prise en compte d’un refus après réservation d’un créneau et le découpage des délais dépassant la capacité d’un minuteur Node. Le test initial du ralentissement était trop faible : il acceptait l’espacement normal entre appels. Le témoin renforcé exige le délai demandé par le serveur et détecte désormais la régression. Les quatorze tests du module et les deux témoins d’attente repassent après restauration.

Les contre-épreuves SQL couvrent le format, l’ordre, la clôture, les journaux vides/incomplets/non contigus, les sorties d’offres, les validations, observations, publications et l’immutabilité du but. Chaque protection est retirée uniquement dans une transaction annulée ; la même écriture passe alors. Le cas d’ordre retire les deux protections redondantes, trigger et contrainte. Les définitions des triggers sont identiques après restauration. Les trous de séquence liés aux transactions annulées sont attendus.

Le test de la commande réelle ajoute une capture de page au parcours synthétique complet du lot 5F. Il utilise trois réponses HTTP synthétiques au total, dont deux pour la collecte d’offres ; le rejeu reste hors réseau et aucune offre n’est publiée.

Preuves : [validation](preuves/lot-5g1-validation.json), [mutations applicatives](preuves/lot-5g1-counterproofs.json), [contre-épreuves SQL](preuves/lot-5g1-sql-counterproofs.json), [concordance du runtime](preuves/lot-5g1-runtime-match.json).

## Page réelle et archive Railway

La page du board ATS configuré de Polène a répondu HTTP 200. **41 226 octets** et leur manifeste ont été archivés dans deux blocs sur le bucket Railway de test déjà isolé. Après vérification de l’absence de copies locales (les blocs déjà archivés restent dédupliqués), les octets, le journal et la destination sont identiques ; aucune nouvelle requête HTTP n’a été faite vers le site lors de cette lecture. La source de test reste DRAFT, sans sortie d’offre, qualification native ni revue d’identité. Cette expérience vérifie le transport et l’archive ; elle n’atteste pas la relation entre le site officiel et le tenant. Voir le [reçu réel](preuves/lot-5g1-live-s3-replay.json).

## Migration et préservation

Le clone passe de 63 à 64 migrations. Les empreintes de toutes les lignes et colonnes préexistantes comparées sont identiques : **87 607 offres, 90 764 publications, 141 933 observations, 536 sources, 536 révisions et 112 revues d’identité**. Ce clone ne contient aucune capture native ; la compatibilité des captures de formats 1 et 2 est vérifiée dans les tests PostgreSQL. Aucun rattachement ou ordre historique de revue n’est inventé. Voir la [comparaison du clone](preuves/lot-5g1-stock-migration.json).

Les 86 fichiers utilisateur sont contrôlés : 82 identiques, les quatre exceptions déjà intégrées aux lots précédents restent explicites dans le [rapport de préservation](preuves/lot-5g1-preservation.json). Les correctifs utilisateur non intégrés restent hors du commit ; le runtime testé les inclut et son empreinte ne désigne donc pas une release déployée.

La sauvegarde complète au schéma 60, restaurée au lot 5D, reste disponible. La reprise à l’état courant exige ensuite les migrations 61 à 64. Aucune nouvelle restauration complète n’est revendiquée. Les fichiers du lot et leur manifeste sont sauvegardés sous `backups/reprise-20260916-lot5g1/`.

## Suite nécessaire avant release

Le lot 5G2 doit vérifier un véritable lien officiel vers le tenant et le site ATS configurés, puis rattacher la revue à cette capture. Le lot 5G3 doit remplacer les verdicts d’accès mutables par des décisions immuables sur les cibles réellement appelées et distinguer les rôles de source. Les ingestions de sources déjà actives, l’ordre des observations et les preuves d’absence restent aussi à sécuriser. Ce lot ne constitue pas une certification globale de production.
