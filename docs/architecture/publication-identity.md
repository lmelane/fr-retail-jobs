# Identité des publications et rapprochements

## Identité native

Une publication est identifiée par `JobSource.id` et le couple unique `sourceKey` / `externalId`. PostgreSQL interdit leur modification. Le nom de l’employeur, le pays, la ville, le titre et la famille d’ATS peuvent évoluer sans remplacer cette identité. Deux tenants d’un même ATS peuvent publier le même identifiant externe.

`Job` sert aujourd’hui de groupe de présentation. La publication sélectionnée fournit le contenu complet et le lien de candidature ; aucun champ absent n’est emprunté à un autre membre. Ce groupe ne constitue pas une nouvelle vérité supérieure au RAW ; ses publications et observations restent distinctes.

## Règles d’écriture

1. Une publication déjà connue est réattestée par sa clé native.
2. Un rapprochement entre sources exige une identité de candidature qualifiée **et corroborée dans le RAW de chaque publication**. Pour Oracle HCM, le lecteur vérifie le site et `/list/Id`, sans contradiction de `/detail/Id`. Une copie LVMH doit porter `/link` et `/atsId` concordants. Pour JobAffinity, l’URL doit correspondre au champ natif `/board/row/attrs/data-applyurl`. Pour Workday, le lecteur vérifie l’hôte natif, le chemin de liste, l’URL du détail, `jobPostingId` et `jobPostingSiteId`, puis rapproche les réquisitions `jobReqId` identiques dans ce tenant. Chaque publication et chaque portail restent distincts. Une URL stockée seule ne suffit pas.
3. Oracle et JobAffinity acceptent leurs variantes de langue et de suivi qualifiées. Workday exige des URL sans query ni fragment ; seule la casse du segment de portail natif peut varier entre liste et détail. Le rapprochement de réquisitions Workday est limité aux hôtes HTTPS `tenant.wdN.myworkdayjobs.com`. Les domaines personnalisés demandent une qualification distincte. Un port non standard, des credentials, un hôte ressemblant ou un identifiant mal formé sont refusés.
4. Chaque membre du groupe doit avoir une preuve compatible avec chaque autre membre. Deux IDs différents d’une même source restent séparés. Un membre historique sans preuve interdit l’extension automatique du groupe. Une réattestation qui contredit la preuve du groupe est refusée ; la capture reçue reste conservée et le groupe doit être séparé ou revu.
5. L’employeur résolu doit être le même. Plusieurs groupes candidats ou une contradiction de type d’opportunité ne déclenchent pas le choix arbitraire d’un survivant.

Il n’existe plus de score Jaccard, de famille métier commune, de seuil de dates ou de proximité de titre autorisant une fusion. Même titre et même ville peuvent désigner plusieurs recrutements. Les formats d’URL non qualifiés restent dans leur espace d’identité source ; un simple lien commun vers une page carrière ne suffit pas.

`clusterKey` est une clé de recherche indexée calculée à partir de l’identité de candidature qualifiée, ou du couple source / identifiant. Ce n’est plus une clé employeur / ville. Une correction d’employeur ne réécrit pas cette clé. Les anciennes clés nécessitent une reprise dédiée avant la bascule. Le format persistant d’une clé est séparé de la version du lecteur de preuve : l’ajout de Workday ne renumérote pas les clés Oracle ou JobAffinity. Workday utilise un espace de clés de réquisition propre ; aucune réquisition n’est déduite du slug ou d’un suffixe numérique.

## Preuves et journal

Les nouvelles associations et déplacements automatiques sont inscrits dans `PublicationIdentityDecision`, dans la transaction de la modification. Chaque décision garde les publications, URLs, empreintes RAW, références de capture, ancien et nouveau groupe et version du lecteur. Le journal interdit les mises à jour et suppressions ; une correction doit ajouter une décision compensatrice.

Lorsqu’une sortie d’extraction native est référencée, l’écriture vérifie aussi que le RAW et l’URL de candidature correspondent aux octets de cette sortie conservée. Un bon identifiant de capture ne suffit pas si le contenu a changé. Le lecteur d’archive permet cette vérification après transfert vers S3, sous réserve de sa configuration.

Une réparation manuelle peut prouver une identité par les champs de l’émetteur et de la réquisition dans le RAW. Elle exige un témoin pour **chaque** publication impliquée, y compris celles déjà regroupées. Le même groupe cible ne peut recevoir des identités contradictoires. Ces réparations utilisent aussi le journal des décisions de publication, en plus de la revue employeur et de `DataCorrection`.

