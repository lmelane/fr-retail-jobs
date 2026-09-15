# Lot 4F1 — Échéances liées à l’identité native

**Validé sur base jetable et sur la copie complète du catalogue. 2 939 échéances prouvées reprises localement ; 3 210 cas restent en examen. Aucune écriture de production.**

## Défaut corrigé

Le lot 4E3 montrait qu’un chemin de date qualifié pouvait être repris sans preuve suffisante de son rattachement à la publication. Le plan passe à la **version 3** : il exige l’identifiant natif, l’URL, le tenant et les contrôles d’employeur et d’état applicables au format. Une identité valide reste utilisable lorsque seul le texte descriptif manque. Le lecteur de date reste en version 5.

Lorsqu’une capture est référencée, le moteur vérifie aussi sa source, son adaptateur, sa sortie immuable, le RAW associé et l’absence de retenue de publication. Une provenance incohérente ne permet aucun repli historique. Une sortie ancienne correctement archivée ne suffit pas si son identifiant contredit le RAW natif. Le contrôle s’exécute également lorsque le cache d’échéance correspond déjà : l’absence d’écriture ne masque pas une preuve invalide.

Les corps actuels, antérieurs et capturés partagent la limite de 32 Mo par page. Les lectures d’archives ont lieu avant les verrous ; les corps vérifiés sont réutilisés dans la transaction. L’audit a aussi reproduit une course entre deux applications : le journal et les lignes sont désormais lus dans le même snapshot, avec un nouveau contrôle après un échec de prélecture. Une application concurrente déjà terminée est reconnue sans réécriture.

## Répétition sur tout le stock

Le premier preview parcourt **90 323 représentations, 536 sources et 362 pages**, en 15,4 secondes localement : 2 939 changements admissibles et 3 210 examens. Les 441 représentations sans registre restent hors de ce périmètre connu, comme indiqué au lot 4E3. [Preview initial](preuves/lot-4f1-expiry-preview.json).

Les 120 plans sans examen contiennent 2 582 changements. Les 357 autres changements qualifiés côtoient des examens dans leurs pages : chacun a fait l’objet d’un nouveau plan borné à sa seule ligne, avec vérification de l’identifiant et de l’absence d’examen. Les plans mixtes initiaux n’ont pas été modifiés ni appliqués. Au total, **2 939 écritures et 477 plans**, tous rejoués avec zéro nouvelle écriture. [Application locale](preuves/lot-4f1-stock-apply.json).

Les empreintes de `JobSource` contrôlant RAW, identité et attestation, et celles du contenu `Job`, restent identiques. Les 2 939 observations ajoutées conservent les horloges antérieures ; aucune capture ni événement de cycle de vie n’est créé. Les 87 580 offres et 90 764 représentations sont conservées. [Avant](preuves/lot-4f1-before-apply.json), [après](preuves/lot-4f1-after-apply.json).

Le second preview exhaustif trouve **zéro changement et les mêmes 3 210 examens**, en 14,8 secondes. Les liens de groupes, présentations et faits ne sont pas remplis par ce lot. [Contrôle après application](preuves/lot-4f1-after-expiry-preview.json).

## Validation défensive

- **3 064 tests passent** : 2 294 unitaires, 511 d’intégration, 254 API et 5 Python ; deux tests API optionnels sont ignorés.
- Typage des workspaces, scripts et build API passent. Les 55 migrations sont rejouées sur la base jetable ; aucune dérive de schéma.
- **11 contre-épreuves** réintroduisent séparément les défauts d’identité, de provenance, de contenu manquant, de cache déjà égal, d’adaptateur, d’état retenu, de limite de taille, de lecture sous verrou, de falsification de preuve, de confiance dans un ancien lecteur et de concurrence. Toutes rendent leurs régressions rouges ; la version restaurée passe. [Contre-épreuves](preuves/lot-4f1-counterproofs.json).
- CLI réelle : preview, application, réapplication, rejet d’un examen, quatre arguments invalides, refus d’écrasement et permissions 0600 vérifiés. [CLI](preuves/lot-4f1-cli-smoke.json).
- Les travaux locaux préexistants restent conservés. La documentation ops ne recommande plus l’option supprimée `--revision`. Les anciens plans sont refusés par leur version ; aucun moteur de compatibilité n’est conservé.

[Validation et empreintes des journaux](preuves/lot-4f1-validation.json). [Préservation des travaux initiaux](preuves/lot-4f1-preservation.json).

## Limites et suite

Les 3 210 examens comprennent les relations iCIMS hub/détail, les nœuds génériques sans identité suffisante, certaines URL Workday, six cas Phenom et une publication Workday retenue. Ces cas restent à qualifier sur les réponses natives et observations conservées. Une date lisible ne justifie aucun assouplissement global des identités.

Le lot 4 reste ouvert : reprise des groupes, remplissage des présentations, qualification restante et traitement des historiques sans registre. Les validations ci-dessus ne constituent ni une validation de charge ni une déclaration de disponibilité globale en production.
