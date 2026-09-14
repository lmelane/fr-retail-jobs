# BLOC 7 — contrôle public final, par identifiant

> 2026-09-14, même photographie datée. Échantillon **catégorisé**, pas commode.

## L'échantillon couvre les catégories exigées

| Catégorie | Offres |
|---|--:|
| Nouvelles Maisons (Claire's, Goyard) | 4 |
| `FULL_AUTOMATION` (lvmh, arcteryx) | 3 |
| `PUBLISH_NO_CLOSE` (hugo-boss, skechers) | 3 |
| Offre **fermée** (doit rendre 410) | 2 |
| Offre **multi-source** | 2 |
| Offre internationale | 2 |
| Offre française | 2 |

## Résultat

**18 / 18 conformes · 0 écart.** Les cinq surfaces concordent par **identifiant** : base, API, sitemap,
fiche HTTP, `JobPosting`.

| Surface | Mesure |
|---|--:|
| Sitemap | 18 tranches lues **en entier**, 85 134 URLs, **0 problème** |
| API interrogée | 3 622 identifiants sur les Maisons de l'échantillon |
| **Parité globale base ↔ API publique** | **83 431 = 83 431** |

*Les totaux ne suffisent pas — une offre fermée à tort et une offre ajoutée se compensent parfaitement. La
comparaison porte donc sur les identifiants exacts (leçon P5), y compris pour les offres fermées, qui
doivent rendre 410 et non 200.*
