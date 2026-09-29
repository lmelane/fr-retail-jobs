# Périmètre des portails bloqués par l'identité (D-453 §4, exécution du 29/09/2026)

Mesuré en production en lecture seule (`apps/aggregator/scripts/ops/sources-intermediaires.mts`, rôle `catwalks_audit`,
section `portails`) : RUN du 29/09/2026, refus `PORTAL_OWNER_NOT_CERTIFIED` sur 24 h.

| Source | Propriétaire au registre | Portail | Refus 24 h | Libellé porté par les offres refusées | Périmètre posé |
|---|---|---|---|---|---|
| `tiffany-oracle` | Tiffany & Co. | Oracle HCM, site `CX` | 470 | « Tiffany & Co. » | `SINGLE_BRAND` : une seule Maison, son portail |
| `rivoli-typesense` | Rivoli Group | www.rivoligroup.com | 46 | « Rivoli Group » | `SINGLE_BRAND` : l'employeur de toutes ses boutiques, comme Chalhoub déjà publié |
| `brown-thomas-taleo` | Brown Thomas Arnotts | Taleo | 11 | « Brown Thomas Arnotts » | `SINGLE_BRAND` : un employeur, ses deux enseignes |
| `lvmh` | LVMH (toutes Maisons) | lvmh.com | 60 | « LVMH » | `MULTI_BRAND` : 53 Maisons prouvées (`portails-groupe-sans-scope.mts`) ; ses offres sans Maison restent refusées (lecteur à compléter) |

**Arbitrage du CEO (D-478, 29/09/2026)** : Beauty Success (87), Groupe Printemps (100), Hot Topic (19) et les trois sources
Lagardère (128), déclarés `MULTI_BRAND` par une relecture technique et dont aucune offre ne nomme l'enseigne, publient
sous le nom du groupe employeur : `SINGLE_BRAND` posé par `portails-groupes-d478.csv`.

**Orthographes relues (29/09/2026, lot `20260929-D453-EMPLOYER-SPELLING-v1`, `alias-orthographe-d453.json`)** : alias
limités à la source et fusions, appliqués par `record-employer-alias.mts` (78 offres actives déplacées, 2 alias).

| Source | Libellé des offres | Employeur retenu | Preuve |
|---|---|---|---|
| `b-s-international` | « B&S International » | B&S International ; « B's » (68 offres) et « B's International » (0) y sont fusionnées : orthographes erronées du registre | API SmartRecruiters du compte configuré `BSInternational` ; offre de careers.bs-international.com qui y renvoie |
| `funky-buddha` | « ALTEX S.A. » | Funky Buddha ; « ALTEX S.A. » (10 offres) y est fusionnée, comme MECCA Brands NZ Pty Ltd sous MECCA | API SmartRecruiters du compte `ALTEXSA` ; balisage Organization de funky-buddha.com (« ALTEX S.A. designs, produces, and distributes… ») |

Défaut connu : le registre nomme encore la Maison « B's International ». Le libellé du registre entre dans l'empreinte
de la source (`sourceIdentityHash`) : le corriger invalidera l'alias, à réenregistrer dans le même geste.

**Preuve par exécution, sans attendre le RUN** (`scripts/ops/rejouer-identite.mts`, lecture seule, transaction
annulée) : sur les offres refusées du RUN du 29/09, les 11 sources traitées se résolvent toutes (939 offres :
Tiffany 475, Lagardère 128, Groupe Printemps 102, Beauty Success 87, B&S 55, Rivoli 46, Hot Topic 20, Funky
Buddha 15, Brown Thomas 11). Écarts de nom avec le texte de D-478 : Groupe Printemps sort sous « Printemps » et
Lagardère Duty Free sous « Lagardère Duty Free » (noms au registre).

Restent refusées : LVMH (30 offres sans Maison dans l'index public de LVMH : entités du groupe, Moët Hennessy, LVMH
Watches & Jewelry, La Grande Épicerie, LVMH Chine), et une offre chacune chez Browns (Farfetch), Crocs et Monoprix
(portails multi-enseignes, offre sans enseigne), Richemont (Richemont → Cartier) et Swatch Group (Flik Flak → Swatch).
