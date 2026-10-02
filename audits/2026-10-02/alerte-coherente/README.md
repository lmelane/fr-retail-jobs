# Alerte cohérente — mesure à blanc (lecture D-492 du 02/10/2026)

Règle : une alerte n'a de section des incomplètes (contrat, temps de travail, secteur, langue, programme inconnus) que si
son métier (requête tapée ou métier choisi) ou son lieu (lieu ou ville) est posé (D-515 §2, « correspond fortement »).
Avant : une alerte « CDI » seule envoyait encore ses offres au contrat non précisé.

Mesure en lecture seule de la production, 02/10/2026 vers 13:52 UTC, hors fenêtre du RUN, avant (`origin/development`
23c5e42) puis après (le correctif), à quelques secondes d'écart, avec le script du lot alertes
(`../alertes-deux-temps/alertes-a-blanc.mts`, session `default_transaction_read_only=on`) et sa rustine de mesure
(`../alertes-deux-temps/patch-mesure-prod.py` : la colonne `availabilityHold` n'existe pas encore en production).

    python3 grille-faible.py ../alertes-deux-temps/grille-63.json grille-80.json
    python3 ../alertes-deux-temps/patch-mesure-prod.py <worktree>
    CATWALKS_DB_ACCESS=<accès> python3 apps/aggregator/scripts/ops/db.py readonly sh -c \
      'cd <worktree>/apps/api && npx tsx ../../audits/2026-10-02/alertes-deux-temps/alertes-a-blanc.mts <grille-80.json> <sortie.json>'
    python3 ../alertes-deux-temps/patch-mesure-prod.py <worktree> --retablir
    python3 comparer.py resultats/avant.json resultats/apres.json

Résultat (`resultats/comparaison.txt`) :

- les 63 alertes de la grille portent toutes un métier et une ville (ou un lieu) : **rien ne change** (242 certaines,
  204 incomplètes, 24 alertes avec incomplètes, avant comme après ; 0 violation) ;
- les 17 alertes « faibles » qui en dérivent (mêmes filtres d'emploi par marché, sans métier ni lieu) : certaines
  identiques (2 534), **incomplètes 5 242 → 0** ; « CDI » France 110 → 0, États-Unis 2 815 → 0, Royaume-Uni 503 → 0.
