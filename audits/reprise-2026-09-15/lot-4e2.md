# Lot 4E2 — Reprise des échéances et preuves antérieures

**Validé localement. Aucune écriture dans le catalogue de production. La répétition sur le stock complet reste à exécuter.**

## Un seul outil de reprise

Le moteur [sourceExpiry.ts](../../apps/aggregator/src/pipeline/sourceExpiry.ts) et la commande [source-expiry.mts](../../apps/aggregator/scripts/ops/source-expiry.mts) existants passent au plan version 2. Le lecteur d’échéance passe à la version 5. L’argument manuel `--revision` disparaît : le plan est lié à la révision calculée du code et conservé dans `MaintenancePlan`.

La prévisualisation distingue trois corrections justifiées et les cas à examiner :

- **Échéance dans le RAW courant** : lecture du chemin qualifié et conservation de son observation avec la date d’origine.
- **Échéance antérieure toujours prouvée** : recherche de l’observation immuable pour la même source, le même identifiant natif et la même empreinte ; relecture par le lecteur actuel. Son horodatage doit précéder ou égaler celui de la représentation courante. Une capture partielle ne supprime pas cette échéance.
- **Règle retirée** : effacement uniquement des anciens chemins Flatchr `vacancy.end_date` (lecteurs 1–2, fin du contrat) et Volcanic `end_date` (lecteurs 1–3, sémantique de liste non qualifiée). L’ancienne valeur et sa justification sont conservées dans le journal.
- **Preuve insuffisante** : signalement explicite dans le plan. Une page comportant un tel signalement refuse toute application.

Les anciennes règles retirées ont été introduites dans des migrations locales non déployées ; ces tests ne démontrent pas des fermetures erronées en production. Le moteur ne réactive aucune offre, ne modifie aucun contenu `Job` et ne rafraîchit aucune attestation.

## Bornes et application

Chaque page contient au maximum 1 000 représentations (250 par défaut), avec au maximum 32 Mo de RAW courant et de preuves antérieures. Les tailles sont contrôlées dans PostgreSQL avant matérialisation des contenus. Les archives froides passent par le lecteur avec vérification d’intégrité, avant les verrous d’écriture.

L’application revérifie les identités, l’employeur, le RAW, les dates d’observation, les références de capture, l’activité, les caches et la configuration/statut de la source. Elle recalcule chaque correction puis écrit la page et son journal dans une même transaction. Un changement concurrent invalide la page entière. Deux applications concurrentes du même plan produisent une seule correction. Une répétition après succès n’exige plus l’accès à l’archive ancienne.

La CLI refuse les options inconnues, dupliquées ou mélangées entre modes. Elle écrit aussi les plans contenant des demandes d’examen, avec un compteur explicite. Les fichiers sont créés en `0600`, sans écrasement ; un fichier d’application supérieur à 8 Mo est refusé.

```sh
npx tsx apps/aggregator/scripts/ops/source-expiry.mts preview --keys=source-a,source-b --out=/chemin/prive/plans
npx tsx apps/aggregator/scripts/ops/source-expiry.mts apply --plan=/chemin/prive/plans/empreinte.json --hash=empreinte
```

La connexion doit désigner l’environnement prévu pour la reprise. Aucun mode implicite ne sélectionne toutes les sources.

## Lecteur et validation

Le lecteur refuse les débordements d’horloge ISO, notamment `24:00:00`, plutôt que de laisser JavaScript les reporter au lendemain. Le rejeu des **85 327 RAW** retrouve les mêmes **5 167 échéances déclarées**, dont **207** passées à l’instant de référence du 15 septembre 2026 à 00:00 UTC et **153** hors plage de stockage. Ces nombres décrivent le snapshot, pas des fermetures effectuées. [Inventaire](preuves/lot-4e2-deadline-inventory.json).

**3 043 tests réussis** : 2 292 unitaires agrégateur, 492 d’intégration, 254 API et 5 Python ; deux tests de corpus optionnels ignorés. Les 55 migrations sur base vierge, le typage et le build API passent. Le contrôle de schéma ne trouve aucune dérive. [Validation](preuves/lot-4e2-validation.json).

Les **11 contre-épreuves** sont détectées par assertion : plan avec examen non résolu, mauvaise révision, observation future ou retenue hors publication, perte de preuve antérieure, retour de l’échéance de contrat, changement d’activité ignoré, suppression des deux bornes de taille, date d’observation artificiellement renouvelée et débordement d’horloge. Les suites restaurées passent. [Contre-épreuves](preuves/lot-4e2-counterproofs.json).

La CLI a appliqué deux corrections de test, puis zéro à la répétition. Elle bloque une troisième représentation sans preuve et conserve à l’identique les contenus et attestations. [Contrôle CLI](preuves/lot-4e2-cli-smoke.json). [Préservation des travaux initiaux](preuves/lot-4e2-preservation.json).

## Suite

La répétition sur une copie complète du stock doit mesurer le remplissage des échéances, les cas à examiner, les présentations reconstructibles et les groupes historiques. La certification des sources devra définir, par format qualifié, la différence entre champ manquant dans une réponse partielle et suppression explicite d’une échéance. Cette différence n’est pas devinée ici. Le lot 4 reste ouvert ; aucun statut global de préparation à la production n’est attribué.
