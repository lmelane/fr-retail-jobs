# Identité des publications et rapprochements

## Identité native

Une publication est identifiée par `JobSource.id` et le couple unique `sourceKey` / `externalId`. PostgreSQL interdit leur modification. Le nom de l’employeur, le pays, la ville, le titre et la famille d’ATS peuvent évoluer sans remplacer cette identité. Deux tenants d’un même ATS peuvent publier le même identifiant externe.

`Job` sert aujourd’hui de groupe de présentation. Son propriétaire désigne la publication fournissant le lien de candidature. Ce groupe ne constitue pas une nouvelle vérité supérieure au RAW ; ses publications et observations restent distinctes.

## Règles d’écriture

1. Une publication déjà connue est réattestée par sa clé native.
2. Un rapprochement entre sources exige une identité de candidature qualifiée **et corroborée dans le RAW de chaque publication**. Pour Oracle HCM, le lecteur vérifie le site et `/list/Id`, sans contradiction de `/detail/Id`. Une copie LVMH doit porter `/link` et `/atsId` concordants. Pour JobAffinity, l’URL doit correspondre au champ natif `/board/row/attrs/data-applyurl`. Une URL stockée seule ne suffit pas.
3. La langue de l’URL et les paramètres de suivi ne changent pas cette identité. Un port non standard, des credentials, un hôte ressemblant ou un identifiant mal formé ne sont pas acceptés.
4. Chaque membre du groupe doit avoir une preuve compatible avec chaque autre membre. Deux IDs différents d’une même source restent séparés. Un membre historique sans preuve interdit l’extension automatique du groupe. Une réattestation qui contredit la preuve du groupe est refusée ; la capture reçue reste conservée et le groupe doit être séparé ou revu.
5. L’employeur résolu doit être le même. Plusieurs groupes candidats ou une contradiction de type d’opportunité ne déclenchent pas le choix arbitraire d’un survivant.

Il n’existe plus de score Jaccard, de famille métier commune, de seuil de dates ou de proximité de titre autorisant une fusion. Même titre et même ville peuvent désigner plusieurs recrutements. Les formats d’URL non qualifiés restent dans leur espace d’identité source ; un simple lien commun vers une page carrière ne suffit pas.

`clusterKey` est une clé de recherche indexée calculée à partir de l’identité de candidature qualifiée, ou du couple source / identifiant. Ce n’est plus une clé employeur / ville. Une correction d’employeur ne réécrit pas cette clé. Les anciennes clés nécessitent une reprise dédiée avant la bascule.

## Preuves et journal

Les nouvelles associations et déplacements automatiques sont inscrits dans `PublicationIdentityDecision`, dans la transaction de la modification. Chaque décision garde les publications, URLs, empreintes RAW, références de capture, ancien et nouveau groupe et version du lecteur. Le journal interdit les mises à jour et suppressions ; une correction doit ajouter une décision compensatrice.

Lorsqu’une sortie d’extraction native est référencée, l’écriture vérifie aussi que le RAW et l’URL de candidature correspondent aux octets de cette sortie conservée. Un bon identifiant de capture ne suffit pas si le contenu a changé. Le lecteur d’archive permet cette vérification après transfert vers S3, sous réserve de sa configuration.

Une réparation manuelle peut prouver une identité par les champs de l’émetteur et de la réquisition dans le RAW. Elle exige un témoin pour **chaque** publication impliquée, y compris celles déjà regroupées. Le même groupe cible ne peut recevoir des identités contradictoires. Ces réparations utilisent aussi le journal des décisions de publication, en plus de la revue employeur et de `DataCorrection`.

La réattestation relit ces chemins dans les RAW courants. Une ancienne revue ne vaut plus si l’émetteur, la réquisition ou la composition du groupe ont changé.

Le journal d’identité ne remplace pas les captures natives. Une empreinte du RAW historique n’atteste pas qu’une nouvelle collecte a eu lieu.

## Nettoyage et limites du lot en cours

Les commandes `apply-domain-sheet` et `separate-fused` ont été retirées. La première fusionnait des employeurs depuis une note textuelle sans le dossier de revue maintenu ; la seconde copiait le contenu du groupe lors d’une séparation, avec un risque d’attribuer le texte ou le lieu d’une autre publication. Leurs données historiques restent des éléments d’audit, pas des instructions exécutables.

La [réparation d’employeurs revue](../employer-identity.md#réparer-sans-effacer-lhistorique) reste disponible. La reprise des groupes historiques, les décisions durables de séparation, les anciennes redirections et la projection complète de chaque publication sont la suite du lot 4. Ils ne sont pas déclarés livrés par la suppression du moteur de similarité. Les crons et la production restent hors de cette validation locale.
