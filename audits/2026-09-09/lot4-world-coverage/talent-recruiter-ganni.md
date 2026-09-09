# GANNI / Talent Recruiter — correctif qualifié sur copie de production

État au 9 septembre 2026, 15:13 UTC. Ce point de contrôle ne clôture pas le Lot 4. Au moment de sa rédaction, le correctif décrit ici n'est pas encore déployé et la production GANNI n'a pas été modifiée.

## État avant et cause racine

La production conserve 77 390 offres, dont 74 159 actives et 10 952 classées France. Le portail `ganni.teamtailor.com` fournit onze annonces datées de 2024 contenant des descriptions de l'employeur Teamtailor, du texte de démonstration ou des instructions de rédaction d'annonces. Un tenant répondant sous un nom de marque avait été considéré comme une source exploitable sans établir sa relation avec le recrutement actuel de la marque.

La [page officielle GANNI](https://www.ganni.com/fr-fr/careers.html) pointe vers [Talent Recruiter, customer=ganni](https://candidate.hr-manager.net/vacancies/list.aspx?customer=ganni&uiculture=en). Ce dernier expose 16 entrées : **15 postes précis et une candidature spontanée**. Cinq postes se situent en France. Les identifiants des deux portails ne sont pas fusionnés et l'ancienne marque n'est pas réattribuée à Teamtailor.

## Correction générale

- Nouvel adaptateur **Talent Recruiter**, enregistré dans le registre commun à la discovery, la qualification et l'ingestion. Le nom désigne le produit, pas tous les produits commercialisés par Talentech/Grade.
- Protocole de l'[API publique documentée par l'éditeur](https://gradegroup.atlassian.net/wiki/spaces/DOCS/pages/2062844104/TR+Job+Portal+API+public) : `take`/`skip`, `incads=true`, quatre compteurs natifs contrôlés, identifiants uniques, aucun filtre géographique. Le rejeu réel en pages de cinq retrouve les mêmes 16 identifiants.
- `Published` est la seule date de publication utilisée. `Created` et le `pubDate` du RSS ne sont pas équivalents : le témoin réel présente un écart de 68 secondes. Les dates .NET sont interprétées en UTC sans ajouter leur suffixe une seconde fois.
- Les données publiques utiles sont conservées. Les listes d'utilisateurs et de participants au workflow ne sont pas nécessaires à la preuve du poste et ne sont pas enregistrées.
- `OpportunityType` distingue `JOB_OPENING` et `OPEN_APPLICATION`. Une candidature spontanée reste visible, porte un libellé français explicite et ne génère pas de balisage `JobPosting`. Sa date native de 2019 est conservée. Les emplois historiques non classifiés restent à `null` : aucune classification n'est inventée.
- Une différence explicite de type bloque la fusion, à l'ingestion comme au reconcile. Les changements de type sont historisés.
- Le pays du siège ou de l'arbre des départements n'est jamais utilisé comme pays du poste. Les noms explicites de pays dans les adresses publiées passent par un référentiel versionné de **5 925 libellés / 38 langues**, dérivé d'[Unicode CLDR](https://cldr.unicode.org/). Une collision linguistique telle que `Kongo` conserve plusieurs candidats et ne tranche pas.
- Un plan générique de retrait sur preuves archive la décision, retire les représentations, conserve l'employeur, les identifiants et les RAW, émet `WITHDRAWN` et `CORRECTED`, et ne crée aucun faux `CLOSED`. Un plan périmé ou une source active concurrente impose une nouvelle revue.
- Les garde-fous existants empêchent de réactiver un tenant retiré par réimport CSV, enregistrement de candidat ou promotion ordinaire. Une nouvelle source passe par DRAFT, alias examiné, preuve officielle datée et qualification native.

## Incident de validation locale et correction

Une invocation incorrecte `ingest-all --only=...` a révélé que la CLI ignorait les options inconnues. Le run local a été arrêté après environ 19 secondes : 82 sources commencées, 78 terminées, six créations et 138 mises à jour dans la copie locale. **Aucun run de production n'a été lancé.** L'ancienne copie est conservée séparément ; les preuves finales proviennent d'une nouvelle restauration de production.

La CLI valide désormais les options par commande avant l'initialisation de la base, de l'observabilité durable ou du réseau. Options inconnues, vides, répétées, valeurs numériques invalides et arguments positionnels inattendus échouent avec le code 2 et un événement structuré unique. Le témoin exécute la véritable CLI avec une base volontairement inaccessible et vérifie qu'aucun travail ne démarre. La syntaxe ciblée existante reste `ingest --source=<clé> --no-geocode` ; l'orchestrateur utilise `INGEST_ONLY_KEYS`.

## Preuves sur copie fraîche

Sauvegarde complète avant correction : 385 549 483 octets, SHA-256 `94e0e38602e18a1798b61c8543a71375b34a1e9ca553aa592e8cdce54a5d0a7f`.

| Mesure | Avant | Après sur copie |
|---|---:|---:|
| Identifiants conservés | 77 390 | 77 390 anciens + 16 nouveaux |
| Entrées actives | 74 159 | 74 164 |
| Entrées France | 10 952 | 10 957 |
| Anciennes annonces GANNI de démonstration actives | 11 | 0 |
| Postes GANNI natifs précis | 0 | 15 |
| Candidature spontanée native | 0 | 1 |
| Postes précis avec date et description natives | — | 15 / 15 |
| Entrées avec pays explicite extrait | — | 9 / 16 |
| Erreurs / fusions du nouveau flux | — | 0 / 0 |

Le retrait comporte 23 opérations : une source, onze représentations et onze états d'offres. Rejeu : zéro écriture. Tous les RAW et événements antérieurs sont conservés. L'alias `GANNI A/S` est attesté vers GANNI, classée BRAND ; le secteur FASHION passe par la procédure existante, sans parent de groupe supposé.

Deux runs natifs ciblés : le premier crée 16 entrées, le second les réatteste sans création. Les 17 requêtes HTTP de chaque run sont observées. Le premier refus conservateur de purge correspond à une nouvelle source, pas à une erreur de collecte.

Le corpus de comparaison des pays comporte 72 098 annonces de 425 flux/passes superposés, 59 272 valeurs pays et 264 libellés distincts. Quatre valeurs supplémentaires sont reconnues ; **aucun pays précédemment reconnu n'est changé**. Il ne s'agit pas de quatre offres de production corrigées : cette mesure porte sur les réponses source archivées.

## Limites encore ouvertes

- Six postes précis ont des coordonnées natives mais l'adresse de la carte ne contient qu'un identifiant Google Places. Boston est confirmé dans le contenu de la carte intégrée ; une solution générale de géographie avec provenance reste à finaliser. Ces six offres ne disparaissent pas, mais leur pays n'est pas encore enrichi. L'exhaustivité de la collecte n'est pas présentée comme une complétude géographique.
- Le balisage Google Jobs des offres historiques sans pays/description et la représentation des lieux multiples demandent encore un traitement global. Ce changement empêche seulement le balisage trompeur des candidatures spontanées explicitement classifiées.
- Lindex et Sport 1 présentent également des contenus de démonstration dans les anciens tenants. Leurs véritables portails sont retrouvés : [Lindex](https://about.lindex.com/career/open-positions/) utilise un flux EasyCruit de 41 postes ; [Sport 1](https://www.sport1.no/) renvoie vers [son portail carrière](https://karriere.sport1.no/) associé à ReachMee. Leur collecte/remédiation ne fait pas partie des preuves GANNI ci-dessus et reste à réaliser.

## Validation

1 583 tests unitaires, 249 tests d'intégration, typecheck des deux applications. Sept tests ciblés supplémentaires vérifient les transitions et preuves de retrait. Build web et inspection du cas réel de candidature spontanée sur desktop/mobile ; HTTP 200, aucun `JobPosting`, libellé visible, aucun débordement horizontal. Les tests de charge sont exclus.

**GO pour la livraison contrôlée de ce correctif ; NO-GO pour déclarer le Lot 4 terminé ou relancer tous les workers.** La preuve après production sera ajoutée après le déploiement et le run ciblé.
