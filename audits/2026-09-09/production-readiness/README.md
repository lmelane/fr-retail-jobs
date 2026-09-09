# Catwalks / ModeCareers — état de remédiation et critères de reprise

Le chantier n'est pas certifié « production-ready à 100 % ». Plusieurs défauts réels ont été corrigés, fusionnés et livrés ; la couverture mondiale et la provenance complète restent inachevées. Aucun run global ni ingestion ciblée n'a été relancé pendant ce lot. Les validations ATS ont lu les sources réelles sans ajouter d'offres en production.

## Chiffres de production après réparation — 2026-09-09T05:20:06.088Z

| Mesure | Valeur | Interprétation |
|---|---:|---|
| Offres actives | 74 113 | Statut actif stocké  pas ouverture indépendante de chaque poste certifiée |
| France canonique et filtre | 10 936 | Zéro divergence du drapeau après réparation |
| Offres avec source directe active | 71 343 | Selon JobSource active et Source active de tier direct/ATS/groupe |
| France avec source directe active | 8 941 | Les 1 995 autres offres France n'ont pas cette représentation active |
| Pays renseigné | 69 245 / 74 113 (93.43 %) | Remplissage  pas exactitude certifiée |
| Métier canonique renseigné | 68 808 / 74 113 (92.84 %) | Qualité sémantique à distinguer de la présence du champ |
| Sans date de publication | 1 411 | Pas de remplacement par firstSeenAt |
| Dates futures actives | 0 | Après correction Douglas |
| Offres sans clé employeur canonique | 0 | Une clé présente ne prouve pas la justesse de l'identité |
| Company enregistrées | 1 571 | 1 047 ont des offres actives ; 784 ont au moins une offre directe active |
| Sources | 500 | 424 ACTIVE  8 PAUSED  68 RETIRED ; la maintenance du worker est un état distinct |
| Familles d'implémentation actives | 39 | Inclut ATS et collecteurs dédiés ; ce ne sont pas 39 éditeurs ATS distincts |

Le type d'entité reste `UNKNOWN` sur **1 534 Company**. Les champs renseignés comptent 8 MAISON  7 RETAILER  2 GROUP et 20 OTHER ; **37 libellés de groupe parent** sont utilisés. Cette lacune de typologie ne signifie pas que seules huit marques sont prouvées. Le décompte mondial fiable Maison/enseigne/groupe reste à compléter avec des identités et relations documentées.

La page publique `/emplois?pays=FR` affiche 10 936 offres dans son HTML rendu (`../france-filter/ssr-proof.json`). Pour FR, US, GB, DE, IT, ES et CA, les totaux API correspondent exactement aux comptes SQL : zéro écart. Les 25 premières offres de chacun des sept résultats portent le pays attendu ; cela ne remplace pas une revue sémantique des localisations ni un rejeu de toute pagination (`country-api-proof.json`).

`production-snapshot.json` contient toute la répartition pays et métiers ainsi que les populations à revoir. Le nombre d'entités sans portail actif n'est pas certifié par ce lot : l'absence d'offre directe active peut aussi correspondre à un portail vide ou à une Maison servie par un flux groupe. Nous n'assimilons pas ces cas.

## A. Ce qui est établi

**Incident Railway.** Le build du déploiement `7b17182e-b713-4bbb-ab25-5f506201ca11` a réussi. Le run a terminé les 424 sources le 8 septembre à 22:49:47 UTC : 423 sans exception, une en erreur, zéro timeout. L'Oréal a retourné HTTP 406 à l'offset 240. Le processus a alors rendu le code d'échec prévu ; le statut Railway CRASHED ne prouve pas un build interrompu. Les 1 804 représentations L'Oréal actives ont été conservées, avec zéro fermeture dans la fenêtre du run. Le résumé JSON massif a aussi fait perdre 2 925 messages au plafond Railway ; il n'est pas démontré que ce plafond ait arrêté le processus.

**Corrections livrées.** Les journaux de fin sont bornés et structurés. L'Oréal suit le mécanisme AJAX officiel et tolère de façon bornée son 406 sur le listing ; Teamtailor vérifie son contrat de flux et sa pagination ; TalentView énumère toutes les pages et tous les sites publics du tenant. Les erreurs et troncatures restent visibles et ne deviennent pas un droit de fermer les offres absentes.