La réattestation relit ces chemins dans les RAW courants. Une ancienne revue ne vaut plus si l’émetteur, la réquisition ou la composition du groupe ont changé.

Le journal d’identité ne remplace pas les captures natives. Une empreinte du RAW historique n’atteste pas qu’une nouvelle collecte a eu lieu.

## Répartition revue et restauration des anciennes URLs

`scripts/ops/publication-groups.mts` est le parcours de réparation des groupes. Une requête nomme les Job existantes, la répartition **complète** de leurs publications et la raison de la revue. Elle couvre au maximum 50 Job existantes et 200 publications d’un même employeur, avec un budget de 32 Mo de données d’entrée non compressées. PostgreSQL mesure les lignes avant de transmettre leurs payloads à l’application ; les corps d’extraction ont également un budget vérifié avant lecture. Une destination sans `jobId` reçoit un nouvel identifiant dans le plan.

```json
{
  "jobIds": ["groupe-existant"],
  "groups": [
    { "jobId": "groupe-existant", "sourceIds": ["publication-a"] },
    { "sourceIds": ["publication-b"] }
  ],
  "reason": "Deux publications natives distinctes sans preuve de recrutement commun"
}
```

Le plan refuse les publications oubliées, répétées, appartenant à un autre groupe, les rapprochements non prouvés, les employeurs différents et les états de retrait incompatibles. Une ancienne Job répartie sur plusieurs destinations conserve son identifiant dans l’une d’elles. Une Job entièrement absorbée conserve son identifiant comme redirection.

Chaque publication membre reçoit sa propre présentation : titre, description, localisation et faits RAW. Le groupe reflète la publication sélectionnée et ses enrichissements recalculés. Le contenu de l’ancien groupe ne sert pas de repli. Une capture référencée est vérifiée et doit correspondre au RAW courant ; `CaptureBatch.sourceKind` contient le type d’adaptateur ATS, comparé au type déclaré par le registre courant. Sa retenue éventuelle reste bloquante. Avec ou sans capture, le lecteur actuel reconstruit ensuite la présentation depuis le RAW conservé et vérifie son format, son identité, son URL et son contenu. Une ancienne sortie d’adaptateur archivée ne dispense jamais de cette relecture. Le plan distingue `proof.captureOutputHash`, empreinte des octets archivés, et `outputHash`, empreinte de la reconstruction actuelle. Un RAW insuffisant est refusé avec un motif explicite ; le rejeu complet de réponses natives reste un parcours distinct.

Le plan contient son empreinte, la version du lecteur et les états observés. Sa préparation utilise une transaction `READ ONLY` à vue stable, après préchargement des corps d’extraction vérifiés. Son application recharge les preuves et refuse une modification de données, de configuration, de règles ou de disponibilité. Aucun téléchargement d’archive n’a lieu sous les verrous d’écriture. Une transaction sérialisable applique toute la répartition, les nouvelles présentations, leurs décisions et le relevé avant/après dans `DataCorrection`. Les conflits de transaction peuvent être relancés dans la limite de trois tentatives au total ; la répétition d’un plan appliqué ne produit aucun nouveau déplacement. Si une lecture d’archive échoue pendant qu’un autre processus termine le même plan, le journal est relu avant de conclure à un échec.

Les plans de maintenance sont transmis à PostgreSQL sous forme de texte JSON paramétré, puis comparés à leur empreinte après stockage. Le passage par une valeur JSON ou Float Prisma peut arrondir certains nombres finis et rompre l'égalité du plan (témoin : `48.775130000000004`). Les réparations de groupes et de faits conservent leurs nombres dans les caches et le journal ; leurs coordonnées SQL sont écrites depuis leur représentation textuelle. Le miroir RAW de la Job est copié directement depuis sa publication en PostgreSQL. La réparation de faits relit également les coordonnées SQL en texte pour ne pas proposer une nouvelle correction après une application correcte. Cette garantie décrit ces parcours de maintenance ; la vérification des autres écritures de collecte reste un critère de release.

