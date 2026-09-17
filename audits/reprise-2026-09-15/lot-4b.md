# Lot 4B — reprise revue et réversible des groupes

**Sous-lot validé localement. Le lot 4 complet reste en cours. Aucune modification des offres de production.**

## Résultat

Un seul moteur borné prépare et applique une répartition complète des publications. Il permet de séparer un ancien groupe, de regrouper des copies prouvées et de restaurer une ancienne Job absorbée. Chaque publication conserve son identifiant natif et son historique. Le [contrat maintenu](../../docs/architecture/publication-identity.md) donne le format de requête et les règles.

Le moteur ne reconstruit pas une annonce depuis le contenu partagé d’une autre annonce. Il lit sa sortie d’extraction immuable, vérifie ses octets, son RAW, son URL, son identifiant et son type d’adaptateur. Il recalcule ses faits et sa présentation depuis cette publication. Une preuve absente ou contradictoire demande une recollecte ou une revue.

## Garanties vérifiées

- Répartition complète : aucune publication omise, répétée ou ajoutée depuis un groupe hors périmètre.
- Regroupement : preuve native pour chaque paire ; refus des employeurs, types d’opportunité ou états de retrait incompatibles.
- Limites : 50 Job existantes, 200 publications, 32 Mo d’entrées non compressées. La taille des lignes est mesurée en base avant lecture de leur contenu et celle des archives avant téléchargement.
- Prévisualisation : transaction PostgreSQL `READ ONLY` à vue stable. Les archives sont préchargées avant la transaction ; aucun appel au stockage distant sous un verrou d’écriture.
- Application : comparaison de l’état courant avec le plan, verrouillage, transaction sérialisable, journal avant/après, répétition idempotente. Trois tentatives au maximum pour les conflits de sérialisation ou interblocages.
- Restauration : décision compensatrice `RESTORED` liée au plan et créée dans la même transaction que le rétablissement de la Job. Une décision ancienne ne peut pas être réutilisée.
- Historique : conservation des anciennes URLs, des événements `MERGED`, des identifiants et premières observations des publications. Le résolveur retourne à nouveau l’identifiant restauré.
- Publications inactives : une séparation ne les réactive pas. Une source retirée peut être réparée depuis ses archives ; une fermeture exige une expiration corroborée dans le RAW. Une date en cache non corroborée conduit à un retrait sans prétendre à une fermeture employeur.

La migration 54 ajoute la liaison transactionnelle aux nouvelles décisions et remplace l’interdiction absolue de restauration par cette règle compensatrice. Elle ne sépare aucun groupe et ne modifie aucune offre de production par elle-même.

## Nettoyage

Le `reconcile` global, ses tests propres et ses commandes npm/CLI sont supprimés. Les tests d’ingestion conservent leurs contrôles d’identité ; les opérations de maintenance passent par le plan. Les anciens noms `apply-domain-sheet` et `separate-fused` ont également été retirés du registre d’arguments CLI où l’audit les a retrouvés après suppression de leurs implémentations.

La recherche des autres chemins d’écriture a retrouvé le planificateur Oracle historique. Il est supprimé. Le réparateur générique refuse désormais les modifications de contenu, d’identité, de capture et d’appartenance d’une publication, sa réactivation et les redirections de Job. Il conserve uniquement les changements revus de priorité et les désactivations nécessaires aux dossiers d’employeur/retrait. Il interdit aussi les mutations imbriquées via une relation et les changements d’identifiant primaire. Des tests interdisent le contournement du nouveau parcours par ce réparateur.

La reconstruction de contenu s’appelle désormais `publicationJobContent`. L’archivage d’observation et la reprise utilisent le même lecteur de liaison à la capture. Le registre de familles de sources est typé avec les valeurs ATS réellement acceptées ; les captures conservent le type d’adaptateur, pas le nom de configuration du catalogue.

Les identifiants du service Railway `reconcile` restent uniquement dans les outils d’exploitation des services gelés, nécessaires pour contrôler son état jusqu’à la release.

## Répétition sur des extractions réelles

Deux groupes volontairement erronés ont été créés sur PostgreSQL local avec les publications extraites lors du lot 2 : Polène / Ashby et Amiri / Lever. Ce sont des scénarios de réparation, pas l’affirmation que ces Maisons avaient ces erreurs en production.

Les corps sont lus dans l’archive du bucket Railway de test et leur intégrité est vérifiée. Chaque publication retrouve son propre titre, sa description, son URL et son RAW. Les identifiants et premières observations restent inchangés. La répétition du même plan ne produit aucune nouvelle mutation. Les résultats exacts figurent dans la [preuve de reprise](preuves/lot-4b-shadow.json).

## Audit défensif

Les contre-épreuves réintroduisent : regroupement sans preuve, application d’un état devenu différent, plan falsifié, description empruntée, décision absente, décision écrite hors transaction, RAW différent de la capture, absence de limite de volume, restauration d’une URL sans publication d’origine, contournement direct ou imbriqué via le réparateur générique, réactivation d’une publication inactive, fermeture sans expiration corroborée et réutilisation d’une décision SQL d’une ancienne transaction.

Chaque défaut doit faire échouer une assertion de régression. Les sources de la copie de vérification et la fonction PostgreSQL sont restaurées, puis les tests repassent. Les scénarios couvrent aussi les applications concurrentes et une interruption pendant le transfert des publications.

## Limites restantes du lot 4

La reprise du stock distant n’a pas été exécutée. Ce moteur reconstruit à partir des sorties d’extraction conservées. Les groupes historiques sans cette sortie demandent un lecteur de rejeu qualifié de leur RAW, ou une recollecte si leur propre preuve ne permet pas la reconstruction. Le moteur donne une voie de réparation contrôlée ; sa présence ne prouve pas que les 1 433 groupes signalés au lot 4A ont tous été réparés.

La présentation complète par publication doit encore remplacer les mélanges possibles lors d’un changement de propriétaire à l’ingestion ou à l’expiration. La recherche par marché, les caches et redirections du website, les deux origines d’offres et la release restent à valider dans les lots correspondants. Aucun push, changement de cron ni déploiement n’est effectué dans ce sous-lot.

## Validation finale

2 878 tests réussis : 2 152 unitaires agrégateur, 472 intégration agrégateur, 249 API et 5 Python. Deux contrôles API optionnels restent ignorés, comme dans les lots précédents. Les 54 migrations passent sur une base vierge, les vérifications TypeScript et le build API réussissent, sans dérive de schéma. Les 14 contre-épreuves détectent leur défaut ; les versions restaurées repassent. Les 118 publications du scénario réel sont reconstruites sans écart et les plans sont idempotents, y compris via la commande d’exploitation.

## Preuves

- [Validation complète et empreintes des journaux](preuves/lot-4b-validation.json)
- [Reprise sur les extractions réelles](preuves/lot-4b-shadow.json)
- [Commande réelle : aperçu, application et répétition](preuves/lot-4b-cli-smoke.json)
- [Contre-épreuves du code](preuves/lot-4b-counterproofs.json)
- [Contre-épreuve de la fonction PostgreSQL](preuves/lot-4b-db-counterproof.json)
- [Préservation du travail préexistant](preuves/lot-4b-preservation.json)
