# Bilan fichier « Global Direct Job Portals A-Z » + récolte 2 (2026-09-05)

Chaque ligne = exécution réelle de l'adaptateur (offres + lieu), jamais une supposition.

## Validés — intégrés ou en cours d'intégration (31 + 8)
Tapestry 2000 · Richemont 1337 · Nordstrom 1294 · Nike 1088 (nke+nke2) · adidas 1056 · H&M 1000 (SmartRecruiters) ·
Saks 748 · Aritzia 554 · Swarovski 502 · Deckers 403 · Avolta 244 · Rolex 208 · Max Mara 191 · Lush 186 · MECCA 179 ·
The RealReal 136 · Chalhoub 126 · Aigle 107 · Space NK 87 · New Balance 81 · The Kooples 67 · Brunello Cucinelli 45 ·
Lagardère TR 31 · Sisley 29 · Balmain 27 · Damiani 26 · Ounass 25 · AMI 20 · Rebag 17 · L'Occitane 16 · SSENSE 15 ·
Tod's 14 · Vestiaire 11 · Olaplex 10 · Lagardère DF 9 · Santoni 9 · WoS US 9 · Clarins 6 · La Redoute 5 · El Palacio 4

## Trois correctifs d'adaptateur sortis de ce fichier
- SuccessFactors : 3e format de lieu (data-careersite-propertyid) — adidas 0 → 1056 lieux
- Workday : accept-language en-US — Nordstrom 500 → 1294 offres
- Détection : l'ATS le plus lié gagne — Nike Avature → Workday, 0 → 1088

## Tenants que le fichier avait FAUX (trouvés à la source)
Tapestry wd5 → wd108 · Richemont careers.richemont.com → richemont.wd3 · Nike → sites nke/nke2 · Olaplex v1 → olaplexcareers

## API propres trouvées par capture réseau (adaptateur à écrire, faisable)
- Rituals : POST careers.rituals.com/api/v1/jobs/ (Elasticsearch, 252 offres, ville) — body capturé
- ASOS : Algolia RVMOB42DFH / production__asoscare2201__sort-rank (64 offres) — même famille que LVMH
- Pandora : TalentHub, /fr/jobs/page/N → générique paginé par chemin (~1800, validation en cours)
- Dr. Martens : __NEXT_DATA__ vacancies, 143 offres, pagination en XHR (à capturer)
- Ba&sh : portail maison rendu JS, 58 offres /fr-FR/offre/BASH_xxx, pas de JSON-LD

## Vendeur sans adaptateur (Lot 5)
Ralph Lauren (Cornerstone) · Brown Thomas/Arnotts (Taleo) · Bloomingdale's (Oracle) · Ulta (iCIMS habillé, 3 sous-portails) ·
Céline (Lumesse TalentLink, career.celine.com 403) · Rivoli (Typesense, clé requise)

## Bloqués — bot-wall ou vide, même au navigateur
Celine · COS · Mango · Harrods · Stockmann (403) · Breitling (SAP natif, rien rendu) · Puig (15 offres SAP natif) ·
Harvey Nichols (feed vide = 0 offre réelle) · Fendi/Lululemon/Moncler (injoignables)
