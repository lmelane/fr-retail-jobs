# Personio, Jako, KENT — chaque dossier sur ses preuves

État au 9 septembre 2026 (reprise du LOT 4, soir). 24 sources Personio au catalogue (22 ACTIVE, 2 RETIRED dont Saltrock et Towa déjà traitées). Chaque tenant a été relu à la source : page du tenant (`<slug>.jobs.personio.de`), libellé d'employeur natif (`subcompany`), et page officielle du domaine que le tenant lui-même désigne. Quatre catégories, quatre traitements, **aucune décision fondée sur le seul nom ou le seul tenant**.

## 1. Homonymie prouvée par lien réciproque officiel → identité séparée + retrait (5)

| Source | Tenant nomme | Domaine officiel qui lie le tenant | Ce que c'est | Ce qu'on croyait | Motif |
|---|---|---|---|---|---|
| `mateo` (9 offres) | Mateo Estate GmbH | `hellomateo.de/unternehmen/karriere` → `mateo.jobs.personio.de` | SaaS immobilier, Berlin | Mateo, joaillerie (`mateonewyork.com`) | IDENTITY_CONTRADICTED |
| `pina` (2) | Pina Earth / Pina Technologies GmbH | `pina.earth` → `pina.jobs.personio.com` | crédits carbone forestiers | « Piña » (indéterminé) | OUT_OF_SCOPE |
| `samson` (1) | Samson & Partner | `samson-partner.de/home/karriere.html` → tenant | cabinet de conseils en brevets | « Samson » (indéterminé) | OUT_OF_SCOPE |
| `kent` (13) | KENT Deutschland GmbH / KENT Europe GmbH | `kenteurope.com/karriere/darum-kent/` → tenant | fournisseur B2B de produits chimiques d'atelier, Duisburg ; 13 postes de vente terrain | « KENT » — l'entité visée par le libellé historique **reste indéterminée** (Kent Brushes ? autre ?) et n'est pas décidée ici | OUT_OF_SCOPE |
| `hades` (7) | Hades Mining GmbH | empreinte `hades.com/imprint` (Hades Resources GmbH, Munich, technologies minières) désignée par le tenant | technologie minière | « Hades » (indéterminé) | OUT_OF_SCOPE |

Traitement (plan « propriétaire de portail », protocole Saltrock) : une société **distincte** est créée dans l'espace `REVIEWED_` (domaine officiel + libellé complet, jamais un rapprochement par domaine seul), les offres lui sont réattribuées puis retirées (`WITHDRAWN`, jamais `CLOSED`), la source passe RETIRED. **Les sociétés d'origine (Mateo, Piña, Samson, KENT, Hades) sont conservées telles quelles**, sans fusion, prêtes pour une future source réellement à elles.

## 2. Identité indéterminée ou contenu non publiable → retrait revu, aucune identité créée (3)

| Source | Preuve | Pourquoi pas de séparation d'identité | Décision |
|---|---|---|---|
| `giga` (2) | tenant « Jobs bei GIGA Hamburg » (institut de recherche) ; `giga-hamburg.de` répond **HTTP 429** (Vercel checkpoint) à toute lecture, navigateur compris | pas de page officielle lisible : on ne crée pas une identité qu'on ne peut pas prouver | retrait ; société Giga inchangée |
| `atlantis` (3) | tenant lie `atlantis-vt.de` (**certificat TLS invalide**, illisible) ; 3 postes logistique | idem | retrait ; société Atlantis inchangée |
| `jako` (20) | `subcompany: JAKO AG`, Mulfingen (vraie société de sport) ; **les 20 descriptions natives sont « Ihre Aufgaben : Test / Ihr Profil : Test »** (payload archivé) ; la page emplois officielle `jako.com/de-de/ueber-jako/karriere/jobs-jako/` ne lie pas ce tenant et n'affiche qu'une candidature spontanée | ce n'est ni un homonyme ni une démo d'éditeur : c'est un tenant au contenu vide, non relié par le site officiel | retrait du contenu non publiable ; **société Jako conservée** (`jako.com`) pour une future source qualifiée ; backlog J1 |

## 3. Variantes juridiques légitimes → aucune mutation, alias à certifier (14)

