# Lot 4G3 — Publications Teamtailor sur plusieurs domaines

**Validé le 16 septembre 2026 sur la copie locale complète. Aucune écriture de production.**

## Identité qualifiée

La règle exige simultanément le UUID natif du flux, son identifiant numérique d’annonce, l’URL de cette publication et l’émetteur déclaré dans `hiringOrganization.sameAs`. L’identifiant numérique doit correspondre au chemin `/jobs/…`. L’émetteur doit être une origine HTTPS sans chemin ni paramètres. La publication doit être servie par cette origine ou par un sous-domaine natif Teamtailor. Un domaine ressemblant, une URL réécrite sans preuve, un simple nom de marque ou un titre similaire ne suffisent pas.

Les deux publications conservent leurs identités et URLs distinctes. La preuve `QUALIFIED_FEED_POSTING_ID` et la clé de recherche utilisent les identifiants natifs concordants ; les clés Workday, Oracle et JobAffinity ne changent pas. Le lecteur de preuve passe à la version 3, indépendamment du format persistant des clés.

## Preuve native

Les deux flux BZB sont capturés puis rejoués hors ligne. Ils publient **13 annonces communes**, avec les mêmes UUID, identifiants numériques et émetteur, et des URLs propres à leurs domaines. Les deux réponses, **250 871 octets**, sont archivées dans le bucket Railway isolé ; leurs empreintes sont vérifiées. Le lecteur actuel qualifie les 13 paires depuis les corps capturés. Cette qualification ne réatteste pas le stock historique et n’utilise pas l’absence d’une annonce pour la fermer.

## Périmètre et prévisualisation

Le contrôle couvre 5 739 groupes et 5 762 publications Teamtailor. Les **23 groupes historiques** retenus au lot 4G1 sont tous qualifiés. L’un est inactif et n’a plus de publication propriétaire identifiable dans ses anciennes colonnes ; son contenu peut être reconstruit depuis ses membres sans réactivation ni nouvelle attestation.

La reprise contient **263 plans, 4 823 groupes et 4 846 publications**. Elle ne déplace aucune publication et ne crée aucune redirection. Il n’existe aucune collision entre les clés qualifiées de cette cohorte.

Pour les **4 800 groupes déjà reconstruits**, seuls les clés et leurs empreintes changent, ainsi que la disponibilité de **six offres dont l’échéance native est passée** depuis la première reprise. Les six dates sont `2026-09-15T23:59:59+02:00`, retrouvées dans `$._jobposting.validThrough` et concordantes avec le cache d’expiration qualifié. Les autres corrections de contenu concernent uniquement les 23 groupes auparavant retenus.

Les 916 groupes hors de cette migration ont un motif explicite. **864 publications ne disposent pas de la preuve requise pour un rapprochement entre domaines** : l’identité propre à leur source reste utilisable quand leur contenu est qualifié. Ce refus d’équivalence n’est pas un motif de fermeture. Les groupes mixtes dont un membre n’a pas de contenu reconstructible restent à traiter séparément ; les motifs de refus peuvent se cumuler.

## Tests et protections

Les **249 tests ciblés**, le typage et le build API passent. La suite complète passe **3 143 tests** : 2 354 unitaires, 530 d’intégration, 254 API et cinq Python ; deux tests API optionnels sont ignorés. Les **six contre-épreuves** détectent une UUID non liée, une URL non liée, un identifiant numérique contradictoire, une origine étrangère, un émetteur ignoré et la perte de la clé qualifiée.

Le témoin de persistance conserve les deux URLs d’un groupe et refuse une réattestation contradictoire avant de modifier son RAW. Un second témoin reprend un groupe inactif sans propriétaire historique : il conserve l’indisponibilité, les dates natives et l’absence de preuve de fermeture employeur. Son plan se rejoue sans événement supplémentaire.

La sauvegarde préalable de la copie complète fait **1 086 974 460 octets**, avec catalogue d’archive vérifié. Les **263 plans sont appliqués et rejoués**, en 191 604 ms, contrôles d’intégrité compris. La relecture exhaustive vérifie **4 823 groupes et 4 846 présentations sans écart** en 8 620 ms : valeurs du plan, faits, miroir RAW, preuves d’identité par paire et champs natifs des journaux. Les RAW, dates d’attestation, observations, anciennes identités de pages et données hors périmètre gardent leurs empreintes. Les six événements `CLOSED` sont ajoutés une seule fois. Aucune publication ne change de groupe.

## Bilan du stock local

La copie contient désormais **52 390 présentations reconstruites** dans **51 468 groupes entièrement reconstruits**. Ces compteurs incluent le stock historique et ne sont pas un nombre d’offres actuellement disponibles. Les 269 groupes initialement retenus, couvrant 543 publications, ont tous une présentation propre vérifiée. Les 278 redirections sont conservées.

Il reste **1 224 publications reconstructibles dans 1 224 groupes mixtes** : leur partenaire n’est pas encore qualifié par le parcours de reconstruction actuel. La stratégie de reprise de ces groupes et les formats RAW encore insuffisants restent à traiter. Les requêtes publiques, sources, marchés, interface, sécurité et release ne sont pas validés par ce seul lot.

## Preuves

- [Tests et contre-épreuves](preuves/lot-4g3-validation.json)
- [Captures des deux flux](preuves/lot-4g3-native.json), [comparaison native](preuves/lot-4g3-native-comparison.json), [qualification actuelle et archivage](preuves/lot-4g3-native-archive.json)
- [Périmètre de reprise](preuves/lot-4g3-stock-scope.json), [prévisualisation](preuves/lot-4g3-preview.json), [revue des échéances](preuves/lot-4g3-expiry-review.json)
- [Application et rejeu](preuves/lot-4g3-stock-apply.json), [vérification exhaustive](preuves/lot-4g3-stock-verification.json), [bilan du stock](preuves/lot-4g3-stock-balance.json)
- [Sauvegarde préalable](preuves/lot-4g3-backup.json), [sauvegarde des captures](preuves/lot-4g3-native-backup.json), [travaux locaux préservés](preuves/lot-4g3-preservation.json)