**Dates Douglas.** Treize Job et treize JobSource réparés depuis leur RAW et locale enregistrés. Vingt-six lignes DataCorrection, treize événements CORRECTED, RAW et ancien historique préservés, zéro écriture au second passage. Les cinq dates futures actives sont devenues zéro. Deux pages publiques exposent les dates corrigées dans leur JSON-LD. Les dates inconnues ne sont pas inventées.

**Filtre France.** Voir le dossier `../france-filter/` pour les témoins publics avant/après et les garanties de réparation. Le lot ne change aucune géographie : il corrige uniquement deux drapeaux dérivés incohérents.

## B. Ce qui reste incomplet

Le dernier run de production ne contient que **179 attestations de balayage complet sur 424 sources**. Les 245 sources DEGRADED ne sont pas toutes cassées : beaucoup fournissent des offres, mais le programme ne peut pas encore prouver l'exhaustivité. Les correctifs Teamtailor/TalentView/L'Oréal ont des preuves réelles de lecture, mais aucune nouvelle attestation d'ingestion en production après déploiement.

Validations de lecture : L'Oréal **1 726 IDs uniques**, Teamtailor **122 flux / 5 180 représentations**, TalentView **150 campagnes** sur les quatre sources existantes, contre 35 dans le dernier run ; Sud Express **68 campagnes** sur sept pages. Ce ne sont ni des créations nettes en base ni une garantie de postes ouverts : une campagne peut être une candidature spontanée.

Après ces correctifs, les autres familles encore non attestées dans le dernier run incluent **SuccessFactors 30, Personio 23, Recruitee 22, generic-listing 16**, puis les familles plus petites. Les 1 411 dates inconnues, 4 868 pays manquants, 5 305 métiers non classés et la provenance de séniorité restent ouverts. Le taux de remplissage ne mesure pas la justesse.

## C. Ce qui demande une correction ou une qualification supplémentaire

- **61 offres actives avec validThrough passé** et **1 348 non revues depuis plus de 48 h**, à la mesure du matin. Ce sont des populations à vérifier à la source, pas une autorisation de fermeture groupée.
- **16 titres candidats de candidatures spontanées / viviers** : revoir l'éligibilité JobPosting et la distinction campagne/poste. Les IDs sont conservés dans `production-snapshot.json` ; aucune fermeture sur une simple expression régulière.
- **53 552 séniorités MID** : le code historique utilisait ce niveau par défaut. Ne pas les considérer comme toutes prouvées, ni comme toutes fausses. Rejouer la règle avec une provenance par champ.
- **178 admissions historiques d'identité / 7 178 offres** recensées dans l'audit précédent restent à recertifier. Ce ne sont pas 7 178 erreurs d'employeur démontrées.
- Les codes géographiques ambigus (CA, AR, AZ, NH…) exigent une preuve indépendante. Un suffixe ne suffit pas ; aucune table de correction forcée n'est introduite.
- Les dates de référence des anciens portails SAP RMK peuvent être rafraîchies : la preuve documentaire Douglas Unified Data Model ne se généralise pas à tous les portails SuccessFactors.
- Le texte de la page d’accueil promet encore des offres « sans doublon » et un rattachement de chaque offre à une ville. Ces affirmations absolues dépassent la qualité certifiée par cet audit ; leur formulation et les indicateurs de fraîcheur doivent être alignés sur les preuves.
- Le taux réel de doublons mondial n'est pas recertifié par ce lot. Les conflits P0 Oracle réparés ne prouvent pas l'absence de tous les doublons entre portails ou reposts.

## D. Toutes les découvertes FashionJobs sont conservées ; toutes ne sont pas intégrées

Le registre `../fashionjobs-portals/ledger.csv` conserve **1 653 libellés, 3 971 profils, 87 éditions**, dont **747 libellés présents dans l'annuaire français**. Un libellé peut désigner une marque, une enseigne, une filiale, un groupe ou un homonyme ; ce n'est pas un décompte d'entités juridiques uniques.

