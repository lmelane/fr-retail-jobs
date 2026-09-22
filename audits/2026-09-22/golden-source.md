# Golden Path Oh My Cream — 22 septembre 2026

## Verdict

**PASS local** : ajout depuis une base vide, qualification, deux ingestions attestées, rejeux hors réseau et lecture par le moteur `/emplois`. Aucune écriture ni livraison de production. `/offres`, matching et onboarding candidat restent gelés.

## Exécution et résultats

- Exécution complète depuis une archive Git propre de `1a2b20e`, sans les fichiers locaux non suivis ; lecture finale répétée depuis l’archive `5155eae` après adaptation du témoin aux marchés composés.
- Lecteur : `local-sha256:a3d06cd424e8ad6be0ff3125ef05826ee1fccff3b86aeb291efa86de299cd659`.
- Base Docker dédiée conservée : `catwalks_golden_source_test_1790102800325_bef798`.
- Preuves privées sur le poste : `~/.catwalks/golden-source-20260922/run-4/`, notamment `proof.json` et `readback-5155eae.json`. Aucun accès ni RAW dans Git.
- Registre initial vide ; source `oh-my-cream` réellement créée, révision `f61e3bbc-b07a-4f7a-8ee6-c6a87ccd578c`. Identité VERIFIED, accès ALLOWED, validations natives et rejeux exacts.
- Première ingestion : 23 créations ; seconde : 0 création, 23 mises à jour, mêmes identifiants, zéro erreur.
- Deux admissions et deux fins immuables. Pour chacune : 23 sorties scellées, 23 publiées, zéro retenue, échec ou exclusion. Toutes les représentations pointent vers leur nouvelle capture et sortie après réingestion.
- Lecture API : 21 annonces FR, identifiants exactement égaux à la référence SQL. Les deux candidatures spontanées ne déclarent aucune localisation structurée dans le RAW ; elles restent sans pays et hors du marché FR. Le décompte intermédiaire de 22 FR était erroné.
- Première capture non attestante (NEW). Deuxième capture éligible : 23 PRESENT_AND_REATTESTED, terminaison NEXT_URL_NULL, zéro fermeture proposée. Aucune disparition réelle n’a été observée ou simulée.
- Une lecture depuis l’espace de travail contenant des fichiers non suivis rend ACCESS_STALE, conformément à l’empreinte différente du lecteur. Le même contrôle depuis l’archive testée reste éligible ; une qualification ne se transporte pas implicitement sur un autre code.

## Défaut corrigé pendant la preuve

La migration `20260922100000_douglas_brand_property` exigeait une source Douglas préexistante et empêchait une installation vide. `d37a0d0` autorise uniquement l’absence de cette source ; les contrôles de famille et configuration divergentes restent actifs. Les migrations complètes passent désormais depuis zéro.

Avant correction, la migration a été vérifiée absente de `main` et du journal de migrations de production, lu sans écriture. Elle était déjà appliquée sur `catwalks_consolide_rehearsal`. Après sauvegarde privée de sa ligne et vérification de la configuration Douglas attendue, **le checksum de cette seule ligne du journal local a été réconcilié**. Aucune donnée d’offre ou configuration de source n’a été modifiée. Preuve privée : `rehearsal-migration-reconciliation.json` dans le dossier parent des exécutions. Une autre base ayant appliqué l’ancienne version doit faire l’objet de la même vérification explicite ; aucune réécriture automatique des historiques n’a été ajoutée.

## Validation et audit défensif

- Typecheck agrégateur et scripts : vert ; build API depuis archive propre : vert.
- Cinq tests des refus avant écriture : base distante, mauvaise base locale, stockage distant, candidat invalide et dossier de preuve existant.
- Audit indépendant du parcours, du réviseur et de Douglas ; assertion ajoutée pour refuser toute sortie silencieusement exclue et comparer les publications au manifeste.
- `source-campaign` accepte un réviseur explicite ; aucune attribution automatique à un ancien développeur. Procédures d’admission alignées sur F5 : revue d’identité facultative, révision du registre, accès et validation native obligatoires. Le Golden Path exerce aussi la revue d’identité.
- Les bases d’essai précédentes créées pendant ce lot sont retirées après conservation de leurs journaux. La base concluante et ses captures restent disponibles pour inspection.

## Portée

Cette preuve valide l’ajout d’une source Teamtailor par le parcours maintenu, sans développer de connecteur spécifique. Elle ne certifie ni toutes les familles d’ATS, ni tout le catalogue, ni le CRON, ni une release Railway. La publication générale en production reste un lot distinct.

Procédure : [Golden Path reproductible](../../docs/architecture/golden-source.md). Lot précédent : [`/emplois` V1](emplois-v1.md).
