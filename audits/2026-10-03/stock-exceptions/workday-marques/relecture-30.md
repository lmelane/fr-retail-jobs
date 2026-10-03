# Relecture à la main de 30 annonces libérées par la règle (mesure à blanc du 03/10/2026)

Tirage au hasard (graine fixe 20261003, puis 7 pour la 30e) parmi les 2 240 annonces retenues `WORKDAY_EMPLOYER_ABSENT_IN_DETAIL`
au RUN `9022fc4b-1b96-431d-bee9-86ed244ef4f1` que la règle libère : au moins une par source libérée, 8 Levi's, 5 VF, 3 Nike nke2,
plus une Beyond Yoga. Chaque annonce est relue sur son intitulé, son lieu, son magasin et le début de sa description (sortie
scellée du RUN). Le verdict juge la Maison sous laquelle l'annonce publierait, et la publication elle-même.

| # | source | intitulé (lieu) | règle → Maison | verdict |
|---|---|---|---|---|
| 1 | mango | VENDEDOR/A … FRANQUICIA GETAFE (Madrid) | propriétaire → Mango | juste (magasin Mango en franchise ; la Maison est Mango) |
| 2 | swarovski | SAP Technology Engineer (Bandar Bayan Baru) | propriétaire → Swarovski | juste (centre de services Swarovski) |
| 3 | canada-goose | Seasonal Retail Associate (CF Sherway Gardens) | propriétaire → Canada Goose | juste |
| 4 | puma | ストアマネージャー（店長） | propriétaire → Puma | juste (la description nomme PUMA) |
| 5 | mecca | MECCA Chadstone - Brow Specialist | propriétaire → MECCA | juste |
| 6 | aritzia | Store Management - Store Manager (Texas) | propriétaire → Aritzia | juste |
| 7 | uniqlo-hkm-headquarters | Senior Officer, HR Business Partner | propriétaire → UNIQLO | juste |
| 8 | nordstrom | Seasonal Retail Stock - Willow Grove Park Rack | propriétaire → Nordstrom | juste (Rack est l'enseigne de Nordstrom) |
| 9 | brunello-cucinelli | Inviaci il tuo curriculum - Send us your CV | propriétaire → Brunello Cucinelli | **faux : candidature spontanée** (D-511) ; l'employeur est juste, la publication ne l'est pas — le lecteur D-511 ne reconnaît pas « Send us your CV » |
| 10 | therealreal | Field Sales Account Manager (Remote - California) | propriétaire → The RealReal | juste |
| 11 | uniqlo-stores | Store Staff … Saisonkraft, UNIQLO Berlin | propriétaire → UNIQLO | juste |
| 12 | levis | Part-Time Tailor, Levi's® Times Square | marque → Levi's | juste |
| 13 | levis | Part Time Supervisor, Levi's® Cherry Hill | marque → Levi's | juste |
| 14 | levis | Stylist 8hr (LS GUILDFORD) | groupe → Levi's | juste (magasin Levi's, « LS » ; aucune marque nommée en toutes lettres, donc le groupe, dont le nom au registre est Levi's) |
| 15 | levis | Engineer II, Systems Reliability Engineering (Bengaluru) | groupe → Levi's | juste selon la règle, **réserve** : poste du groupe Levi Strauss & Co., publié sous « Levi's » parce que c'est le nom de la Maison au registre de la source |
| 16 | levis | Sales Associate, Levis® Outlet Store, Louisville | marque → Levi's | juste |
| 17 | levis | Seasonal Store Sales Associate, Levi's®, Nebraska Crossing | marque → Levi's | juste |
| 18 | levis | Sales Stylist 12h LFO A Coruña Pop Up | groupe → Levi's | juste (magasin d'usine Levi's) |
| 19 | levis | Sales Stylist/Verkäufer (LS BERLIN MEMHARDSTRASSE) | groupe → Levi's | juste |
| 20 | nike | Lead Business Planner (Beaverton) | groupe → NIKE | juste |
| 21 | nike-nke2 | Retail Associate, PT - Nike Estero | marque → NIKE | juste |
| 22 | nike-nke2 | Retail Associate, PT - Nike Anthem | marque → NIKE | juste |
| 23 | nike-nke2 | Retail Associate, SEAS - Nike Dania Pointe | marque → NIKE | juste |
| 24 | movado | Temporary Distribution Clerk (US Distribution Center) | groupe → Movado | juste selon la règle, **réserve** : entrepôt de Movado Group (toutes marques), publié sous « Movado », nom au registre |
| 25 | vf-corporation | icebreaker: Seasonal Sales Associate - Queen West Touchlab | marque → Icebreaker | juste |
| 26 | vf-corporation | Commesso/a … Serravalle Scrivia (« nostri negozi VF ») | groupe → VF Corporation | juste (plusieurs magasins du groupe) |
| 27 | vf-corporation | Seasonal Associate, General Warehouse (Jonestown ECDC - VAN) | groupe → VF Corporation | juste (entrepôt du groupe ; le code « VAN » n'est pas un nom, la règle ne le lit pas) |
| 28 | vf-corporation | Vans: Sales Lead - Rehobeth Beach | marque → Vans | juste |
| 29 | vf-corporation | The North Face: Supervisor - Gallatin Crossing | marque → The North Face | juste |
| 30 | levis | Full-Time Supervisor, Beyond Yoga- Outlets at San Clemente | marque → Beyond Yoga | juste |

**Bilan : 27 justes, 2 justes avec réserve (nom du groupe), 1 faux (publication d'une candidature spontanée).**
Aucune annonce n'est attribuée à une Maison d'un autre groupe ni à une marque qu'elle ne nomme pas.

Les deux réserves ont la même cause : la règle publie le groupe sous le nom de la Maison au registre de la source (R-142 §3,
D-479 §3), et ce nom est « Levi's » pour `levis`, « Movado » pour `movado`, « Nike » pour `nike`/`nike-nke2` — pas « Levi Strauss &
Co. », « Movado Group », « Nike, Inc. ». Le faux vient du lecteur D-511 (`spontaneousApplicationProof`), qui ne reconnaît ni
« Send us your CV », ni « Banco de Talentos » (Swarovski, 2 annonces), ni « Expressions of Interest » (MECCA, 1) : ces quatre annonces
publieraient. Voir le README du dossier.
