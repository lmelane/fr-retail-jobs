# Lot 4D3 — Six lecteurs natifs et échéance Flatchr

**Validé localement. Aucun déploiement ni changement de stock distant. La reprise historique reste en cours.**

## Lecture des publications

Les lecteurs Flatchr, Personio, Jobylon, TalentView, Talent Funnel et Volcanic reconstruisent maintenant les formats RAW conservés. Les fonctions de lecture sont partagées avec la collecte ; aucun faux HTML ni nouvelle attestation n’est produit. L’identifiant et l’URL obtenus doivent correspondre à la représentation historique.

- **Flatchr :** identité société/vacancy, portail et état publié vérifiés. Le texte comprend les trois rubriques natives, mais le portrait de l’entreprise ne suffit pas à constituer une description de poste : mission ou profil doit contenir du texte utile.
- **Personio :** lecture de la position XML et de ses rubriques. Les enrichissements de page d’un autre format restent refusés plutôt que supprimés silencieusement. `createdAt` n’est pas une date de publication.
- **Jobylon :** le chemin natif doit contenir l’identifiant de la liste. Le `JobPosting` conservé passe par le parseur de collecte ; une URL de détail contradictoire bloque la récupération.
- **TalentView :** identifiant et slug du détail doivent correspondre à la liste. Un détail brouillon, hors ligne ou de visibilité inconnue est retenu hors publication. Une erreur d’identité ne se transforme plus en simple échec réseau ignoré.
- **Talent Funnel :** détail, liste et configuration doivent désigner le même tenant et la même annonce. Le titre du détail prévaut après cette vérification. Un détail dont l’état n’est pas `ACTIVE` est retenu hors publication.
- **Volcanic :** réutilisation du lecteur natif et vérification de l’identifiant et du chemin publiés. Ce sous-lot ne qualifie pas encore la sémantique de ses dates.

## Correction de l’échéance Flatchr

Le [schéma officiel Flatchr](https://developers.flatchr.io/en/docs/Schemas/vacancy) définit `vacancy.end_date` comme la fin du contrat. Ce champ ne doit donc jamais fermer l’annonce comme une échéance de candidature. Le lecteur d’expiration **version 3** retire cette règle ; un test d’ingestion vérifie qu’un contrat à date de fin passée ne ferme ni la publication ni son groupe.

Le snapshot contient 150 valeurs de fin de contrat, dont 43 antérieures au 15 septembre 2026. **Ces nombres ne représentent pas des fermetures de production.** Les colonnes d’échéance de `JobSource` et la règle fautive ont été introduites par le chantier local, dans la migration `20260915150000_source_expiry`, jamais déployée. [Comptages RAW](preuves/lot-4d3-native-semantics.json).

La reprise des échéances en cache reste un prérequis de release : le moteur de réparation des groupes ne remplit pas ces colonnes. Un lot distinct doit reconstruire les échéances depuis leur preuve et traiter les anciennes valeurs avec un plan journalisé. Il ne doit ni effacer une échéance prouvée après une capture partielle ni réattester une offre historique.

## Rejeu et reconstruction en base

Sur les **85 327 représentations** du snapshot, **50 028** produisent une présentation valide, contre 49 205 au lot précédent. Le gain de **823** vient de 354 Flatchr, 176 Personio, 31 Jobylon, 80 TalentView, 151 Talent Funnel et 31 Volcanic. Les dix refus Personio portent un `jobDescriptions` vide ; les deux Talent Funnel restants n’ont pas de détail ni de texte complet. Il reste **35 299 représentations** à qualifier, revoir ou recollecter. Ces chiffres ne prouvent pas leur disponibilité actuelle.

Le scénario en base locale reconstruit **84 publications couvrant 28 familles** depuis leurs RAW réels, dans des groupes volontairement incorrects. La lecture API confirme titres, textes, dates et URL sans écart. RAW, dates d’observation et absence de capture native restent inchangés. La CLI produit un plan privé `0600`, l’applique et accepte sa répétition sans nouvelle mutation. Aucune dérive du schéma.

## Validation et audit défensif

**2 975 tests réussis** : 2 257 unitaires agrégateur, 459 d’intégration, 254 API et 5 Python ; deux tests de corpus optionnels ignorés. TypeScript, build API et les 55 migrations sur une base vierge passent. [Validation](preuves/lot-4d3-validation.json).

Dix contre-épreuves réintroduisent une perte de profil, un portrait d’entreprise sans contenu métier, un portail Flatchr étranger, une fausse date Personio, un détail Talent Funnel étranger, un titre périmé, un détail TalentView étranger, un brouillon rendu public, une fin de contrat utilisée comme échéance et un tenant Talent Funnel contradictoire. Toutes déclenchent un échec d’assertion ; les suites avant mutation et après restauration passent. [Contre-épreuves](preuves/lot-4d3-counterproofs.json).

## Suite requise

Easycruit, Harri et TalentRecruiter possèdent encore des formats natifs à qualifier. Les pertes historiques de contenu, les domaines de détail des portails multiples, les autres dates, le rejeu des captures avec un nouveau lecteur, les échéances en cache et la migration du stock complet restent à traiter avant la bascule publique.

## Preuves

- [Corpus](preuves/lot-4d3-corpus.json) et [sémantique des champs natifs](preuves/lot-4d3-native-semantics.json).
- [Reconstruction et lectures API](preuves/lot-4d3-shadow.json), [CLI](preuves/lot-4d3-cli-smoke.json).
- [Préservation des travaux initiaux](preuves/lot-4d3-preservation.json) : 85 fichiers identiques sur 86 ; les trois scripts npm utilisateur restent conservés, hors commit de ce lot.
