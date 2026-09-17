# Lot 4D4 — XML Easycruit et portails Harri / TalentRecruiter

**Reconstruction et suites validées localement. Aucune écriture de production. La reprise du stock complet reste en cours.**

## Lecture commune à la collecte et à la reprise

Les trois adaptateurs exposent leur lecture native sous forme de fonctions pures, utilisées par la collecte et par la reconstruction historique. Le RAW conservé n’est ni remplacé par les colonnes `Job` ni transformé en fausse nouvelle capture.

- **Easycruit :** position XML identifiée, détail portant le même identifiant, URL native rattachée au tenant et version linguistique choisie par la configuration. Les textes et catégories XML restent natifs. Les éventuels nœuds JSON-LD conservés passent par le même lecteur que la page collectée, après vérification de l’URL, du type, du nombre de nœuds et du format de l’empreinte HTML. Une empreinte ne permet pas de vérifier le HTML disparu : la provenance demeure `RETAINED_RAW`.
- **Harri :** identifiant du détail et URL d’API exacts ; slug et identifiant du portail confrontés à la configuration. Le mode employeur explicite choisit l’enseigne publiée ou le propriétaire du portail. Un poste privé, supprimé, non publié, fermé, expiré ou dans un état inconnu n’est pas récupéré comme disponible.
- **TalentRecruiter :** client natif conforme à la configuration, identifiant unique `ProjectId` dans l’URL, texte fourni par `Advertisements[].Content`. Les doublons de paramètre d’identité sont refusés aussi lors de la collecte. Introduction et résumé ne remplacent pas un texte d’annonce absent. Le pays de la hiérarchie d’entreprise ne devient jamais un pays de poste ; `Created` ne remplace pas `Published`.

L’enrichissement JSON-LD partagé sépare désormais la lecture du nœud et son application aux champs. La collecte garde son comportement ; la reprise n’a pas besoin de fabriquer un document HTML pour réutiliser le parseur.

## Résultats sur les RAW

Les **85 327 représentations** du snapshot donnent **50 128 présentations reconstructibles et valides**, soit 100 de plus : 50 Easycruit, 36 Harri et 14 TalentRecruiter. Les 50 RAW Easycruit portent un compteur JSON-LD nul ; leurs dates de création/modification XML ne sont pas utilisées comme dates de publication. Chez TalentRecruiter, deux annonces et une candidature spontanée restent sans contenu complet. Il reste **35 199 représentations** à qualifier, revoir ou recollecter. Ces mesures décrivent le snapshot, pas l’ouverture actuelle des annonces. [Corpus](preuves/lot-4d4-corpus.json), [formats et absences](preuves/lot-4d4-native-semantics.json).

La reconstruction locale porte sur **93 publications réelles, dans 31 familles**. Des groupes volontairement incorrects sont séparés, puis chaque publication est relue par l’API : aucun écart de titre, texte, date ou URL ; aucune modification du RAW ni des dates d’observation ; aucune capture créée. La CLI applique puis réapplique son plan privé `0600` de façon idempotente. Aucune dérive du schéma. [Reconstruction](preuves/lot-4d4-shadow.json), [CLI](preuves/lot-4d4-cli-smoke.json).

## Validation défensive

**2 987 tests réussis** : 2 269 unitaires agrégateur, 459 d’intégration, 254 API et 5 Python ; deux tests de corpus optionnels ignorés. Les 55 migrations passent sur une base vierge ; TypeScript et le build API passent. [Validation](preuves/lot-4d4-validation.json).

Dix mutations contrôlées couvrent perte de texte XML, tenant XML étranger, date JSON-LD perdue, nœud d’une autre annonce, portail Harri étranger, mauvais endpoint de détail, poste Harri fermé rendu disponible, création TalentRecruiter utilisée comme publication, résumé utilisé comme texte complet et mauvais portail client. Les dix provoquent un échec d’assertion ; les suites de référence et de restauration passent. [Contre-épreuves](preuves/lot-4d4-counterproofs.json).

## Conditions de sortie restantes

Le remplissage des échéances utilisera l’outil `source-expiry.mts` existant, après audit et évolution de sa gestion des preuves anciennes ; aucun second circuit de reprise n’est prévu. Les sémantiques de dates encore non qualifiées, les domaines de détail des portails multiples, les pertes de texte historique et le rejeu de captures avec un nouveau lecteur restent à traiter. Le stock complet doit être reconstruit et audité avant la bascule du lecteur public.

[Préservation des travaux initiaux](preuves/lot-4d4-preservation.json) : 85 fichiers identiques sur 86 ; les trois scripts npm utilisateur restent conservés hors commit de ce lot.
