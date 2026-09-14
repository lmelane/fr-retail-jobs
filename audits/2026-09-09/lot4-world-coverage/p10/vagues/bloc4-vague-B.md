# BLOC 4 — VAGUE B : portails de groupe et multi-marques

> Périmètre figé avant exécution : `vague-B-perimetre.csv` (2 dossiers).

## Verdicts

| Dossier | Mesure | Verdict |
|---|---|---|
| **ESSILORLUXOTTICA** | page carrière HTTP 200, mais l'adaptateur générique rend **0 offre** en 67 ms ; aucun lien d'ATS dans le HTML statique ; aucun hôte de board (`workday`, `successfactors`, `phenom`…) dans la source | **`OFFICIAL_PORTAL_NOT_PROVEN`** |
| **C&A** | le `feedUrl` détecté pointe sur `/service/feedback` — une page de **réclamations**, pas un flux d'offres ; 0 offre ; `jobs.c-and-a.com` ne résout pas | **`OFFICIAL_PORTAL_NOT_PROVEN`** |

## Pourquoi ce n'est pas un abandon

Les deux portails sont **rendus par JavaScript** : leur HTML statique ne nomme aucun board, et la détection
ne peut donc pas dériver la référence que D60 exige. *Le domaine ressemble à celui du groupe — c'est
exactement l'indicateur que la vague 1 de P9 a appris à ne pas confondre avec une preuve.*

**Condition de reprise, nommée** : identifier le board par un rendu navigateur (le transport existe déjà,
`fetchRenderedHtml`), archiver la page qui le nomme, puis rejouer `source-onboard prepare`. Aucun des deux
n'est réfuté ; ils sont **non prouvés en l'état**.

## Ce que la vague B enseigne, et qui vaut au-delà d'elle

`GENERIC_JSONLD` détecte volontiers un `feedUrl` WordPress sur n'importe quel site : mesuré ici sur
**C&A** (`/service/feedback`), et plus tôt sur **PERCASSI** (« Newsletter 2 ») et **CWF**
(« Kids around se mobilise ! »). *Une détection à 0,75 de confiance sur un flux WordPress ne dit rien de la
présence d'offres — seule l'exécution de l'adaptateur le dit, et elle coûte moins d'une seconde.*

C'est pourquoi aucun dossier de ce lot n'a été admis sans que son adaptateur ait été **exécuté**.
