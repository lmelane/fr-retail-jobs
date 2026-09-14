# BLOC 4 — VAGUE B : portails de groupe et multi-marques

> Périmètre figé avant exécution : `vague-B-perimetre.csv` (2 dossiers).

## Verdicts

| Dossier | Mesure | Verdict |
|---|---|---|
| **ESSILORLUXOTTICA** | page carrière HTTP 200, mais l'adaptateur générique rend **0 offre** en 67 ms ; aucun lien d'ATS dans le HTML statique ; aucun hôte de board (`workday`, `successfactors`, `phenom`…) dans la source | **`OFFICIAL_PORTAL_NOT_PROVEN`** |
| **C&A** | voir la section dédiée ci-dessous — le bon portail existe, le protocole est spécifique | **`NEW_ADAPTER_REQUIRED`** |

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


---

## C&A — correction : le portail existe, et c'est le propriétaire qui l'a donné

J'avais sondé `c-and-a.com` par gabarits et retenu `/fr/fr/shop`, dont la détection tirait un `feedUrl`
pointant sur `/service/feedback` — **une page de réclamations**. Conclusion « portail non prouvé » : fausse,
parce que fondée sur une URL que j'avais fabriquée et non observée (D33, exactement).

Le propriétaire a donné l'URL réelle : **`https://www.c-and-a.com/fr/fr/corporate/company/jobs`**. Mesuré
dessus :

| Mesure | Valeur |
|---|--:|
| HTTP | **200**, 191 249 octets |
| Structure trouvée dans la page | `__typename:"JobsFeed"` |
| **Total annoncé par le portail** | **831 offres** |
| Offres **inline** dans le HTML | **10** (`jobTilesIncrement: 10`) |
| Locales servies | `de_DE`, `en_GB`, `fr_FR`, `hu_HU`, `nl_NL` |
| Pays observés sur l'échantillon | CH, PT, DE, AT |

*C'est une vraie source multi-marques européenne* : titre, slug, lieu, locale et catégorie sont présents par
offre, dans les données d'hydratation de la page.

**Ce qui manque pour l'intégrer** : les 821 autres offres arrivent par une pagination **côté client** —
`?page=2` resert les dix mêmes, et les fiches ne sont **pas au sitemap** (vérifié sur `sitemap_index.xml` et
`/fr/fr/sitemap.xml`). Aucun endpoint n'est lisible dans le HTML statique, et **je n'en devinerai pas un** :
c'est l'erreur qui avait fait conclure « Hugo Boss bloqué » sur un `/api/jobs` extrapolé de Foot Locker.

**Verdict : `NEW_ADAPTER_REQUIRED`.** Le brief l'autorise explicitement quand le protocole est réellement
spécifique, à condition que le développement reste versionné, testé et réutilisable. Condition de reprise :
observer la requête de pagination au rendu navigateur, puis écrire un adaptateur `jobsfeed` générique —
**jamais un script « C&A »**, la structure `JobsFeed` étant celle d'un CMS et non d'une Maison.

**Ce dossier ne bloque aucun autre**, et il vaut correction de méthode : *un gabarit d'URL n'est pas une
source — y compris quand c'est moi qui l'ai fabriqué en sondant un domaine.*
