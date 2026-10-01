# D-500 Q5 : rattacher les intitulés au pluriel, au féminin et en écriture inclusive à leur métier

*Statut : **préparé à blanc, rien n'est écrit en production.** Le code de la lecture 2 est sur `development`
(`packages/db/occupation-title-roles.ts`, `occupation-engine.ts`), inactif tant que la v3 est servie : il ne s'active qu'avec
un manifeste qui déclare `titleReadingVersion: 2`. Contrôle : sur les 89 701 offres actives, la lecture recalculée sous la
v3 rend exactement les `titleRoles` stockés (0 écart).*

## Ce que fait la lecture 2

- Un segment d'intitulé est lu tel quel, puis ramené au singulier quand le vocabulaire des métiers connaît le singulier
  (« VENDEURS » → « VENDEUR », « VENTES » → « VENTE ») ; les lectures s'ajoutent, aucune ne se perd. L'écriture inclusive
  (« Conseiller.e », « Vendeurs.ses ») était déjà repliée par le moteur.
- Une expression vérifiée vaut aussi à l'autre genre (« Conseillère de vente » se lit comme « Conseiller de vente »).
- « Vendeur » devient une expression vérifiée du Conseiller de vente (manifeste v3.1).
- Garde-fous d'une lecture que seule la lecture 2 donne, issus des deux tours de justesse : elle ne s'ajoute qu'à une
  offre que le moteur a laissée sans métier ; un mot seul au singulier ouvre son segment ; jamais sous « assistant »,
  « adjoint », « stagiaire » ; jamais suivie d'un nom de tête (« admin », « coordinator », « support »…).

## Justesse (protocole de D-487 : verdicts de l'assistant committés avant le juge indépendant)

| Tour | Couples | Assistant | Juge | Ce qui en est sorti |
|---|---|---|---|---|
| 1 : offres actives, tous les gains (graine `d500-q5-2026-10-01-actives`) | 165 | 8 faux (4,8 %) | 8 faux (4,8 %), accord 165 / 165 | 7 « Opticians » (enseigne) lus Opticien, 1 « Assistant Chef de projets » : trois garde-fous |
| 2 : offres FERMÉES, jamais lues au tour 1 | 10 | 1 faux | 1 faux, accord 10 / 10 | « Buyers Admin » lu Acheteur : garde-fou du nom de tête |
| Après garde-fous | 157 actives + 9 fermées | 0 faux | 0 faux | **mesure sur les couples qui ont servi à régler les garde-fous** |

Référence de la v3 (D-487, métiers lus) : 0 % selon l'assistant, 3,0 % selon le juge. **Limite connue** : aucun
échantillon neuf ne reste après le dernier garde-fou (tous les gains de la production ont été jugés). Avant le GO,
rejouer `a-blanc.mts` sur les offres arrivées depuis (nouvel échantillon, verdicts committés avant le juge), et ne
promouvoir que si le taux de faux ne dépasse pas celui de la v3.

## Couverture (les 136 offres françaises que le texte trouve et que `metier=sales-advisor` ne retient pas)

- 84 rattachées (61,8 %) ; parmi les 94 dont l'intitulé nomme le métier au pluriel ou en écriture inclusive, 84 (89,4 %).
- Les 10 autres sont arrêtées par des frontières décidées : la parfumerie et la beauté vont au Conseiller beauté
  (« CONSEILLERE VENDEUSE EN PARFUMERIE SELECTIVE »), l'encadrement est un autre métier (« Manager Rayon Cycle/ Vendeur »).
- Les 42 restantes sont d'autres métiers que le texte trouve par leurs missions (« Chargé d'expérience client », « Hôte
  d'accueil », « Digital Client Advisor ») : les rattacher serait faux. *Le critère du cahier (« au moins 90 % des 129 »)
  supposait que ces offres nommaient le métier ; la mesure montre que 31 % d'entre elles ne le nomment pas.*

## Les commandes, sous GO (production, hors de la fenêtre du RUN)

L'ordre compte : un worker d'avant la lecture 2 ignorerait `titleReadingVersion` et ne lirait que « Vendeur ».

```sh
# 0. Le code de la lecture 2 est en production (worker, direct-sync et API promus depuis development), santé vérifiée.
# 1. Le manifeste v3.1, à partir de la v3 versée (déterministe), puis un dernier passage à blanc sur un échantillon neuf.
CATWALKS_DB_ACCESS=<accès> npx tsx audits/2026-10-01/d500-requete/q5/manifeste-v3-1.mts
CATWALKS_DB_ACCESS=<accès> npx tsx audits/2026-10-01/d500-requete/q5/a-blanc.mts tour3 150 actives
# 2. Relecture de la version sur les vraies offres, en lecture seule (reçu de revue).
python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/src/cli.ts occupation-preview \
  --file=audits/2026-10-01/d500-requete/q5/manifeste-v3-1.json --output=<dossier de release>/q5-preview.json
# 3. ÉCRITURE : activation de la v3.1 (bascule atomique de l'état actif, reçu dans DataCorrection).
python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/src/cli.ts occupation-activate \
  --file=audits/2026-10-01/d500-requete/q5/manifeste-v3-1.json --review=<dossier de release>/q5-preview.json \
  --commit=<SHA déployé> --output=<dossier de release>/q5-activation.json --apply
# 4. Le stock : à blanc, puis ÉCRITURE (titleRoles et version des offres en retard).
python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/src/cli.ts classify-jobs --dry-run
python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/src/cli.ts classify-jobs
# 5. La recherche : le changement d'état actif pose la remise en file par tranches (SearchRequeue) ; l'API la sert.
#    Vérifier la file (/api/health) puis la couverture : q5-hors-metier.mts doit rendre ≤ 52 offres (136 − 84).
CATWALKS_DB_ACCESS=<accès> npx tsx audits/2026-10-01/d500-requete/q5-hors-metier.mts
```

Retour arrière (ÉCRITURE, sous GO) : `occupation-activate` ne recrée pas une version déjà publiée (la ligne de la v3
existe) ; le pointeur revient donc à la v3 par une mise à jour revue, puis le stock est relu. Aucune donnée n'est supprimée,
la ligne de la v3.1 reste.

```sql
UPDATE "OccupationState" SET "releaseId" = 'catwalks-occupations-20260929-v3', "backfilledAt" = NULL WHERE id = 'active';
```
puis `classify-jobs --dry-run`, `classify-jobs`.