Aeyde GmbH · Alpha Industries GmbH & Co. KG · Closed Direct GmbH / Closed Direct NL B.V. / Closed Antwerp / Closed NewCo GmbH · Groundies GmbH · Julie and Grace GmbH · Laverana GmbH & Co. KG (Hannover / Bantorf / Wennigsen) + Laverana International AG · LERROS Moden GmbH · Merz B. Schwanen e.K. · ORTOVOX Sportartikel GmbH · Pegador® · PEPCO Germany GmbH · Stanley/Stella IN / BE / Inc. US · THOMAS SABO GmbH & Co. KG / TSJ Holding GmbH · Got Bag (sans libellé).

Ces libellés sont des entités juridiques ou des sites de la marque catalogue, cohérents avec le slug du tenant et le domaine connu. Ils ne sont **ni des erreurs ni 230 « fausses offres »** : ils restent attribués à leur marque par le chemin hérité (`LEGACY_UNREVIEWED`). Ce qui manque est la **certification** : lien officiel site → tenant, puis alias source-scopés revus. C'est le chantier des 413 sources actives héritées sans revue (tracker v3, `LEGACY_UNCERTIFIED`), à mener par la porte `SourceIdentityReview`, pas par une passe automatique.

## Preuves sur copie fraîche de production

Copie `catwalks_lot4_replay_20260909d` (dump `before-otb-aptar-production.dump`, identique à la production au moment de la prise). Deux plans : homonymes **74 opérations** (5 sociétés créées, 5 sources, 32 représentations, 32 offres), retraits revus **53 opérations** (3 sources, 25 représentations, 25 offres) ; rejeu **0 / 0** ; **57 offres retirées, 0 `closedAt` écrit**, clôtures antérieures inchangées, identifiants, RAW et événements conservés (`personio-clone-proof.json`).

## Preuve après production (17:42 UTC)

Appliqué avec le code déployé (`main 772ee8d`, workers SUCCESS ; web resté sur `68cbc4a`, diff vide sur `apps/web`, `packages/db`, `package.json`, `package-lock.json`). Les deux plans ont des patches **identiques aux témoins du clone** (contrôle bloquant avant écriture).

| Plan | Hash | Opérations | Rejeu |
|---|---|---:|---:|
| Homonymes (5 identités `REVIEWED_`, 5 sources RETIRED, 32 représentations, 32 offres) | `a877e6aca5e92115…` | 74 | 0 |
| Retraits revus (3 sources RETIRED, 25 représentations, 25 offres) | `c7b96834db68b285…` | 53 | 0 |

**57 offres retirées, 0 `closedAt` écrit**, clôtures antérieures inchangées, 77 447 identifiants, RAW et événements conservés. Sociétés créées : Mateo Estate GmbH (`hellomateo.de`), Pina Technologies GmbH (`pina.earth`), Samson & Partner (`samson-partner.de`), KENT Europe GmbH (`kenteurope.com`, SUPPLIER), Hades Resources GmbH (`hades.com`) ; Mateo, Piña, Samson, KENT, Hades, Giga, Atlantis, Jako **inchangées**. Production après : 74 130 actives (74 187 avant).

Public (`personio-public-production-proof.json`) : les **57 témoins répondent 410 sans `JobPosting`** ; `/api/jobs?maison=` Mateo, KENT, Jako, Hades, Giga, Atlantis, Samson, Piña : **0** chacune.

| Finding | Fixé ? | Commit / merge | Main ? | Déployé ? | Données réparées ? | Preuve prod |
|---|---|---|---|---|---|---|
| 5 tenants Personio homonymes liés à d'autres employeurs | Oui | plans revus ; code PR 51 | Oui | Oui | 5 identités séparées, 32 offres retirées | `personio-production-proof.json` |
| Giga, Atlantis : identité indéterminée, domaine illisible | Retrait, identité non décidée | — | — | — | 5 offres retirées | idem |
| Jako : contenu vide (« Test ») non relié au site officiel | Retrait ; source officielle à trouver | — | — | — | 20 offres retirées, société conservée | idem ; backlog J1 |
| 14 variantes juridiques Personio | Non (légitimes) : certification à faire | — | — | — | Aucune mutation | tracker v3 `LEGACY_UNCERTIFIED` |
