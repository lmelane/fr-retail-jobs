# R-143 §4 et §5 — dédoublonnage par preuves natives, Maison avant l'entité juridique (02/10/2026)

Décision : [[D-513]] (backend, `docs/governance/DECISIONS.md`), règle R-143 §4 et §5. Constat de départ :
`audits/2026-10-02/comparaison-indeed/canonique-dedup.sql` (2 734 groupes de doublons visibles, 3 594 offres en trop ;
Nike 40 entités, Puma 42, Uniqlo 33, Hugo Boss 21, Michael Kors 23).

Tout est sur `development`. Rien n'a été écrit en production. Les deux commandes ci-dessous n'ont été lancées qu'en
prévisualisation et sur la base de test locale. Elles partiront avec une release contrôlée, après un RUN fait par ce code.

## Ce qui est construit

| | Code | Témoin |
|---|---|---|
| Réquisition SAP publiée par le portail LVMH (`atsId`, lien `career55.sapsf.eu … jobId=N`) et par le site RMK de Sephora (« Job ID: N » dans le texte publié) | `identity/successfactorsRequisition.ts` | `successfactorsRequisition.test.ts`, `pipeline/r143-dedoublonnage.test.ts` |
| Fiche Teamtailor d'une enseigne publiée par le site du groupe (Etam → Maison 123, Undiz) : identité **déléguée** | `identity/teamtailor.ts` (`teamtailorDelegatedIdentity`) | `teamtailor.test.ts` |
| Publication SmartRecruiters citée par WTTJ (`detail.apply_url`) : identité **déléguée** | `identity/smartrecruiters.ts` | `smartrecruiters.test.ts` |
| Une délégation ne prouve qu'en face de la publication que l'émetteur sert lui-même | `dedup/match.ts` | les trois fichiers ci-dessus |
| Rattrapage du stock : `consolidate-publications` (prévisualisation, `--apply`) | `dedup/consolidate.ts` | `pipeline/r143-dedoublonnage.test.ts` |
| Entité juridique → Maison : `attach-maisons` (prévisualisation, `--apply`, `--output=`) | `identity/maisonAttachment.ts`, `identity/maisonPlan.ts` | `maisonAttachment.test.ts`, `pipeline/r143-maison.test.ts` |

## Rejouer les mesures (jamais entre 15:30 et 18:30 UTC)

```sh
DB='python3 apps/aggregator/scripts/ops/db.py readonly sh -c'
$DB 'psql "$DATABASE_URL" -X -A -t -q -f -' < audits/2026-10-02/r143-dedoublonnage-maison/extraction-publications.sql > /tmp/r143/publications.jsonl
$DB 'psql "$DATABASE_URL" -X -A -t -q -f -' < audits/2026-10-02/r143-dedoublonnage-maison/extraction-offres-servies.sql > /tmp/r143/servies.jsonl
$DB 'psql "$DATABASE_URL" -X -A -t -q -f -' < audits/2026-10-02/r143-dedoublonnage-maison/extraction-employeurs.sql > /tmp/r143/employeurs.jsonl
npx tsx audits/2026-10-02/r143-dedoublonnage-maison/mesure-dedoublonnage.mts /tmp/r143/publications.jsonl /tmp/r143/servies.jsonl --echantillon=20 --fusions=/tmp/r143/fusions.jsonl
audits/2026-10-02/r143-dedoublonnage-maison/contre-epreuve-job-invite.sh /tmp/r143/fusions.jsonl
python3 audits/2026-10-02/r143-dedoublonnage-maison/mesure-second-etage.py /tmp/r143/publications.jsonl
npx tsx audits/2026-10-02/r143-dedoublonnage-maison/mesure-maison.mts /tmp/r143/employeurs.jsonl
```

Les mesures appellent les fonctions du code (`blockingKey`, `publicationIdentityProof`, `provenPublicationGroup`,
`selectApplySource`, `maisonPreview`) ; aucune preuve n'est réimplémentée dans les scripts.

## Résultats mesurés le 02/10/2026 (base de production, lecture seule, ~09:00 UTC)

### §4 — doublons servis

| | Avant | Après (à blanc) |
|---|---|---|
| Offres servies | 89 766 | 87 627 |
| Groupes « même Maison, même intitulé, même ville, sources différentes » | 2 734 | 1 011 |
| Offres en trop si ces groupes sont de vrais doublons | 3 594 | 1 137 |

| Motif | Fusions |
|---|---|
| Réquisition SAP : portail LVMH ↔ site RMK Sephora | 1 884 |
| SmartRecruiters : publication citée par WTTJ | 148 |
| Teamtailor : fiche de l'enseigne hébergée par le site du groupe Etam | 107 |
| **Total** | **2 139** |

Aucun groupe refusé. Aucune identité prouvée sur deux employeurs différents.

- **Contre-épreuve native, motif SAP** : pour chacune des 1 884 fusions, la redirection de l'éditeur
  `jobs.sephora.com/job-invite/<réquisition>/` mène à la publication RMK fusionnée : **1 884 OK, 0 KO**
  (`resultat-contre-epreuve-job-invite.txt`). La sonde préalable, 80 réquisitions tirées au hasard, donnait 80/80.
- **Relecture à la main** de 20 fusions, tirées par empreinte et réparties par motif (`resultat-mesure-dedoublonnage.txt`) :
  même intitulé, même ville et même identifiant natif des deux côtés à chaque fois. **0 fausse fusion.**
- **Restent** 1 011 groupes : 703 LVMH + Sephora (publications RMK sans ligne « Job ID », hors États-Unis surtout),
  ~300 WTTJ + employeur (Pandora, Groupe Rocher, ba&sh, Lacoste, Teamtailor cité par WTTJ…), sans preuve native lue.
- `refresh.ts`, `availability.ts` et `publications.ts` ne sont pas touchés ; la règle d'autorité existante choisit l'offre conservée.

### Second étage déterministe : écarté

Mesuré sur la seule population où la vérité est connue (1 919 publications RMK qui déclarent leur réquisition) :
même Maison, même intitulé exact, même ville, même date et même empreinte de description réunissent **3 paires de
réquisitions différentes** (« Seasonal Associate » Boston 29/09, Dallas 30/09, « Equipment Operator 1 » Las Vegas 20/09).
L'étage fusionnerait de vrais recrutements : il n'est pas construit (`resultat-second-etage.txt`).

### §5 — la Maison avant l'entité

282 entités rattachées à 41 Maisons (4 669 offres servies). Une ligne Maison est à créer (Puma). 2 entités restent à
part, signalées en revue : L'Occitane en Provence (Maison du registre = un groupe) et Michael Kors (Italy) (publiée aussi
par la source Jimmy Choo). Tableau des 15 plus grandes et relecture complète des 282 : `resultat-mesure-maison.md`.

| Maison | Entités | Offres sous le nom de la Maison, avant → après |
|---|---|---|
| NIKE | 40 | 390 → 875 |
| HUGO BOSS | 21 | 0 → 766 |
| Puma (à créer) | 43 | 0 → 635 |
| UNIQLO | 32 | 377 → 571 |
| Michael Kors | 21 | 326 → 510 |

## Ordre de release

1. Déployer le code ; laisser passer un RUN (les clés natives se posent à l'ingestion).
2. `consolidate-publications` sans `--apply`, lire le rapport ; puis `--apply`, hors RUN.
3. `attach-maisons --output=…` sans `--apply`, relire ; puis `--apply` depuis l'image déployée (son commit signe chaque correction).
4. Remesurer avec les extractions de ce dossier.
