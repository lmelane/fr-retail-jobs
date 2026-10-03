# D-522 §6 — variantes mesurées de D-511 (candidature spontanée) et D-512 (vivier)

## Intitulés exacts relevés
Source : les offres retenues `WORKDAY_EMPLOYER_ABSENT_IN_DETAIL` du RUN `9022fc4b…` que la règle R-142 §3 libère, et les
1 099 offres L'Oréal sans employeur (lot de qualification `682c2ad3…`). Verdict avec la règle corrigée.

| source | intitulé | lecture | publiée ? |
|---|---|---|---|
| brunello-cucinelli | Inviaci il tuo curriculum - Send us your CV | candidature spontanée (libellé ajouté) | **non** (était le défaut) |
| swarovski | Banco de Talentos \| Swarovski Brasil \| Vendedores | vivier qui nomme un poste (« Vendedores ») | oui, D-512 |
| swarovski | Banco de Talentos \| Swarovski Brasil \| Gerentes de Loja | vivier qui nomme un poste | oui, D-512 |
| l-oreal-professionnel | Base de Talentos: Sales & Business Development · Data · Digital & e-Commerce · Medical · Supply Chain/Demand Planning · Trade Marketing & Business Development (6) | vivier qui nomme une famille de postes | oui, D-512 |
| l-oreal-professionnel | Comunidad De Talentos - Comercial · Comunidad de talentos - FINANCE (2) | vivier qui nomme une famille | oui, D-512 |
| l-oreal-professionnel | L'Oréal Luxe Store Manager, London - Talent Community | déjà un libellé, nomme un poste | oui, D-512 (inchangé) |
| mecca | MECCA BRANDS Expressions of Interest - Colour Specialists - New South Wales 2026 | déjà un libellé, nomme un poste (« Colour Specialists ») | oui, D-512 (inchangé, voulu) |

Le cas MECCA est **juste** : le libellé « Expressions of Interest » est déjà lu et l'intitulé nomme un poste, comme « MECCA
Joondalup - Host Expression of Interest ». Ma relecture l'avait compté à tort avec les viviers mal lus ; les deux Swarovski non plus
ne sont pas des défauts (poste nommé). Seul Brunello l'était.

## Libellés ajoutés (`pipeline/spontaneousApplication.ts`)
- D-511 : « Send us your CV / resume / curriculum (vitae) », « Inviaci il tuo curriculum (vitae) / CV ».
- D-512 : « Banco / Base / Comunidad de Talento(s) », à côté de « Bolsa de Talentos ».
Pièges gardés publiés (témoins) : « CV Specialist », « Talent Bank Manager », « Banco de Talentos Coordinator », « Send us your CV
Reviewer », « Inviaci il tuo curriculum vitae manager ».

## Offres actives qui basculeraient (`mesure-vocabulaire.json`)
23 représentations actives portent l'un de ces mots ; **2 seraient retenues** : « Banco de Talentos | Tiffany&Co. Brasil »
(`lvmh` 1, `tiffany-oracle` 1), un vivier pur (Maison et pays seulement). Les 21 autres nomment un poste et restent publiées.
