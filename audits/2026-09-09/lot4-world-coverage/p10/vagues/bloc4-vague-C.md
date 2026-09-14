# BLOC 4 — VAGUE C : portails régionaux et sources supplémentaires

> Périmètre figé avant exécution : `vague-C-perimetre.csv` (1 dossier).

## Skechers `/fr/fr` — `ALREADY_COVERED_BY_SOURCE`, et c'est la mesure qui le dit

| Mesure | Valeur |
|---|--:|
| Offres publiées par `skechers-phenom` (`/us/en`) | **1 656** |
| Identifiants rendus par `/fr/fr` | **1 542** |
| **Communs aux deux** | **1 539** |
| **Nouveaux apportés par `/fr/fr`** | **3** |

Les trois identifiants « nouveaux » portent le suffixe `…EXTERNALENUS` — le même corpus américain, servi
sous une autre locale, avec trois annonces parues entre les deux lectures.

**Créer cette source aurait dupliqué 1 539 offres déjà publiées.** C'est exactement le cas D34, et il a été
évité parce que la comparaison s'est faite **par ensembles d'identifiants**, jamais par les totaux : 1 656
contre 1 542 aurait pu se lire comme « deux périmètres différents, 114 offres d'écart ».

*Ce dossier confirme le constat de P9 — le backend Skechers sert le périmètre mondial quelle que soit la
locale demandée.*

## Verdict de la vague C

| Dossier | Verdict |
|---|---|
| Skechers `/fr/fr` | **`ALREADY_COVERED_BY_SOURCE`** — 1 539 / 1 542 identifiants déjà publiés |

**0 source créée, 0 offre ajoutée — et c'est le bon résultat.** Le brief interdit de gonfler un compteur en
dupliquant une couverture : la valeur de cette vague est d'avoir **prouvé** qu'il n'y avait pas de lacune,
au lieu de le supposer.

## La catégorie reste à démontrer

Aucun portail régional réellement distinct n'a été trouvé dans le vivier sondé. La catégorie n'est pas
réfutée : elle attend un dossier dont le périmètre diffère, **prouvé par ensembles d'identifiants avant
toute création de source**. C'est désormais un contrôle outillé (`findOverlaps` +
`PORTAIL_REGIONAL_EXISTANT`), pas une vigilance à retenir.
