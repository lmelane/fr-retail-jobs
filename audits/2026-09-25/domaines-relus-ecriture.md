# Écriture des domaines relus pour les logos — 25/09/2026

**Accord** : GO explicite de Loïc (CEO), le 25/09/2026 vers 13:15 (heure de Paris), sur la question « J'écris en production
les 154 domaines relus ? ». Écriture hors du RUN de 18 h.

**Ce qui a été écrit** : `Company.domain` (et `Company.domainSource = logos-relu-2026-09-25`) pour les 154 sociétés du fichier
`domaines-relus-logos.json` : 144 domaines complétés sur des sociétés qui n'en avaient pas, 10 corrections dont l'ancienne
valeur a été vérifiée au moment d'écrire (dont un retrait : Donzé-Baume). Aucune autre colonne, aucune autre société.

**Comment** :

1. Essai à blanc d'audit, lecture seule (`catwalks_audit`, transaction `READ ONLY`), rejoué avant l'écriture :
   154 à écrire, 0 déjà posé, 0 refus, aucune exécution du pipeline ouverte depuis moins de 12 h.
2. Inspection par le script d'écriture, sans écrire : même plan, empreinte
   `2386223e29bbe761e00e800b45112300a95edac5f9f0b257773f18ea4b60d03c`.
3. Écriture : `python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/scripts/ops/poser-domaines-relus.mts
   audits/2026-09-25/domaines-relus-logos.json --ecrire=<empreinte ci-dessus>`, en une transaction, chaque ligne conditionnée
   à la société, au nom et à l'ancien domaine relus.

**Résultat** : `154 domaine(s) écrit(s) · relu(s) conforme(s) en base : 154/154`.

**Contrôles après écriture** (API de production, clé du site) :

- `/api/jobs` rend désormais `petitbateau.com` pour Petit Bateau, `nocibe.fr` pour Nocibé, `maje.com` pour Maje,
  `katespade.com` pour Kate Spade ;
- `/api/logo` sert une image (200) pour ces quatre domaines ; `lovisa.com` reste en monogramme (404) jusqu'à la livraison
  du correctif du seuil (`apps/api/app/api/logo/route.ts`) ;
- deux des huit logos d'une autre entreprise, contrôlés visuellement avant l'écriture : `petit-bateau.com` servait le logo
  d'OVHcloud, `douglas.group` celui de Douglas Group pour Nocibé.

**Retour arrière** : les valeurs antérieures (domaine et provenance) sont dans `logos-societes.json` ; un fichier inverse
passé au même script les remet.
