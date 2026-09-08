# FashionJobs → employeurs → sources directes : état réel du rapprochement

Relevés du **8 septembre 2026**. Annuaire à 18:09 UTC, base à 18:32 UTC, API à 18:50 UTC. Aucun test de charge. Aucune nouvelle source employeur activée par cette investigation.

**Les 749 entrées de l’annuaire observé ont été extraites, rapprochées de la base et soumises à un premier passage de découverte. Cela ne signifie pas que les 749 portails ont été trouvés, ni que leurs ATS sont validés.** L’annuaire contient aussi agences, cabinets, franchisés, entreprises hors secteur, plusieurs libellés d’une même marque et un employeur confidentiel. Il ne recense pas nécessairement tous les clients historiques de FashionJobs.

- [Inventaire complet, une ligne par entrée](annuaire-croise.csv)
- [Chiffres et empreinte du relevé](annuaire-summary.json)
- [Résultats des 749 tentatives et liens observés](discovery-evidence.json)
- [Décisions documentées sur les premiers dossiers prioritaires](identity-and-portal-decisions.json)
- [Preuve du flux direct Adopt](adopt-direct-proof.json)
- [État des corrections P0 déjà livrées](../remediation/ETAT-PRODUCTION.md)

## A. Ce qui est établi

| Production Catwalks | Nombre |
|---|---:|
| Offres actives, monde | 71 263 |
| Offres du filtre France | 9 634 |
| Fiches Company | 1 563 |
| Fiches Company avec offres actives | 1 039 |
| Sources ACTIVE après pause FashionJobs | 419 |
| Revues structurées d’identité VERIFIED dans le nouveau registre | 0 |

Les deux compteurs API France/monde correspondent exactement à la base : **écart 0** sur ces deux lectures, [preuve](front-count-proof.json). Cela valide le transport du compteur, pas la justesse du pays de chaque offre ni la complétude du marché.

Le nouveau registre d’identité est vide. Les 419 sources actives sont donc des sources historiques à recertifier ; « cataloguée » n’équivaut pas à « validée par la nouvelle procédure ». Des identités disposent de preuves documentaires dans les dossiers, sans que ces preuves soient encore inscrites dans ce registre.

La collecte des offres FashionJobs est **PAUSED en production**, conformément à la consigne de découverte uniquement. Une opération Source est journalisée ; les 1 206 Job et 1 206 JobSource ayant un historique FashionJobs sont préservés intégralement, vérifiés par empreinte des lignes. Parmi ces Job, 856 sont actifs, y compris ceux dont la représentation FashionJobs est déjà inactive. Le relevé antérieur comptait 757 représentations FashionJobs actives ; ce ne sont pas les mêmes populations.

Preuves : [application](pause-production-receipt.json), [conservation exacte](pause-production-proof.json), [seconde application : zéro écriture](pause-production-idempotence.json). La pause a été répétée sur la copie restaurée avant application. Aucun JobEvent CLOSED n’a été créé. Aucune autre Source du relevé ne contient une configuration FashionJobs.

## B. Ce qui reste incomplet

| Résultat du rapprochement des 749 entrées | Entrées |
|---|---:|
| Source directe cataloguée, à certifier | 82 |
| Marque reliée au portail groupe Oniverse, attribution à vérifier | 3 |
| Source cataloguée mais aucune source directe ACTIVE identifiée | 15 |
| Company présente sans source directe identifiée par ce rapprochement | 393 |
| Aucun rapprochement établi | 256 |
| **Total** | **749** |

**256 n’est pas un nombre de nouvelles Maisons confirmées.** C’est le nombre d’entrées non rapprochées après noms, alias, règles canoniques et décisions documentées. Les liens au catalogue sont recherchés même quand le portail n’a aucune offre correctement attribuée. Le rapprochement réunit les correspondances exactes et les règles de normalisation ; il expose les collisions au lieu de masquer une deuxième fiche.

Le premier passage a traité les 749 entrées. Il a trouvé des pages employeur lisibles pour 213 sujets et des liens carrière candidats pour **113 sujets**, sans certification automatique. 98 sites n’ont pas pu être lus ; 437 fiches FashionJobs ne fournissent pas de site exploitable au passage effectué ; 108 recherches sur les pages lues n’ont pas trouvé de lien carrière avec la méthode initiale ; 19 ont trouvé un indice ATS ; 86 ont trouvé des liens avec cette méthode ; une identité est confidentielle. Ces catégories décrivent les tentatives automatiques. Les liens ont ensuite été réextraits des pages archivées pour inclure les ATS externes et écarter les liens commerciaux « offres » : d’où les 113 candidats, qui ne sont pas 113 nouveaux ATS validés.

