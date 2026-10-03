# Fjällräven : couverture rétablie par le portail du groupe Fenix Outdoor (D-522 §6, arbitrage du CTO, 03/10/2026)

**Constat** (`fenix-outdoor-feed-20261003.txt`) : la source `fjallraven` (`career.fjallraven.com`, Teamtailor) est
ACTIVE et lit 0 offre : la Maison n'y publie plus rien. Ses 22 offres nord-américaines (libellé natif « Fjällräven
North America ») sont sur le portail du groupe `career.fenixoutdoor.se` (65 offres, 8 employeurs), que la page
officielle `career.fjallraven.com` lie. Arbitrage du CTO : option A, une source limitée à Fjällräven ; les autres
enseignes du groupe passeront par l'onboarding standard avec le contrôle de périmètre sectoriel.

**Code** : réglage `employer` du lecteur Teamtailor (libellé natif exact, forme NFC) ; les offres d'un autre employeur
ne sortent pas et ne figurent pas dans la preuve d'énumération (`outOfScopeEmployer`). Naturkompaniet (source ACTIVE
`naturkompaniet`) est exclue par le filtre : aucun doublon. Témoin : `teamtailor.test.ts`, fixture réduite du feed réel.

**Après le RUN d'acceptation de r6**, la release portant ce commit étant livrée :
```sh
# 1. Nouvelle source (qualification, décision d'accès, promotion, ingestion)
sh apps/aggregator/start.sh source-add --key=fjallraven-fenix-outdoor --name=Fjällräven --kind=teamtailor \
  --careers-url=https://career.fenixoutdoor.se/jobs --official-domain=fjallraven.com --tier=GROUP_OFFICIAL \
  --reviewer=loic-melane-d522 --setting=origin=https://career.fenixoutdoor.se '--setting=employer=Fjällräven North America'
# 2. Si l'identité retient les offres (libellé « Fjällräven North America » inconnu) : alias limité à la source
python3 apps/aggregator/scripts/ops/db.py production npx tsx apps/aggregator/scripts/ops/record-employer-alias.mts \
  --spec=audits/2026-10-03/stock-exceptions/fjallraven/alias-fjallraven-north-america.json --phase=production        # aperçu
#    puis la même commande avec --apply ; le RUN suivant publie.
```
Risque connu : la relation d'identité de la campagne doit accepter `career.fjallraven.com` (sous-domaine du domaine
officiel) comme page qui lie le portail ; sinon la qualification le dira (`EXACT_PORTAL_REFERENCE_NOT_FOUND`) et
`tester-lien-portail.mts` permet de relire le lien. La source `fjallraven` reste ACTIVE à zéro attesté (feed vide
explicite, protocole natif Teamtailor) : état normal, pas une panne.