| État du registre | Libellés |
|---|---:|
| Candidat relié à une source active | 211 |
| Rapprochement d'identité ambigu | 30 |
| Recherche commencée, incomplète | 598 |
| Portail officiel, validation technique restante | 12 |
| Liens carrière à revoir | 50 |
| Recherche directe non encore documentée | 752 |

Les preuves de marque, le domaine, le portail officiel, la capacité technique du collecteur et la complétude mondiale sont séparés. L'absence de domaine dans la base ne déqualifie pas une marque prouvée par son groupe, notamment les quatre marques SMCP.

Portails notamment retrouvés : Sud Express/TalentView, Aubade/WTTJ, Armor-lux/WeRecruit, Histoire d'Or/THOM, Oniverse (Calzedonia, Intimissimi, Tezenis), Hugo Boss/Phenom, Gérard Darel/Taleez. Leur présence dans cette liste ne vaut pas activation. Aubade/Aubade Paris demande un arbitrage ; le backend actuel Histoire d'Or doit être validé ; le lien Carrières Isabel Marant observé conduit à FashionJobs et la recherche d'une alternative directe reste ouverte.

FashionJobs sert à découvrir les employeurs et les compteurs d'annuaire. Aucune nouvelle offre FashionJobs n'est importée. Les volumes historiques encore présents dans notre base sont distingués des offres ayant une source directe active. L'égalité des compteurs n'est pas un invariant : périmètres, dates, multi-localisations, reposts et offres exclusives peuvent différer. Le rapprochement doit se faire employeur par employeur, pays par pays, à date comparable, avec les écarts inexpliqués conservés.

## Registre de livraison

« Image prête » signifie build Railway réussi et code disponible pour le prochain démarrage, **pas nouvelle collecte effectuée**. Les preuves historiques des lots précédents sont datées dans leurs dossiers.

| Finding | Fixé ? | Commit applicatif / merge main | Main ? | Déployé ? | Données réparées ? | Preuve prod |
|---|---|---|---|---|---|---|
| P0 Oracle/Tiffany, SMCP, VIA/ASHOKA, propriétaires | Lots précédents corrigés | `18b66ee` / `758cd75` | Oui | Oui | Oui, périmètres revus | [Dossier P0](../../2026-09-08/remediation/README.md) ; invariants Oracle/lifecycle encore verts au lot France |
| Publication source, lot précédent | Oui dans le périmètre documenté | merge `1b3fe6e` | Oui | Oui | 2 844 Job + 3 740 JobSource | [Dates source](../../2026-09-08/publication-dates/) |
| Douglas locale US | Oui | `3231285` / `0f3f7e0` | Oui | Image prête | **13 Job + 13 JobSource** | [SQL, RAW et événements](../rmk-dates/production-proof.json), [JSON-LD public](../rmk-dates/front-proof.json) |
| France, deux drapeaux incohérents | Oui | `67aef77` / `8513d74` | Oui | Image prête | **2 Job**, aucun pays modifié | [SQL/historique](../france-filter/production-proof.json), [API après](../france-filter/front-after.json) |
| Résumé du run et erreur source conservée | Oui dans le code | `edeae6f` / `66f5b46` | Oui | Image prête | Sans objet | Incident historique conservé ; prochain résumé réel pas encore émis |
| L'Oréal, 406 et pagination officielle | Correctif + lecture réelle validés | `edeae6f` / `66f5b46` | Oui | Image prête | **Aucune nouvelle ingestion** | 1 804 représentations protégées pendant l'échec ; 1 726 IDs en lecture directe ; validation depuis Railway encore requise |
| Teamtailor, complétude | Correctif + 122 flux validés | `e68837e` / `9763522` | Oui | Image prête | **Aucune nouvelle ingestion** | Les SourceRun historiques sont inchangés ; [lecture directe](../teamtailor/) |
| TalentView, limitation à la première page | Oui + 5 tenants validés | `d50443f` / `e40d5bf` | Oui | Image prête | **Aucune nouvelle ingestion** | [150 campagnes existantes + Sud Express 68](../talentview/live-validation.json) ; pas de gain net prod revendiqué |
| Registre mondial FashionJobs | Inventaire conservé ; qualification inachevée | `4387eaf` / `a30364d` | Oui | Dossier versionné | Aucune activation dans ce lot | [1 653 libellés et états](../fashionjobs-portals/ledger.csv) |
| Pays manquants, MID, autres ATS, fraîcheur, provenance | **Non soldé** | Pas de correctif global livré | — | — | Non | Populations exactes et critères ci-dessus |

