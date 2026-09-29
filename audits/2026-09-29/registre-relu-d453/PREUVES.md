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

Restent : B&S International et
Funky Buddha (`EMPLOYER_SPELLING_DIVERGED` : orthographe à relire).
