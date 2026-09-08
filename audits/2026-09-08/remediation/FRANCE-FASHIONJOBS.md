# France et FashionJobs : comparaison mesurée

Relevé de production du 8 septembre 2026, 20 h 07 Paris. Le site FashionJobs affiche 8 269 offres sur son accueil ; sa liste a affiché 8 270 quelques minutes plus tard. Ce sont des compteurs observés, pas un inventaire d’IDs réconcilié. La version française propose aussi certaines offres à l’étranger : le sous-domaine fr ne suffit pas à prouver le pays d’une annonce.

Sources publiques : https://fr.fashionjobs.com/ et https://fr.fashionjobs.com/s/ . Données Catwalks : france-fashionjobs-production.json, script en lecture seule france-fashionjobs.mts.

| Mesure Catwalks | Nombre |
|---|---:|
| Offres du filtre France, toutes sources | 9 634 |
| Offres France avec représentation FashionJobs active | 755 |
| Dont représentées aussi par une autre source | 167 |
| Dont uniquement représentées par FashionJobs | 588 |
| Offres France sans représentation FashionJobs active | 8 879 |
| Offres FashionJobs actives, tous pays | 757 |

**Nous n’avons pas ingéré les 8 269 annonces FashionJobs.** Le connecteur représente environ 9,2 % de ce volume annoncé. Ce ratio ne mesure pas la couverture effective de toutes leurs annonces : certaines peuvent être présentes via un ATS sans lien FashionJobs déjà enregistré. Les 8 879 offres sans provenance FashionJobs ne sont donc pas 8 879 exclusivités commerciales.

## Causes observées dans le système

1. La configuration réelle de Source est `maxPages: 40`, avec un curseur à la page 81 depuis le 7 septembre 23 h 07 UTC. Le code de cadence annonce pourtant une fenêtre de 300 pages pour raisonner sur une rotation quotidienne. Cette constante n’est pas celle transmise à l’adaptateur : la preuve théorique de cadence ne reflète pas la configuration réellement exécutée.
2. L’adaptateur collecte d’abord les URLs de toutes les pages de la fenêtre, puis charge les détails. Il positionne `progress.lastPageDone` pendant la phase de liste. Une expiration du budget pendant les détails peut donc faire avancer le curseur au-delà de fiches jamais lues. Les détails en erreur sont ignorés sans file de reprise persistante. C’est un défaut de parcours démontré par le code ; le nombre précis d’annonces perdues par ce mécanisme nécessite une trace de chaque URL.
3. Le dernier run conserve 286 offres et porte le statut OK. Ses champs `complete`, `declaredTotal`, `canAttestAbsence` sont NULL : le statut ancien ne certifie pas une collecte exhaustive. Le compteur `verifiedJobCount=7611` conservé dans Source n’est pas le volume collecté (757 offres actives).
4. Il existe aussi une sous-couverture géographique : sur 1 804 offres du portail L’Oréal, 1 227 n’ont pas de pays et seulement cinq sont classées FR. Leurs localisations doivent être reprises à partir de preuves, sans convertir automatiquement toutes les inconnues en France.

## Décision initiale — remplacée par la consigne « découverte uniquement »

Traiter séparément la complétude du connecteur, la qualité géographique et la couverture des employeurs. L’annuaire https://fr.fashionjobs.com/societesrecrutent/ demandé par l’utilisateur devient une liste de référence à croiser avec Company, CompanyAlias et Source.

Pour les employeurs absents ou mal couverts : rechercher le domaine officiel, puis le lien officiel vers le portail carrière et son ATS/API. Une offre peut être couverte par un groupe ; ne pas compter une marque absente comme manquante avant ce rapprochement. Enregistrer preuves, date, propriétaire du portail, marques publiées et statut technique séparément. Aucun nouveau portail n’est activé par ce relevé.

La remédiation du parcours FashionJobs devra garder une file durable d’URLs et de résultats de détail, reprendre les échecs, borner le débit par hôte, et n’avancer une étape qu’après persistance de son résultat. Augmenter aveuglément maxPages ne résout ni les détails sautés ni la preuve de fraîcheur. La cadence doit être évaluée depuis la configuration effective et les parcours réellement achevés.

Pas de somme « 9 634 + 8 269 », pas de taux de doublons inventé, pas de correction de données dans cette investigation.

## Décision appliquée le 8 septembre, après clarification de l’utilisateur

FashionJobs est désormais exclusivement une source de découverte d’entreprises et de compteurs publics. **La collecte de ses offres a été mise en pause en production**, avec une opération Source journalisée et sans modification des Job, JobSource, RAW ou historiques. Le projet de file durable pour son crawler d’offres décrit plus haut est donc abandonné dans ce périmètre. Les défauts observés restent documentés.

Le nouvel inventaire et les preuves se trouvent dans [le dossier de couverture](../fashionjobs-coverage/README.md). Les chiffres ci-dessus décrivent l’état précédant la pause. Les offres historiques FashionJobs ne sont ni supprimées ni présentées comme fraîchement réattestées : celles sans provenance directe restent une dette de fraîcheur à traiter explicitement.
