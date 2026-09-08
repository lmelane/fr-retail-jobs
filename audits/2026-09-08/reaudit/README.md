# Dossier de réaudit — 8 septembre 2026

Commencer par [le rapport A–E](RAPPORT-REAUDIT.md). [L’annexe technique](ANNEXE-TECHNIQUE.md) contient les mécanismes, références de code, limites et procédure existante d’ajout de sources.

## Contenu

- `tableaux/` : inventaires CSV en UTF-8 avec BOM, avec IDs et verdicts. Ce sont des diagnostics, pas des imports de correction.
- `evidence/` : extractions locales réelles, réponses API et pages consultées. Ce dossier est exclu de Git et ses permissions sont restreintes au propriétaire. Les données RAW peuvent contenir les coordonnées publiques d’annonces ; préférer les tableaux et agrégats pour partager le résultat.
- `*.sql` : requêtes d’audit uniquement, avec transactions explicitement en lecture seule. Les compléments n’ont pas tous la même heure de snapshot.
- `manifest-sha256.json` : empreintes des preuves et livrables à la clôture de l’audit. Elles permettent de détecter des modifications ultérieures ; elles ne constituent pas une attestation indépendante.
- `verification-livrables.json` : vérification locale des effectifs, dénominateurs, liens et exports. Aucun test de charge ni aucune donnée artificielle.

## Relecture hors ligne

Les preuves conservées suffisent à recalculer les métriques principales sans accéder à la production. Depuis la racine du projet :

```sh
python3 audits/2026-09-08/reaudit/analyze.py
python3 audits/2026-09-08/reaudit/build-deliverables.py
python3 audits/2026-09-08/reaudit/build-candidates.py
```

Ces scripts réécrivent uniquement les dérivés de ce dossier. Les effectifs liés à la fraîcheur se rapportent à l’heure figée du snapshot, pas à l’heure de relance. Les verdicts de revue et dossiers de couverture sont explicités dans les scripts ; les champs non établis restent marqués comme tels.

`read-production.py` dépend d’un accès Railway autorisé et d’un fichier temporaire d’identifiants, retiré à la clôture. Aucun identifiant n’est livré. Pour un audit ultérieur, rétablir cet accès de façon sécurisée et utiliser un nouveau répertoire daté, sans écraser cette preuve historique. La requête France a été corrigée pour traiter les NULL ; la différence entre `totals.json` initial et `totals-corrected.json` est documentée dans l’annexe.

La recherche sectorielle est datée : les 38 dossiers doivent passer la validation existante avant activation. Une page carrière officielle, une candidature spontanée et une annonce réellement ouverte sont des objets distincts.
