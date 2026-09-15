# Lot 4H3 : anciennes URLs sans identité publique qualifiée

Validé localement le 16 septembre 2026. Aucune écriture ni livraison en production. Le site reste local, commit `bbedeee` dans `catwalks-website`.

## Décision et preuve native

Le dernier groupe mixte reliait la publication Sephora France `1367552955` à la publication LVMH `295261`. Le RAW de la première ne conserve pas son contenu natif. Celui de la seconde contient son propre texte et son URL de candidature. Le titre commun « Test Global HRIS » ne prouve pas leur équivalence, ni le caractère fictif du recrutement.

La publication Sephora est conservée en quarantaine. Son ancienne Job `cmtt7waed07ppmy01bwifnt2z` garde son identité et son contenu historique privé, avec un retrait explicite `PUBLICATION_UNVERIFIED`. La publication LVMH reçoit une nouvelle fiche `75703ef7-ac05-4238-9dab-afb6b3e0823f`. Aucune redirection n'est inventée, aucun événement `CLOSED` n'est créé.

## Contrat implémenté

- Répartition version 5 : `withdrawJobIds` explicite, identité native originale mise en quarantaine, ID interdit comme destination d'un nouveau groupe, refus d'une redirection historique et d'une fermeture déjà prouvée.
- Retrait, séparation, quarantaine, présentations et journaux dans la même transaction sérialisable. Le rejeu n'écrit rien de plus. Toutes les publications peuvent être conservées sans groupe public ; aucune fiche artificielle n'est nécessaire.
- L'API distingue `withdrawn` de `closed`. Sans contenu fiable : HTTP 410, même ID, `job: null`, aucun lien de candidature ni redirection supposée. L'absence de disponibilité seule n'est plus déclarée comme fermeture employeur.
- Le site affiche le retrait de Catwalks sans l'attribuer à la Maison. Une fiche demandée reste visible quand la recherche est vide ou indisponible ; une pagination périmée ne remplace pas son URL. Le retour conserve le marché explicite et les critères. Le décodeur refuse les états et codes HTTP incohérents.
- Nouvelle collecte qualifiée : la publication conserve son ID, mais ne récupère pas silencieusement l'ancienne URL publique retirée.

Les composants Catwalks existants sont réutilisés selon le skill du projet. Aucun nouveau système visuel, dépendance ou migration.

## Validation et audit défensif

| Contrôle | Résultat |
|---|---:|
| Tests unitaires agrégateur | 2 389 |
| Tests d'intégration | 554 |
| Tests API | 259, 2 optionnels ignorés |
| Tests Python | 5 |
| Total agrégateur/API | 3 207 |
| Tests site | 755 |
| Migrations sur base neuve | 56 |
| TypeScript et compilations API/site | PASS |
| Contre-épreuves détectées, puis code restauré | 5 |

Les mutations tentent de réutiliser une ancienne URL retirée, de retirer un propriétaire qualifié, d'inventer un événement de fermeture, d'omettre le retrait et d'accepter des preuves périmées. Les tests restaurés repassent.

Le premier passage a aussi révélé que la sonde de statut ne chargeait que les publications disponibles : une échéance passée ressemblait alors à une absence sans preuve. La sonde relit maintenant toutes les publications pour qualifier l'état. Le contrat SQL interdit de mélanger fermeture prouvée et retrait ; le plan refuse donc ce cas avant écriture. Les contrôles de non-régression couvrent ces deux frontières.

Vérification réelle du navigateur sur une fixture HTTP locale, ordinateur et mobile : un seul h1, aucun lien de candidature, message lisible, aucun débordement à 390 px, `noindex, nofollow`, navigation vers `/emplois?marche=FR`. Les processus de prévisualisation sont arrêtés et les dimensions du navigateur rétablies. Ce test visuel n'utilise pas les offres de production.

## Application au clone et contrôle indépendant

Sauvegarde complète avant application : **1 133 617 270 octets**, catalogue `pg_restore --list` validé, SHA-256 `1578bb10df6c87adc5bcf5b8df36b5c28816bff4128c1ab777bfeac947aa9159`.

Un plan appliqué et rejoué : une présentation reconstruite, une publication en quarantaine, une nouvelle Job, un retrait historique, deux décisions de publication et un événement `WITHDRAWN`. Zéro fermeture, zéro redirection. Les empreintes SQL globales confirment que RAW, identités natives, horloges, activités natives et observations sont inchangés ; toutes les Job et publications hors périmètre sont inchangées.

Une relecture indépendante en mode SQL lecture seule appelle réellement `getJobStatus` et `getOfferState` sur le clone : l'ancienne URL répond `withdrawn` sans contenu, la nouvelle répond `active` avec le texte et la candidature de sa propre publication. Caches, faits et journal correspondent au plan.

Stock obtenu : **87 607 Job, 90 764 publications, 55 125 présentations, 53 271 groupes entièrement reconstruits, 294 publications en quarantaine, 278 redirections**. Les 53 064 publications portant à la fois un cache et le drapeau natif d'activité ne sont pas un compteur d'offres actuellement disponibles. Aucune des 55 125 publications identifiées comme reconstructibles ne reste bloquée dans un groupe incomplet.

## Limites et suite

Les formats encore non qualifiés et les contenus natifs perdus restent à traiter. Ce lot ne certifie pas les 90 764 publications ni les sources. La répartition refuse les fermetures prouvées qui exigeraient une autre représentation historique ; elle ne les efface pas. La page HTML du site reste `noindex`, avec le statut HTTP final à régler lors de la bascule SEO ; l'API de détail répond déjà 410. Recherche strictement nationale, traductions complètes, coexistence des offres directes, sécurité et exploitation restent soumis aux lots suivants. Aucun statut global « production-ready » n'est déclaré.

## Preuves

[Validation](preuves/lot-4h3-validation.json), [contre-épreuves](preuves/lot-4h3-counterproofs.json), [plan](preuves/lot-4h3-preview.json), [sauvegarde](preuves/lot-4h3-backup.json), [application](preuves/lot-4h3-stock-apply.json), [relecture indépendante](preuves/lot-4h3-stock-verification.json), [bilan du stock](preuves/lot-4h3-stock-balance.json), [validation du site](preuves/lot-4h3-web-validation.json), [préservation des travaux initiaux](preuves/lot-4h3-preservation.json).
