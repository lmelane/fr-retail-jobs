# Lot 4G2 — Réquisitions Workday et séparation des groupes historiques

**Validé le 16 septembre 2026 sur la copie locale complète. Aucune écriture de production.**

## Décision d’identité

La publication conserve toujours son `sourceKey`, son `externalId`, son RAW et son URL. Un même recrutement peut être publié sur plusieurs portails Workday : le groupe de présentation peut les réunir lorsque chaque RAW porte la même réquisition native dans le même tenant.

Le lecteur partagé vérifie le chemin de liste, l’identifiant externe et l’URL du détail, puis exige que `jobPostingId` et `jobPostingSiteId` concordent avec cette publication. Il lit ensuite `jobReqId` littéralement. Il ne retire aucun suffixe de slug et ne rapproche jamais des titres similaires. Les domaines personnalisés et hôtes ressemblants restent exclus de cette nouvelle règle.

La preuve porte la règle `QUALIFIED_REQUISITION_ID`, la version du lecteur et les chemins natifs. Les contrôles par paire, par employeur et contre les IDs distincts d’une même source restent applicables. Une réattestation contradictoire est refusée avant la modification du RAW conservé.

Le contrôle de liaison Workday est déplacé dans un module pur partagé par collecte, récupération et rapprochement ; son ancienne définition est supprimée. Les appelants de calcul de clé transmettent maintenant le RAW. La version du lecteur de preuve est séparée du format persistant des clés : les clés Oracle et JobAffinity existantes ne changent pas.

## Qualification native

Six publications actuelles sont relues sur trois paires de portails : Richemont, KnitWell et Fast Retailing. Les **12 réponses HTTP**, soit **57 363 octets**, sont capturées, rejouées hors ligne à l’identique et archivées avec vérification des empreintes dans le bucket Railway de test isolé. Ces captures de qualification ne créent aucune offre du catalogue.

## Périmètre revu

Le parcours en lecture seule couvre **19 910 groupes et 20 168 publications Workday**. Il qualifie 12 977 publications par réquisition. La reprise peut traiter **12 683 groupes existants et 12 934 publications** ; les groupes qui contiennent une publication insuffisante restent bloqués dans leur totalité.

Les **246 groupes Workday** retenus au lot 4G1 sont tous qualifiés : 222 portent une même réquisition, 24 mélangent des réquisitions différentes. Leur séparation produit **26 groupes supplémentaires**, en conservant chaque ancienne page avec sa publication propriétaire. Les 23 groupes Teamtailor attendent leur qualification distincte.

La prévisualisation contient **559 plans**, **12 709 groupes résultants**, aucune redirection ni changement de disponibilité. Pour les **12 437 groupes déjà reconstruits**, seuls `clusterKey` et `fingerprint` changent. Les autres corrections concernent les 246 groupes précédemment retenus : elles sont calculées depuis le RAW de la publication sélectionnée. Les corps complets des plans sont conservés et synchronisés sur disque avant application.

Les **7 227 groupes bloqués** ont des motifs explicites, qui peuvent se cumuler : détail non lié à la publication, RAW absent, retenue native, ancienne publication propriétaire absente ou membre d’une autre source dont le lecteur n’est pas qualifié. Ils ne sont pas couverts par la validation de cette reprise.

## Collisions révélées par les nouvelles clés

L’audit des plans trouve **217 réquisitions** réparties sur plusieurs pages d’un même employeur. Les **438 publications** concernées passent les contrôles natifs par paire, sans conflit de source, de retrait ou de type d’opportunité. Leur consolidation fait l’objet d’une deuxième prévisualisation après validation exhaustive de la première reprise. Le choix de page conservée privilégie une page active, puis une page antérieure à la séparation, l’ancienneté et enfin l’identifiant. Les 219 anciennes URLs deviennent des redirections vérifiées. Aucun identifiant de page n’est supprimé.

## Validation

Les **229 tests ciblés**, le typage et le build API passent. La suite complète compte **3 123 tests** : 2 336 unitaires, 528 d’intégration, 254 API et cinq Python ; deux tests API optionnels sont ignorés. Les **six contre-épreuves** détectent la suppression des liaisons liste/détail, identifiant de publication, portail, tenant, la déduction de réquisition depuis un slug et la perte de clé de recherche qualifiée.

Le témoin d’intégration sépare une fusion erronée de trois publications en deux réquisitions, conserve les RAW et dates natives, garde la page historique, journalise la séparation et rejoue le plan sans deuxième mutation.

Une sauvegarde privée de la copie complète précède la reprise : **1 001 458 563 octets**, catalogue d’archive vérifié. Les 559 plans ont été appliqués et rejoués : **12 709 groupes et 12 934 présentations vérifiés sans écart**, en 25 957 ms. Les 26 déplacements sont journalisés ; les RAW, identités natives, observations, anciennes pages et offres hors périmètre gardent leurs empreintes. Aucun changement de disponibilité ni événement de fermeture n’est produit. L’application séquentielle, contrôles d’intégrité compris, dure 381 850 ms. La base passe de 6 345 414 335 à 7 063 615 167 octets.

La deuxième étape applique et rejoue **16 plans** : 436 pages sont consolidées en 217 groupes, avec **219 redirections** et autant de déplacements journalisés. Sur 193 pages conservées, la publication directe devient propriétaire de la présentation selon la priorité maintenue ; son contenu complet reste issu de sa propre preuve. Tous les champs des publications, y compris leurs présentations, restent identiques hors rattachement au groupe. Les observations, anciennes identités de pages et données hors périmètre sont inchangées. Les 219 événements `MERGED` sont ajoutés une seule fois ; la consolidation, contrôles compris, dure 68 126 ms.

L’audit final relit les **575 plans**, les **12 490 groupes finaux** et les **12 934 présentations**, sans écart, en 25 016 ms. Il vérifie chaque miroir RAW, chaque partition et les preuves par paire. Les **278 redirections**, nouvelles et historiques, se résolvent sans cycle ni cible manquante. Il ne reste **aucune collision de clé dans cette cohorte qualifiée**.

## Preuves

- [Tests, contre-épreuves et bilan](preuves/lot-4g2-validation.json)
- [Captures natives et rejeu](preuves/lot-4g2-native.json), [archivage vérifié](preuves/lot-4g2-native-archive.json)
- [Périmètre qualifié et motifs de blocage](preuves/lot-4g2-stock-scope.json)
- [Prévisualisation de la reprise](preuves/lot-4g2-preview.json), [application](preuves/lot-4g2-stock-apply.json), [premier audit exhaustif](preuves/lot-4g2-stock-verification.json)
- [Prévisualisation des consolidations](preuves/lot-4g2-consolidation-preview.json), [application](preuves/lot-4g2-consolidation-apply.json)
- [Audit final et redirections](preuves/lot-4g2-final-verification.json)
- [Sauvegarde préalable](preuves/lot-4g2-backup.json), [sauvegarde des captures](preuves/lot-4g2-native-backup.json), [travaux locaux préservés](preuves/lot-4g2-preservation.json)

## Limites

Cette répétition reste locale et séquentielle. Elle ne qualifie pas les anciens RAW insuffisants, les alias Teamtailor, les groupes mixtes incomplets ou la recherche publique par pays. Les sources, filtres, coexistence avec les offres natives, sécurité et release restent dans les lots suivants.
