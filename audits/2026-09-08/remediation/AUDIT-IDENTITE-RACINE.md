# Audit de la chaîne d’identité employeur — 8 septembre 2026

Constat : le problème dépasse SMCP. La chaîne confond une identité commerciale, un nom de portail ATS, la disponibilité technique du flux et l’attribution de chaque offre. Ces quatre assertions nécessitent des preuves différentes.

Mesures en lecture seule sur la production à 19 h 31–19 h 35 (Paris). Aucune correction de production exécutée à cet instant. Les répétitions de réparation citées ailleurs concernent une copie restaurée, pas la production.

## Résultats mesurés

| Mesure | Résultat | Interprétation |
|---|---:|---|
| Fiches Company | 1 556 | Identités enregistrées ; pas un nombre de Maisons certifiées |
| Fiches avec offres actives | 1 054 | Présence de données, pas validation d’identité |
| Offres actives | 71 636 | Avant remédiation |
| Sources ACTIVE | 440 | Toutes ont un compteur de validation technique positif |
| Sources portant une seule trace historique `validated-name` | 198 | Leur admission historique est fondée sur une correspondance de nom |
| Offres actives de ces 198 sources | 7 549 | Population à contrôler ; pas 7 549 erreurs démontrées |
| Portails d’employeurs homonymes contradictoires confirmés | 20 | Détail et URLs officielles dans le tableau des homonymes |
| Offres actives correspondantes | 371 | Aucun de ces Jobs n’a une autre source active hors de ces 20 portails |
| `Company.kind = UNKNOWN` | 1 556 / 1 556 | Impossible de donner une répartition fiable Maison / groupe / enseigne à partir de cette colonne |
| Fiches sans empreinte d’une source actuellement ACTIVE | 343 | Vérification séparée de la présence d’offres |

Le rapprochement utilise la clé de tenant, pas seulement le nom. Sur les 440 sources : 198 `validated-name`, 84 `anchored`, 13 `validated-domain`, 7 `validated-arbitrated`, 6 avec plusieurs archives correspondantes et 132 sans correspondance dans ce fichier historique particulier. Ces 132 ne sont PAS déclarées fausses : l’archive examinée n’est pas un registre exhaustif de preuves.

## Causes démontrées

