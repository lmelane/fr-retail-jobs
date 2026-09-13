# P8 · les clés de limitation EFFECTIVES, lues sur les runs réels

> Table produite par `tenant-key-table.mts` sur les **quatre** runs P8 : `5a5cc452`, `8dd68ca2` (T1 corrigé),
> `687c482a`, `4d8ba33f` (T2). Le programme n'énonce pas la règle : il appelle `rateLimitKeyFor`, la fonction
> que `hostGate` utilise réellement, sur les hôtes **observés** pendant ces runs.

**28 hôtes observés → 21 clés de limitation distinctes.**

## Le seul regroupement : URBN

| Clé | Hôtes regroupés |
|---|--:|
| **`tenant:urbn.icims`** | **8** |

`homeoffice-eu` · `homeoffice-na` · `hub` · `menusandvenues-na` · `stores-eu` · `stores-na` ·
`supplychain-eu` · `supplychain-na` — tous en `.urbn.icims.com`.

Sans cette clé, la porte accordait **huit budgets de politesse à un tenant unique**. C'est le défaut que T1
avait nommé et que la protection corrige.

## Les tenants Workday sont SÉPARÉS, et c'est voulu

| Clé | Hôte |
|---|---|
| `tenant:knitwellgroup.workday` | `knitwellgroup.wd1.myworkdayjobs.com` |
| `tenant:mango.workday` | `mango.wd3.myworkdayjobs.com` |
| `tenant:richemont.workday` | `richemont.wd3.myworkdayjobs.com` |
| `tenant:nordstrom.workday` | `nordstrom.wd501.myworkdayjobs.com` |
| `tenant:saks.workday` | `saks.wd1.myworkdayjobs.com` |
| `tenant:deckers.workday` | `deckers.wd5.myworkdayjobs.com` |
| `tenant:fastretailing.workday` | `fastretailing.wd3.myworkdayjobs.com` |
| `tenant:mecca.workday` | `mecca.wd3.myworkdayjobs.com` |

**Huit hôtes Workday, huit clés distinctes.** Les regrouper sous un « tenant Workday » serait une faute :
`myworkdayjobs.com` est une **plateforme**, pas un tenant. Chaque client Workday applique sa propre limite —
ce que T2 démontre directement : `mango` encaisse 35 refus quand `mecca`, sur la même plateforme, en encaisse
**zéro**. Un budget commun aurait pénalisé les sept autres pour la seule pression de `mango`.

*La mesure valide la règle : la limite est par tenant, jamais par plateforme.*

## Les hôtes inconnus retombent sur leur nom, conservativement

Douze hôtes n'appartiennent à aucun motif de tenant reconnu et prennent `host:<hostname>` :
`api.digitalrecruiters.com`, `candidate.hr-manager.net`, `recruiter-api.hr-manager.net`,
`careers.am-vintage.com`, `careers.groupe-rocher.com`, `gateway.harri.com`, `jobs.aptar.com`,
`jobs.puig.com`, `lagardere-recrute.talent-soft.com`, `lindex.easycruit.com`, `www.beiersdorf.com`,
`www.beiersdorf.de`.

Le repli est **par nom d'hôte complet, jamais par eTLD+1**. `www.beiersdorf.com` et `www.beiersdorf.de` sont
donc deux clés : ce sont deux frontaux, et rien dans nos mesures ne prouve qu'ils partagent une limite.
**Supposer un regroupement serait plus risqué que de ne pas le faire** — un regroupement erroné bride deux
hôtes indépendants, une séparation erronée ne fait que rester poli deux fois.

## Ce que la table établit

| Fait | Statut |
|---|---|
| La distinction hostname / tenant atteint le chemin opérationnel réel | **PROUVÉ** — la fonction appelée est celle de `hostGate` |
| Les 8 sous-domaines URBN partagent un budget | **PROUVÉ** |
| Les tenants Workday restent séparés | **PROUVÉ**, et validé par leurs 429 divergents |
| Aucun regroupement non prouvé n'est appliqué | **PROUVÉ** — 12 hôtes en repli conservateur |