Les recherches manuelles peuvent dépasser les limites de ce premier passage : Adopt n’avait aucun lien dans sa fiche, mais son portail Flatchr a ensuite été retrouvé dans une publication officielle. **Une fiche sans lien n’est jamais une preuve d’absence de portail.** Les 749 lignes conservent le statut de recherche, les candidats, les preuves revues et la prochaine action. Les 113 candidats ne sont pas tous dans le secteur ni tous nouveaux.

## C. Ce qui était faux ou nécessite une vérification

1. **Compteur MAISON 1-2-3 : 340 au lieu de 40.** Le parseur concaténait la fin numérique du nom et le compteur dans le DOM. Le correctif retire les liens/noms avant lecture de la métadonnée. Le même HTML réel produit désormais 40 ; la somme des compteurs de l’annuaire passe de 5 950 à **5 650**. Trois tests de régression et les 1 362 tests unitaires passent, ainsi que le typecheck. Aucun chiffre de production Job n’a été réécrit pour ce correctif d’annuaire.
2. **5 650 n’est pas 8 269.** La somme des compteurs des 749 entrées n’égale pas le compteur général précédemment observé sur FashionJobs. Deux entrées n’ont pas de compteur. Nous ne disposons pas de leur inventaire d’offres et n’allons pas le scraper. Cet écart doit rester explicite ; on ne peut pas présenter cette somme comme le total exhaustif des offres France du concurrent.
3. **INTERSPORT : 577 dans l’annuaire, zéro offre France sous la fiche rapprochée.** Une source Teamtailor existe, avec cinq offres actives monde ; cela ne prouve pas qu’elle couvre le portail français. Le portail officiel `recrutement.intersport.fr` constitue un périmètre à qualifier séparément.
4. **Bompard n’est pas une nouvelle source manquante.** Le site officiel lie `careers.smartrecruiters.com/ERICBOMPARD`, et la source `eric-bompard` existe. Calzedonia, Intimissimi et Tezenis disposent du portail partagé Oniverse ; leurs volumes ne doivent pas être obtenus en attribuant toutes les offres du groupe à chaque marque.
5. Six rapprochements réunissent plusieurs fiches : LTD INTERNATIONAL/LTD, KSI RETAIL/KSI, POIRAY INTERNATIONAL/POIRAY, ELLE INTERNATIONAL/ELLE, FAIR FASHION AGENT INTERNATIONAL/FAIR FASHION AGENT, MYLO CONCEPT STORE/MYLO CONCEPT. **Aucune fusion automatique.** Les nombres du CSV portent sur les IDs candidats indiqués ; ne pas additionner toutes les lignes pour produire un total global, car plusieurs entrées peuvent partager un employeur ou un groupe.
6. Le détecteur historique de liens carrière peut accepter des promotions commerciales contenant « offres » et ignorer certains liens ATS externes. Le script de recherche utilise une extraction plus précise ; le comportement applicatif historique reste un point de remédiation distinct. Aucun résultat de détection seul ne vaut preuve d’identité.
7. La pause FashionJobs n’a pas retiré les offres historiques de l’affichage. Le relevé précédent comptait **588 offres France uniquement représentées par FashionJobs**. Elles doivent être réattestées à la source directe ou faire l’objet d’un retrait de publication explicite et journalisé, sans inventer une fermeture employeur. La fraîcheur de ce stock n’est pas certifiée par cette recherche.

## D. Premiers portails prioritaires retrouvés

