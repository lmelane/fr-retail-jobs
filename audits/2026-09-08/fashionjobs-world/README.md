# FashionJobs — annuaires mondiaux, découverte d'employeurs uniquement

Lecture du 8 septembre 2026, rapprochement avec la production à 20:10:23 UTC. Aucune fiche d'offre FashionJobs visitée, aucune offre FashionJobs importée, aucune création d'employeur automatique à partir de cette liste.

## Résultat

| Mesure | Valeur |
|---|---:|
| Éditions pays référencées sur la page internationale et examinées | 87 |
| Annuaires contenant des profils | 81 |
| Annuaires explicitement vides | 6 |
| Échecs restant non résolus dans cette lecture des annuaires | 0 |
| Profils pays, avant regroupement des noms | 3 971 |
| Libellés normalisés distincts | 1 653 |
| Libellés absents du seul annuaire français | 906 |
| Libellés avec au moins un rapprochement candidat en base | 657 |
| Libellés sans rapprochement établi | 996 |
| Libellés avec candidat source directe ACTIVE dans le catalogue | 234 |
| Rapprochements ambigus avec plusieurs Company | 9 |

Les six pages vides sont Éthiopie, Liechtenstein, Libye, Venezuela, Yémen et Zambie. Elles affichent explicitement « There are no items in this category. » ou son équivalent espagnol. Ce constat porte sur l'annuaire FashionJobs observé, pas sur l'absence d'employeurs dans ces pays.

**1 653 noms ne signifie pas 1 653 Maisons certifiées.** La liste contient groupes, enseignes, agences, homonymes et variantes de noms. Les 996 sans rapprochement ne sont pas automatiquement 996 entreprises nouvelles. Les compteurs d'offres des éditions se recouvrent : leur somme ne prouve ni le nombre mondial de postes distincts, ni une parité avec Catwalks.

## Problèmes techniques identifiés et corrigés

1. Le parseur historique reconnaissait seulement `/recrutement/` et reconstruisait les liens relatifs sur le domaine français. Les éditions utilisent 11 variantes de route, dont `/careers/`, `/lavora-con-noi/`, des routes allemandes, russes, chinoises et japonaises. L'origine pays est désormais un paramètre validé.
2. La Pologne utilise `/en-pl/careers/...` : 61 lignes visibles avaient été perdues par un premier filtre de chemin trop strict. Témoin et correctif du préfixe localisé.
3. Allemagne, Autriche, Tchéquie et Chine n'exposaient pas le même lien de menu. Lecture du `data-nav="les_entreprises"` et de son `data-link`, puis de la destination réellement observée. Les quatre premiers échecs restent dans `fetch-attempts.json` ; le résultat final les résout.
4. Une liste alphabétique partiellement reconnue fait échouer le parseur en nommant l'URL perdue. Une page challenge ou une simple chaîne de traduction JavaScript ne prouvent jamais un annuaire vide.
5. Le client Node existant recevait un HTTP 403 sur la page britannique, tandis qu'un client standard Python avec le même User-Agent déclaré recevait la page publique. La cause précise de cette différence de transport reste à investiguer. Le collecteur d'audit utilise ce client public avec limites de taille, durée, trois requêtes concurrentes maximum, URLs limitées aux pages d'accueil/annuaires FashionJobs et contrôle des redirections. Aucune session privée, aucun proxy de contournement, aucune fiche d'offre.

## Reproduction et fichiers

`fetch-directories.py --output-dir=<dossier>` crée ou reprend un instantané ; sans argument, un nouveau dossier horodaté préserve les relevés précédents. `build-inventory.mts --input-dir=<dossier>` relit ce même instantané.

`fetch-directories.py` découvre les 87 éditions depuis la page internationale officielle, relève le menu de chaque édition, capture l'annuaire et reprend son journal après interruption. Les HTML intégraux restent dans le dossier privé de sauvegardes ; leurs empreintes sont publiées.

`build-inventory.mts` utilise **le parseur applicatif**, sur toutes les pages archivées. Il recoupe les noms avec Company, alias, catalogue Source et relations JobSource. Les sources/ATS/URLs et volumes existants figurent dans `employers.csv` et `employers.json`. Les volumes ne sont présentés que pour un rapprochement Company unique ; pas de somme sur des homonymes.

`editions.json` conserve profils, compteurs, dates, empreintes et résultats de parsing par édition. `summary.json` donne les chiffres, limites et neuf collisions à arbitrer. Les noms sans source restent une file de recherche ; la découverte des portails directs de tous ces acteurs n'est pas terminée.

Les trois activations prouvées de ce tour — Adopt Parfums, RIU Paris et Toscane, **156 offres dont 117 françaises** — sont détaillées dans [le dossier de livraison](../direct-sources/README.md). Le prochain gros portail France identifié est [Intersport/Blackstore](https://recrutement.intersport.fr/) : 993 annonces dans sa liste publique contre 1 077 posts publiés dans son API WordPress. Cet écart doit être expliqué et les descriptions rattachées aux seuls identifiants de la liste active avant activation ; importer aveuglément toute l'API créerait un risque d'offres fantômes.