1. **Le rapport fabriquait le statut d’identité à partir de la présence du domaine.** `reaudit/build-candidates.py`, fonction `add` : domaine vide → `A_CONFIRMER`, domaine non vide → `DOMAINE_ET_IDENTITE_DOCUMENTES`. La preuve de groupe n’intervenait pas. C’est une erreur de méthode dans mon rapport. Les quatre marques sont explicitement nommées par [SMCP](https://www.smcp.com/fr/marques/). Une marque peut être prouvée par son groupe sans domaine propre renseigné.

2. **La découverte essaie des identifiants ATS dérivés du nom et leur attribue une confiance 0,9 lorsqu’ils renvoient des offres.** `src/discovery/atsProbe.ts`, `probeAtsBySlug`. Cela démontre un portail existant, sans démontrer l’identité du propriétaire. Le domaine attendu du roster peut être disponible mais n’est pas lié au résultat du slug probe.

3. **Le contrôle d’identité accepte le nom du portail comme preuve suffisante.** `src/discovery/gateDiscovered.ts`, `gateSlugRow` : `namesMatch` donne `validated-name`. Les 20 portails erronés figurent effectivement sous ce statut dans `data/sources.gated.csv`. L’arbitrage entre plusieurs marques utilisant le même portail reste une comparaison de noms.

4. **Un autre chemin se déclare « ancré » par absence d’une expression dans une note.** Le même script classe toutes les lignes dont `robotsVerdict` ne contient pas `slug probe` comme `anchored`, sans vérifier une pièce de preuve. `identityScore.ts` ajoute aussi des scores de nom et domaine ; son calcul approximatif des domaines par deux derniers labels et sa recherche de sous-chaînes ne prouvent pas une propriété juridique. Ces scores ne sont pas des probabilités calibrées.

5. **L’activation ne requiert aucune preuve d’identité.** `connectors/sourceStore.ts`, `promoteSource` : configuration, robots ALLOWED daté et compteur > 0 suffisent. `promoteValidated.ts` charge le catalogue via `loadRows`, qui ne lit même pas sa colonne `verified`. Le rapport technique est rapproché par `maison|kind`, sans empreinte du tenant/configuration ni date obligatoire. Le statut enum VALIDATED décrit une identité « anchored », mais ce contrôle n’est pas imposé.

6. **L’ingestion fait ensuite confiance au libellé de catalogue.** `pipeline/ingest.ts` : `job.company || sourceDef.company`. Les flux employeur sont considérés dans le secteur « par construction ». Pour SMCP, la configuration contient déjà `brandFacet: customField fieldLabel=Brands`, mais l’adaptateur déployé ne l’utilise pas. Sur 557 offres : Sandro 102, Maje 148, Claudie Pierlot 69, Fursac 35, SMCP 23, marque absente du RAW conservé 180. Toutes sont stockées sous Sandro. Les 275 attributions contradictoires sont explicites ; les 180 autres ne doivent pas être inventées.

7. **Les domaines sont corrigés séparément sans rattacher l’ATS.** `applyDomainSheet.ts` applique le statut IDENTIFIÉ du référentiel par nom. Ainsi un vrai domaine de mode peut être posé sur les offres du mauvais homonyme : Coast → coastfashion.com, TALA → wearetala.com, Gate → gate.shop, alors que leurs portails collectés recrutent pour des entreprises financières. La validation du logo ne valide pas l’employeur des offres.

8. **Le modèle ne conserve pas un dossier d’identité opposable à l’activation.** Source est liée aux offres par une clé textuelle ; aucune relation qualifiée n’atteste « ce tenant appartient à ce groupe / publie pour ces marques ». La résolution `resolveCompany(rawName)` est globale, sans contexte de source. CompanyAlias a une clé globale unique. `upsert.ts` écrit le secteur et le groupe mais jamais `kind`, ce qui explique les 1 556 UNKNOWN. Un score global ne peut réparer ces relations manquantes.

## Autres frontières groupe / marque à corriger

| Source actuelle | Portail configuré | Offres actives | Constat |
|---|---|---:|---|
| Sandro | SmartRecruiters SMCP | 557 | Attribution de marques ignorée, erreur démontrée |
| Parfums Chanel | Workday ChanelCareers | 1 117 | Portail général étiqueté comme une branche |
| L’Oréal Professionnel | careers.loreal.com | 1 804 | Portail groupe étiqueté comme une marque |
| Browns | Lever farfetch | 65 | Identité de portail différente ; attribution fine à reprendre |

Ces volumes ne sont pas additionnés aux 371 sans distinguer la nature des anomalies.

## Réponse sur les « nouvelles Maisons confirmées »

38 dossiers = **34 dossiers d’extension ou de meilleure couverture + 4 corrections d’attribution SMCP**. Parmi les 34, **30 identités ne sont pas retrouvées par nom, clé canonique ou alias dans Company** ; Rouje, Inditex, Lefties et Fusalp existent déjà. Absence de fiche ne prouve pas absence de toute offre dans un flux de groupe. **Aucune nouvelle source de ce lot n’a été activée.**

La qualification corrigée sépare les preuves d’identité, le groupe parent, la présence en base et la validation technique. La piste « Atelier du Sourcil → NOVI » du premier inventaire est rejetée : [IEVA Group](https://ievagroup.com/atelier-du-sourcil-boudoir-du-regard/) et [la marque](https://www.atelierdusourcil.com/pages/notre-univers) établissent le bon rattachement. Les enseignes Inditex sont explicitement nommées par [Inditex People](https://www.inditexpeople.com/fr/fr).

## Corrections requises, dans l’ordre

- P0 : imposer une preuve d’identité distincte de la validation technique lors de toute nouvelle activation ; nom similaire, domaine supposé ou compteur positif ne suffisent jamais.
- P0 : journaliser et réparer les cohortes confirmées (Oracle, SMCP, homonymes), conserver RAW, IDs et historique ; prouver avant/après en production.
- P0 : revoir les 198 sources admises par le nom. Garder trois états explicites : preuve suffisante, contradiction démontrée, non résolu. Ne pas retirer 7 549 offres parce qu’une archive manque.
- P1 : formaliser propriétaire du tenant, marques publiées, employeur déclaré par offre et groupe parent comme relations distinctes ; qualifier les types Company.
- P1 : afficher et mesurer les validations d’identité et techniques séparément ; produire les compteurs depuis la même définition.
- P2 : activer les nouvelles sources uniquement après ces contrôles.

## Limites et traçabilité

Audit du code et rapprochement exhaustif des 440 sources avec les archives disponibles. Vérification documentaire ciblée des contradictions ; ce n’est pas encore une certification individuelle des 440 propriétaires. Aucun load test, aucune simulation de charge, aucune donnée de production modifiée pour cet audit.

Preuves : `coverage-status.sql`, `coverage-current-summary.json`, `identity-scope.json`, `sources-identite-trace.csv`, `homonymes-confirmes.csv`, `couverture-qualifiee.csv`. Les snapshots complets restent privés dans `backups/remediation-20260908/` ; les scripts ne les publient pas.
