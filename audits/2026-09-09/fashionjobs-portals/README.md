# FashionJobs : registre mondial de qualification des portails

Le registre conserve les **1 653 libellés et 3 971 profils** des 87 annuaires déjà lus, dont 747 libellés présents dans l'annuaire français. Il les recoupe avec la production au **9 septembre 04:49 UTC** : 1 571 Company, 500 Source, 424 Source ACTIVE. Aucun de ces nombres n'est un décompte de Maisons mondialement certifiées et intégralement couvertes.

`ledger.csv` est la liste de travail lisible ; `ledger.json` conserve sociétés candidates, sources, liens, preuves, erreurs et dates des recherches. `summary.json` donne les nombres par étape. Un nom présent dans un catalogue, une identité prouvée, un portail officiel, un adaptateur fonctionnel et une énumération complète sont cinq faits distincts.

L'ancien rapprochement retenait 9 collisions de noms. Ce registre inclut aussi les références canoniques et aliases pour retrouver les portails groupe et les enseignes : il signale 30 rapprochements avec plusieurs Company candidates. Ce sont des rapprochements **à arbitrer**, pas 30 doublons déjà démontrés. Aucun Company ou alias n'est fusionné automatiquement. L'absence de domaine renseigné ne déqualifie jamais à elle seule une marque établie.

Les recherches anciennes sont conservées sans changer leur date ni transformer leurs résultats vides en preuve d'absence. Plus de 700 libellés n'ont pas encore de recherche directe dans les dossiers disponibles ; le travail mondial n'est donc pas terminé.

## Progrès vérifiés de ce lot

| Acteur | Source officielle retrouvée | Vérification | Reste avant activation |
|---|---|---|---|
| Sud Express | Le footer de sudexpress.com lie sud-express.talentview.io/fr | TalentView : 10 offres avant pagination ; **68** sur 7 pages via le protocole réel du site | Déploiement du correctif commun, certificat d'identité, admission contrôlée |
| Aubade | Le footer d'aubade.com lie son espace WTTJ ; espace employeur Aubade Paris lisible | **24/24** offres via l'adaptateur ; énumération complète | Arbitrer AUBADE / AUBADE_PARIS, rattachement et absence de doublon avec WTTJ sectoriel |
| Histoire d'Or / THOM | rejoindre.histoiredor.com/offres-emploi ; relation THOM explicite sur la page Groupe | Offres et 6 pages visibles sur le portail officiel | Lire toutes les pages et la chaîne de candidature, qualifier le backend ; ne pas présumer Easycruit depuis un ancien résultat de recherche |
| Armor-lux | careers.werecruit.io/fr/armor-lux, déjà lié depuis le site officiel | Portail WeRecruit confirmé à nouveau | Implémentation/qualification du flux public et de l'exhaustivité ; le détecteur générique ne suffit pas |
| Isabel Marant | isabelmarant.com | Le lien Carrières observé conduit à FashionJobs | Continuer la recherche directe ; ne pas importer les offres FashionJobs ni déclarer « aucun portail » |

Les captures et leurs SHA-256 figurent dans `official-captures.json`. Les décisions et leurs limites sont dans `portal-reviews.json`. `candidate-validation.json` conserve la première lecture **avant correction TalentView** ; la preuve après est dans `../talentview/live-validation.json`. Aucun acteur activé et aucune offre importée dans ce lot de découverte.

## Reproduction

- `export-production.mts --out=<instantané privé>` : transaction READ ONLY / REPEATABLE READ.
- `build-ledger.mts --private-root=<répertoire backups>` : inventaire complet hors ligne, conservation vérifiée des profils ; aucune écriture en base.
- `capture-official.mts --out=<répertoire privé>` : lectures bornées des pages officielles ; aucune visite d'offre FashionJobs.
- `validate-candidates.mts` : exécution en lecture seule des adaptateurs existants, tous pays.

Avant admission : identité/alias/groupe justifiés, lien officiel vers le tenant, inventaire de tous ses portails pertinents, pagination vérifiée, qualité des champs et dates, correspondance avec les Company existantes, test et témoin réel, certificat SourceIdentityReview, activation puis preuve de production. La complétude d'un tenant n'est pas la complétude mondiale d'une Maison.