## E. Architecture retenue et travail prioritaire

Conserver une application modulaire et PostgreSQL, avec des workers séparés, est adapté au stade du produit. Aucune migration microservices ou infrastructure distribuée lourde n'est justifiée par les mesures de ce lot. La montée en charge doit d'abord s'appuyer sur des unités source bornées, des clés stables, des index mesurés, des écritures idempotentes et une concurrence limitée par hôte.

La chaîne de vérité cible reste : **identité de l'employeur et lien officiel → tenant/périmètre mondial → observation RAW datée et immuable → règles versionnées par champ → valeur canonique avec provenance et confiance → JobSource → Job canonique → projections API/front/SEO**. Plusieurs briques existent déjà ; la provenance homogène par champ et la reprise durable d'un run ne sont pas achevées.

| Priorité | Travail restant | Preuve exigée pour le clore |
|---|---|---|
| P0 | Recertifier les admissions historiques douteuses, arbitrer les collisions d'identité avant nouvelle activation | Source officielle nommant l'employeur, plan de correction revu, préservation RAW/historique, invariant global et preuve après prod |
| P1 | Achever le contrat de complétude des ATS prioritaires, puis valider le réseau Railway | Toutes les pages/périmètres réels, IDs uniques, total source lorsque disponible, terminal attesté, erreurs/challenges distincts ; SourceRun réel après reprise contrôlée |
| P1 | Fiabiliser les disparitions et la fraîcheur | Ne jamais déduire une fermeture d'une panne ; vérifier absences répétées sur balayages complets, détails et délais ; traiter les 61/1 348 populations mesurées |
| P1 | Compléter dates, pays, métiers et provenance | RAW → règle/version → valeur → preuve/confiance ; aucune invention pour Google ; revue des viviers et dates RMK |
| P1 | Unifier les projections de lecture | Même sémantique base/API/facettes/compteurs ; supprimer à terme les doubles vérités dérivées ou les contraindre ; témoins par pays |
| P1 | Reprise et observabilité du run | Identifiant global persistant, progression par source, reprise idempotente, annulation visible, résumé borné, déploiement sans perte du travail en cours ; répétition sur copie réelle, sans load test |
| P2 | Qualifier les 1 653 libellés et leurs portails mondiaux | Registre exhaustif de décisions, aucune recherche vide promue en impossibilité, adapter réutilisable ou dédié puis validation avant activation |

La règle actuelle d'attestation accepte jusqu'à 10 % d'écart avec un total déclaré lorsque le balayage est indiqué complet (`ATTESTATION_MIN_COVERAGE=0.9`). Cette tolérance est une protection historique contre les totaux instables, **pas une preuve d'exhaustivité à 100 %**. La remplacer par une vérification adaptée au protocole (snapshot/cursor, relecture du total et inventaire d'IDs) reste à qualifier, sans durcir arbitrairement un chiffre ni autoriser les fermetures sur un listing tronqué.

### Reprise

Les trois workers sont placés en maintenance via `PIPELINE_PAUSED=1`, mécanisme existant de `apps/aggregator/start.sh`. Les crons restent configurés, mais le démarrage quitte avant migrations/collecte/fermetures. Le web reste servi. `deployments.json` conserve les trois variables de pause, images SUCCESS et crons ; le script de démarrage quitte avec succès avant toute commande lorsque ce mode est actif. La suspension préserve l'état pendant le chantier mais retarde sa fraîcheur ; elle ne doit pas devenir un fonctionnement normal.

La reprise doit être explicite et commencer par les sources corrigées avec contrôles de complétude et d'identité, puis être étendue. L'extension du catalogue est progressive ; elle ne doit pas être confondue avec la stabilité du service. Aucun calendrier artificiel de reprise ni garantie d'absence totale d'erreur n'est annoncé.