| Employeur / enseigne | Annuaire | Source directe ou piste prouvée | État |
|---|---:|---|---|
| Adopt Parfums | 43 | [Flatchr](https://adopt.flatchr.io/fr/company/adopt/) | 121 publications et 121 réquisitions distinctes ; **82 France**, 28 Italie, 7 Belgique, 4 Canada. Zéro offre dans la base sous cette identité. Flux à intégrer. |
| Armor-lux | 83 | [WeRecruit](https://careers.werecruit.io/fr/armor-lux), lié par [le site officiel](https://www.armorlux.com/) | Identité et lien prouvés ; lecture complète/connexion à valider. |
| Skechers | 31 | [Carrières officielles](https://careers.skechers.com/fr/fr/) | Phenom observé ; flux et couverture France à valider. |
| Hugo Boss France | 20 | [Carrières officielles](https://careers.hugoboss.com/global/en) | Lien officiel et Phenom observés ; source directe à intégrer. |
| Gérard Darel | 23 | [Taleez](https://gerarddarel.taleez.com/), lié dans le footer de [la page officielle](https://gerarddarel.com/fr-fr/recruitment) | Le corps de page cite FashionJobs, le footer Taleez. Accès et séparation Gérard Darel/Pablo à valider. |
| Intersport / Blackstore | 577 / 66 | [Portail France Intersport](https://recrutement.intersport.fr/), avec offres Blackstore | Périmètre France distinct à qualifier ; candidat Blackstore/Intuition à relier formellement. |
| Bompard | 26 | [SmartRecruiters](https://careers.smartrecruiters.com/ERICBOMPARD) | Source existante, problème de rapprochement/alias. |
| Calzedonia / Intimissimi / Tezenis | 41 / 31 / 20 | [Oniverse](https://www.oniverse.it/en/careers/join-oniverse) | Portail groupe existant ; attribution par marque à mesurer. |
| Zadig & Voltaire | 47 | [Page recrutement officielle](https://zadig-et-voltaire.com/eu/fr/content/job-recruitment) | Canal de candidature identifié ; flux public à retrouver. |

Pour Adopt, le lien Flatchr est publié par [le compte de la marque](https://fr.linkedin.com/posts/adoptparfums_alternance-adoptparfums-emasup-activity-7348719608440262656-60bk). Le site Flatchr renvoie à adopt.com et expose ses 121 publications dans le JSON de la page réellement lue. Les statuts sont tous `published`. Le total France de 82 provient de `vacancy.address.country = France`, sans géographie devinée. Le fait que 82 soit supérieur à 43 est un signal favorable ; il ne prouve pas le recouvrement exact des deux inventaires.

## E. Suite, dans l’ordre

1. **P1 — vérité du stock existant :** recertifier les sources actives prioritaires, isoler les portails nationaux et les marques de groupe, traiter les six collisions d’identité et la dette de fraîcheur FashionJobs. Les corrections P0 déjà livrées restent documentées dans le rapport de production précédent.
2. **P2 — découverte exhaustive à poursuivre :** rechercher les portails des sujets sans lien, résoudre les blocages des sites, qualifier agences/franchises/hors secteur, puis examiner les 113 ensembles de liens candidats. Aucune absence de domaine ne doit devenir « marque non prouvée ».
3. **P2 — ajout contrôlé :** identité canonique et alias documentés → groupe/enseigne avec preuve → lien officiel vers tenant → extraction réelle complète → pays et propriétaire de chaque publication → déduplication → preuve de complétude et de fermeture → revue d’identité structurée liée à la configuration → activation contrôlée → preuve en production. Réutiliser les portails partagés et les adaptateurs existants avant de créer une nouvelle Source.
4. **Comparaison permanente :** par employeur et pays, conserver compteur FashionJobs daté, réquisitions uniques de la source directe, stock ingéré, stock publié et écart. Un ratio inférieur à 1 ouvre une investigation. Il ne déclenche ni fusion incertaine ni inclusion d’offres fermées ou hors pays pour atteindre une parité artificielle. Une égalité de volumes seule ne prouve pas l’identité des offres.

Procédure technique existante : `apps/aggregator/src/connectors/sourceStore.ts`, `sourceIdentity.ts`, `apps/aggregator/src/discovery/validateDiscovered.ts` et `promoteValidated.ts`. **SourceIdentityReview est obligatoire pour une nouvelle activation ; aucun des dossiers de ce rapport n’a été activé automatiquement.**

## Reproductibilité et séparation audit / remédiation

`export-production.mts` lit la base dans une transaction READ ONLY. Après indisponibilité du proxy PostgreSQL public, le même code a été exécuté via SSH dans le service Railway ; le relevé est donc toujours une lecture réelle de production. Aucun secret ne figure dans les livrables.

`build-inventory.mts` reprend le HTML daté conservé, le relevé de production et les décisions documentées. `research-portals.mts` est reprenable et ne possède pas d’écriture DB : il lit des sites officiels candidats et uniquement les métadonnées d’identité des profils FashionJobs. Il ne visite pas leurs offres. `extract-evidence.mts` réextrait les liens des pages employeur archivées. Les pages complètes et exports DB restent dans le répertoire privé ignoré `backups/remediation-20260908` ; les preuves publiées comportent URLs, dates et empreintes.

| Finding | Fixé ? | Commit / main / déploiement | Données réparées ? | Preuve |
|---|---|---|---|---|
| FashionJobs utilisé comme collecteur d’offres | Oui, source en pause | Mécanisme de réparation déjà sur main, exécuté au commit `9d763a2d6acc5a50a0c65e6f6d2596aab68efd02` | Configuration Source uniquement ; historique préservé | `pause-production-proof.json` |
| Compteur MAISON 1-2-3 erroné dans l’annuaire | Correctif et témoin local passent | Voir `delivery.json` pour commit, main et déploiement exacts | Recalcul du dossier d’audit ; aucun Job modifié | `annuaire-summary.json` |
| Couverture des 749 entrées | Inventaire complet ; qualification des portails incomplète | Rapport, pas activation | Non | `annuaire-croise.csv` |
| Sources directes nouvellement découvertes | Dossiers documentés ; intégration non réalisée | Aucune source nouvelle déployée/activée | Non | `identity-and-portal-decisions.json` |

Le chantier de couverture mondiale n’est pas déclaré terminé. Ce livrable établit la liste complète observée, les écarts mesurés et le travail restant, sans confondre découverte, preuve d’identité et fonctionnement en production.
