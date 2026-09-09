# Run borné « familles corrigées » — Rituals, Eightfold (Kering), Workday (Mango, Capri, Nordstrom), Swatch (2026-09-09, 19:47 → 19:55 UTC)

Objet : preuve **en production, depuis l'egress du cron**, des correctifs d'énumération livrés par les PR 60 et 63 (Rituals union des locales, connecteur/Eightfold, Workday pages), sur le commit mergé `c3f2014`. Protocole borné (`INGEST_ONLY_KEYS`, exécution manuelle, attente de la fin réelle, restauration de la commande normale — déploiement `e703ff26`, `SUCCESS`). Aucun merge pendant le run (garde). Preuves : `families/`.

## Résultat par source (SourceRun de production, run `5f093d17`, `COMPLETED_WITH_ERRORS`, 256 événements durables, 0 perte)

| Source | Lu | Déclaré | Complet | Créées / ré-attestées | Refus d'écriture | Statut | Lecture |
|---|---|---|---|---|---|---|---|
| `rituals` | **1 123** | 1 123 | **oui** | 46 / 1 077 | 0 | OK | Correctif union des locales prouvé en prod (avant : 1 245 actives dont des représentations par langue ; 1 088 puis 577 dans l'historique) |
| `capri-michael-kors` | 512 | 512 | **oui** | 0 / 505 | 7 | DEGRADED | Complet ; 7 nouvelles annonces refusées par la porte d'identité (entités juridiques, voir §2) |
| `capri-jimmy-choo` | 51 | 51 | **oui** | 0 / 50 | 1 | DEGRADED | idem (« J Choo Germany GmbH ») |
| `mango` | 1 627 | 1 628 | non (−1 ligne) | 7 / 1 536 | 57 | DEGRADED | 57 nouvelles annonces refusées (9 entités juridiques Mango) ; la ligne manquante est à lire avec la preuve de page Workday (PR 63/64, non encore déployée au moment du run) |
| `nordstrom` | 1 303 | 1 312 | non | 0 / 1 194 | **107** | DEGRADED | 107 nouvelles annonces refusées (« Nordstrom Inc » → Nordstrom) ; les 3 lignes sans `externalPath` sont nommées par la PR 64 |
| `kering` | 1 030 | 1 031 | non (−1) | 23 / 1 001 | 6 | DEGRADED | 6 offres dont le flux ne porte plus la propriété Maison cette fois (Saint Laurent, Boucheron, Kering Corporate, Kering Eyewear → libellé « Kering ») : la porte **refuse le changement d'identité**, l'offre garde sa Maison — comportement voulu |
| `swatch-group` | **61** | 61 | (ancien code : pas de preuve) | 10 / 51 | 0 | DEGRADED | **Effondrement de volume** (293 actives, 265 la veille) : le pager Drupal a rendu une page sans lien nouveau dès la 3ᵉ page ; `attestation.ts` a refusé la purge (« 78 % fewer offers »), rien n'a été fermé. La PR 64 archive chaque page du pager : la prochaine lecture dira si c'est le site ou la lecture |

Offres actives : 74 169 → 74 255 (+86 créées). Aucune fermeture (refresh en pause), aucune purge (toutes refusées faute de run attestable, sauf Rituals complet à 0 erreur).

## 2. Constat systémique : les nouvelles annonces des sources non certifiées sont bloquées par la porte d'identité

Les **178 refus** sont tous `EmployerIdentityReviewRequired` sur des annonces **nouvelles** dont le libellé natif est une **entité juridique** (Workday `brandFromWorkdayDetail` : « Nordstrom Inc », « MANGO FRANCE, S.A.R.L. », « MANGO MNG, S.A. », « Michael Kors Retail Inc », « Michael Kors (Canada) Holdings LTD », « J Choo Germany GmbH »…) et non un alias source-scopé revu. Les annonces existantes sont ré-attestées normalement ; **seule la création est bloquée** — donc ces sources ne peuvent plus grandir tant que leurs libellés ne sont pas revus. Ce n'est pas un bug de la porte (elle fait ce pour quoi elle existe : aucune identité sans preuve), c'est la conséquence attendue des **402 sources actives `LEGACY_UNCERTIFIED`** notées au tracker.

Correction universelle à livrer (lot suivant, données) : pour chaque source, une revue d'alias source-scopés couvrant les libellés natifs observés (`EmployerObservation`), selon la règle D45 déjà arbitrée par Loïc — **entité juridique d'une Maison → rattachée à la Maison** (« Nordstrom Inc » → Nordstrom, « MANGO FRANCE, S.A.R.L. » → Mango, « Michael Kors (Canada) Holdings LTD » → Michael Kors) avec, pour preuve, la page native qui nomme la marque (logo/`hiringOrganization`) et le domaine officiel de la source ; les cas non triviaux (« J Choo Germany GmbH » → Jimmy Choo : forme juridique historique) passent en revue nominative. Mesure préalable : nombre de sources et de libellés concernés sur tout le catalogue, à partir des observations `REVIEW_REQUIRED`.

## 3. Ce que ce run ne prouve pas

- Mango −1, Kering −1 : pas de cause nommée sur ce run (code d'avant PR 63/64 pour Workday ; Eightfold sans preuve de page — prochaine correction commune candidate) ;
- Swatch 61/293 : lecture ou site, à trancher par la preuve de page de la PR 64 ;
- rien sur la couverture mondiale ni sur l'identité (dimensions distinctes du tracker).