Une redirection peut redevenir une Job autonome seulement avec une publication native identifiée dans son ancien propriétaire ou son journal de déplacement. PostgreSQL exige une décision `RESTORED` compensatrice, liée au plan immuable et créée dans **la même transaction**. Une décision d’une transaction précédente ne peut pas être réutilisée. Les anciens événements `MERGED` restent conservés. Le résolveur d’identifiants relit la chaîne courante ; la cohérence des caches et redirections du website reste à vérifier dans le lot public.

Une publication inactive peut être séparée sans être réactivée, y compris après retrait de sa source. La fermeture exige une expiration retrouvée dans son RAW et concordante avec sa date conservée ; une date en cache seule ne suffit pas. Sans preuve de fermeture, le nouveau groupe reste retiré (`SOURCE_RETIRED` ou `ATTESTATION_MISSING`). Les événements et dates d’action sont ajoutés à l’application du plan, sans inventer une date de fermeture employeur.

## Nettoyage et limites du lot en cours

Les commandes `apply-domain-sheet` et `separate-fused` ont été retirées. La première fusionnait des employeurs depuis une note textuelle sans le dossier de revue maintenu ; la seconde copiait le contenu du groupe lors d’une séparation, avec un risque d’attribuer le texte ou le lieu d’une autre publication. Leurs données historiques restent des éléments d’audit, pas des instructions exécutables.

Le `reconcile` global et ses commandes npm/CLI sont retirés au profit du plan borné ci-dessus. Les identifiants du service Railway gelé restent dans les outils de lecture/exploitation pour permettre son suivi jusqu’à la release. Aucun cron n’est activé par la réparation.

L’ancien planificateur de réparation Oracle est retiré. Le réparateur générique d’employeurs/retraits ne peut plus déplacer une `JobSource`, remplacer son RAW ou ses références de capture, la réactiver, ni modifier une redirection de Job. Ses seules modifications de publication admises sont une priorité connue et une désactivation. Il refuse aussi les modifications imbriquées via une relation Prisma et le changement d’identifiant primaire d’une entité. L’ingestion et les parcours de publication contrôlent les autres changements.

La [réparation d’employeurs revue](../employer-identity.md#réparer-sans-effacer-lhistorique) reste disponible. Le [sous-lot 4D1](../../audits/reprise-2026-09-15/lot-4d1.md) décrit la reprise historique : provenance `RETAINED_RAW` distincte de `NATIVE_CAPTURE`, empreintes, dates d’observation conservées et refus des formats insuffisants. Le plan version 3 et son relevé immuable n’inventent aucune capture HTTP ni attestation de fraîcheur. Une migration de schéma ne constitue pas une reprise de données. Le cache de présentation et ses changements de source sont décrits dans le [sous-lot 4C](../../audits/reprise-2026-09-15/lot-4c.md), dont la validation est distincte de la reprise effective du stock. Les crons et la production restent hors de cette validation locale.

## Présentation par publication

`JobSource.presentation` est une projection remplaçable de l’observation de cette publication. Elle est liée à son identité, son URL, sa capture lorsqu’elle existe, son empreinte d’entrée et la version du lecteur. Les métiers et séniorités restent des enrichissements calculés depuis son propre contenu avec la version active du catalogue.

Une modification de RAW, URL, titre, date ou référence de capture sans reconstruction invalide la projection en base. Le lecteur ne copie jamais un ancien texte de `Job` pour masquer une projection absente. La préparation et l’application des plans de maintenance incluent les empreintes de présentation ; un changement entre les deux exige une nouvelle revue.

L’ingestion, l’expiration et le retrait remplacent tous les champs de la projection de groupe lors d’un changement de publication. La lecture publique sélectionne la présentation et les faits de la même publication, y compris si une autre publication expire avant la maintenance. Une erreur de lecture retourne une indisponibilité, pas une fermeture employeur ni une activité supposée.

Les requêtes SQL et les compteurs n’ont pas encore été migrés vers le futur index commun par pays. Les critères de release incluent cette migration, le remplissage des projections du stock servi et la vérification des deux origines d’offres. Les données locales de répétition ne constituent pas cette bascule.

Le [sous-lot 4D2](../../audits/reprise-2026-09-15/lot-4d2.md) étend cette récupération au JSON-LD conservé d’iCIMS, Altamira et Radancy, avec liaison de la page, du portail et de l’identifiant natif. Un hub dont les fiches vivent sur des domaines distincts demande une qualification explicite de ce périmètre. Les règles ciblées de date et le contenu Recruitee sont partagés avec la collecte courante.
