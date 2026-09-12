# Cycle 1 — les 21 absences, vérifiées CHEZ LE PUBLIEUR

Run `6e7e070b-a292-45eb-889a-21c6bbee43a0`, commit `feffe3ef`, 2026-09-12.
Chaque absence est vérifiée avec un TÉMOIN observé : une sonde qui répondrait pareil pour tout ne prouverait rien.

## MECCA (Workday) — 12/12 confirmées

Sonde : l'API Workday `/wday/cxs/mecca/careers/job/<path>`, la même que lit l'adaptateur.

| | Résultat |
|---|---|
| 12 absents | `jobPostingInfo` **absent** → `errorCode` |
| 2 témoins observés (R015646, R015650) | posting rendu, titre réel |

⚠️ **Piège** : la page HTML rend **HTTP 200** dans les deux cas (Workday est une application JS).
Le code de statut ne dit rien ; seule l'API discrimine.

## GANNI (TalentRecruiter) — 3/3 confirmées

Sonde : le flux documenté `positionlist`, `customer=ganni` — la source de vérité de l'adaptateur.

Le flux rend **15 projets**, exactement les 15 observés par le cycle 1 :
`143570 144664 144668 144673 144680 144682 144684 144685 144687 144689 144691 144692 144693 144694 144695`

| | Résultat |
|---|---|
| 144681 · 144686 · 144688 | **absents du flux** |
| témoins 144691 · 144692 | présents dans le flux |

⚠️ **Piège plus subtil, et instructif** : la page de candidature de **144681** rend encore **309 KB**, comme une
offre vivante — elle n'a « pas l'air » fermée. Conclure sur la page aurait contredit l'absence. C'est
exactement D23 : *la présence dans le FLUX est la preuve, pas l'état d'une page.*

## American Vintage (DigitalRecruiters) — 6/6 confirmées

Sonde : l'URL stockée de chaque annonce.
Les 6 redirigent vers `?errorKey=career.index.notify_job_ad_close` — « annonce fermée », dit par le publieur.
Témoins observés (4594925, 4592289) : encore publiés.

⚠️ Même piège qu'au-dessus : **HTTP 200** sur une annonce fermée.

## Ce que ces trois sondes ont en commun

Aucune ne lit un code de statut. Les trois publieurs répondent **200** sur une offre morte. Trois fois, le
seul signal exploitable a été **le contenu** ou **l'appartenance au flux** — jamais le transport.
