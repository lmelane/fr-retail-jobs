# BLOC 4 — VAGUE A : Maisons et enseignes sur ATS maîtrisés

> Exécutée le 2026-09-14. Run borné `20260914T092744Z`, commit `a2eeb50a`,
> **`validForCapacity: true`, `COMPLETED`, 0 problème, aucun 429.**

## Le résultat

| Dossier | Acteur | ATS | Preuve D60 | Servies | Uniques | Publiées | Verdict |
|---|---|---|---|--:|--:|--:|---|
| `claires-workday` | Claire's | Workday | `corporate.claires.com` · sha `d99f30b7…` | 12 | 12 | **12** | `INTEGRATED` |
| `goyard-successfactors` | Goyard | SuccessFactors | `goyard.com/fr/carrieres` · sha `bc539264…` | 19 | — | **19** | `INTEGRATED` |

**31 offres uniques réellement ajoutées.** Catalogue 82 114 → **82 145**, sources ACTIVE 435 → **437**.
Parité publique vérifiée : API Claire's **12**, API Goyard **19**, base = API.

Pour les deux : `complete = true`, 0 retenue, **0 refus d'identité**, 0 erreur d'écriture,
taux de description **100 %**, taux d'URL **100 %**. Contrôle public par identifiant : **10/10 conformes,
0 écart**, 31 identifiants d'API pour 31 offres en base.

**Aucun script par Maison n'a été écrit** : configuration + preuve + validation, sur deux familles ATS déjà
supportées. C'est la propriété que le lot devait démontrer.

## Deux lectures à ne pas confondre

**`uniquesObservees: 0` chez Goyard n'est pas une perte.** L'adaptateur SuccessFactors ne DÉCLARE pas de
`canonicalIds` (`ids déclarés = false`, méthode `OBSERVED_RMK_PER_LOCALE_TOTALS`). Le contrat l'autorise :
il en découle simplement qu'**aucune absence ne sera jamais démontrable depuis cette source**, ce que le
registre traduit en refusant `FULL_AUTOMATION`.

**`canAttestAbsence: false` sur les deux est correct pour un run `NEW`** : sans run antérieur, il n'y a
aucun ensemble auquel comparer, donc aucune absence à attester. `NEW` n'est pas un échec (P7).

## Ce que l'exécution a éliminé, sur preuve d'exécution

Quatre candidats du vivier ont été écartés **parce que l'adaptateur a été exécuté**, pas parce qu'ils
paraissaient douteux :

| Candidat | Mesure | Verdict |
|---|---|---|
| **PERCASSI** | `feedUrl` rend des **articles de blog** (« Newsletter 2 ») | pas un flux d'offres |
| **CHILDREN WORLDWIDE FASHION** | idem (« Kids around se mobilise ! ») | pas un flux d'offres |
| **SUNGLASS HUT** | **0 offre** en 10 s | portail à qualifier autrement |
| **MODELOR** | **0 offre** en 5,7 s | portail à qualifier autrement |

*Un portail qui répond 200 et porte un mot de recrutement n'est pas une source : seule l'exécution de
l'adaptateur le dit.*

## Trois refus de garde, tous justes

| Refus | Motif | Ce qu'il a évité |
|---|---|---|
| Préflight ×2 | `HEAD ≠ commit attendu` | exécuter un code différent de celui vérifié |
| Préflight ×1 | `--commit doit être un SHA complet` | un ancrage ambigu sur une abréviation |
| Préflight ×1 | **`4,8 Gio libres, 8 Gio requis`** | démarrer sans place pour le dump et le clone |

Le dernier n'était pas un incident de production : **chaque run borné laisse derrière lui un clone
`catwalks_p7_preflight_*` de ~2,7 Go qu'aucun programme ne supprimait.** Huit clones, **21 Go**, sur un
disque à 1,5 Gio libres. `purge-preflight-clones.mts` en fait désormais une opération maintenue.

Le préflight a aussi **prouvé les canaux d'alerte en conditions réelles** : `brevo: SENT_201`,
`heartbeat: PINGED_200`.
