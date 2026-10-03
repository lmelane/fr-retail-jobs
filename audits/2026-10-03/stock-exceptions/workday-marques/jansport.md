# jansport (`workday:vfc/jansport_careers`, tenant VF) : NON certifié SINGLE_BRAND

**Lecture en direct impossible le 03/10/2026.** `robots.txt` de `vfc.wd5.myworkdayjobs.com` lu quatre fois entre 06:20 et
07:00 UTC (identité `CatwalksBot/1.0`) : `503 {"errorCode":"ERR_TENANT_OUTAGE"}` — maintenance du tenant Workday VF. Aucune autre
requête n'a été faite.

**Preuve retenue : la collecte complète du 02/10/2026 16:03 UTC, archivée** (lot d'ingestion `538a6701-0157-4cd3-b5bc-55c1ea1e55f0`,
relu sans réseau par `lire-jansport.mts`, sortie `jansport-capture-20261002.jsonl`). La liste annonce `total = 4`, les 4 fiches sont
archivées :

| intitulé | lieu | entité | marques citées dans la description |
|---|---|---|---|
| Sales Representative | London, Axtell House | (vide) | Eastpak, Kipling, JanSport, VF |
| Sales Representative | Antwerp, VF Europe Link 1 | (vide) | Eastpak, JanSport, Kipling, VF |
| Sales Coordinator (Americas) (**Eastpak, JanSport, & Kipling**) | Jersey City - KIP | VF Outdoor, LLC | Eastpak, JanSport, Kipling, VF |
| **Jansport/Eastpak** - Associate Planner, eCommerce | Jersey City - KIP | (vide) | Eastpak, VF |

Le site publie les postes de la division « Packs » de VF (Eastpak, JanSport, Kipling), pas ceux de JanSport seule : d'après la
consigne du CTO, **pas de certification**. Les 3 annonces restent retenues ; la 4e (« VF Outdoor, LLC ») publie aujourd'hui sous
l'entité « VF Outdoor, LLC » (ligne propre à la source, aucun alias).

**Ce qu'il faudrait pour aller plus loin (question au CTO)** : la source est inscrite au registre pour la Maison « JanSport ». La
passer MULTI_BRAND publierait les annonces sans marque sous « JanSport » (nom au registre), ce qui serait faux pour une annonce
Eastpak ou Kipling. Options : (A) la laisser retenue (recommandé, 3 annonces, aucune fausse attribution) ; (B) la retirer et laisser
`vf-corporation`, qui publie déjà ces mêmes postes (l'annonce « Jansport/Eastpak » y figure), les porter sous le groupe ;
(C) renommer sa Maison au registre en « VF Corporation » puis MULTI_BRAND (aucun chemin outillé, nouvelle révision de source).
