# P9 · VAGUE 1 — bilan définitif

> Reclassée **VAGUE PRÉPARATOIRE DE DIAGNOSTIC DU PROCESSUS** par décision du propriétaire, après que le
> constat « 0/16 certifiées » a été accepté et la conclusion « la vague est terminée » refusée.
> *« La constitution des preuves EST le travail de P9. »*

## Ce que la vague visait, et ce qu'elle a réellement produit

Elle devait certifier 16 sources déjà actives sous le contrat strict de D60, sans ajouter ni acteur ni offre.
Résultat mesuré en production le 2026-09-14 : **16 sources ACTIVE, 1 certifiée** (`lovisa`).

**Ce chiffre est le bon résultat d'une vague de diagnostic, pas un échec de production.** Il dit exactement
ce que la chaîne de preuve exige et ce que l'inventaire ne fournissait pas.

## Mon erreur de conception, nommée

J'avais construit l'inventaire sur `onOfficialDomain` — une comparaison de domaines enregistrables — et je
l'avais lu comme « preuve disponible ». **Le domaine est un indicateur ; D60 exige une page officielle
archivée et hachée qui NOMME le board configuré.** Deux cas réels l'ont démontré, et aucune comparaison de
domaines ne les aurait rapprochés de leur Maison :

- `kult-olymp-hades` appelle `jpweltersgorgensgmbhcobekleidungskg.recruitee.com` ;
- `oak-essentials` appelle le board Greenhouse `jennikayne`.

## Le piège de la preuve circulaire, trouvé sur un cas réel

`primark` est ressorti **PROUVÉ** — la concordance venait du fichier de police `PrimarkBasis-Bold.woff2`.
Une référence de board égale au nom de la Maison prouve seulement que la Maison s'appelle comme elle-même.
Garde ajoutée : cette égalité **lève** désormais.

Second défaut du même ordre : une tentative en échec **écrasait un enregistrement de preuve PROUVÉ**
(`rituals`, `sha256: null`). Les tentatives ratées sont désormais conservées à part.

## Ce que la vague a livré, et qui sert tout le reste de P9

| Livrable | Ce qu'il apporte |
|---|---|
| `certification/portalProof.ts` | `PROVEN` / `REFUTED` / **`UNVERIFIABLE`** — « je n'ai pas pu lire » n'est jamais « la page dit non » |
| `certification/boardReference.ts` | la référence se **dérive de la configuration** par type d'ATS, jamais d'un mot libre ; garde anti-circularité |
| `certification/build-proof.mts` | archive, hache, extrait, et **ne sort 0 que sur PROUVÉ** |
| chaîne B6 versionnée | `certify-existing.sh`, `integrate.mts`, `aliases.mts`, `lib.mts`, gardes de déploiement |
| `lib/hardDeadline.ts` | l'échéance devient **contraignante côté appelant** — `deadlineMs` en config est coopératif, `avature.ts` ne le lit pas |

## Le dossier bloqué, et pourquoi il ne bloque rien d'autre

`ralph-lauren-avature` : la validation ne rend pas la main depuis cet egress (figée 64 minutes sous une
échéance de 5 minutes, ce qui a révélé le défaut d'échéance **général** corrigé ci-dessus). La source
fonctionne depuis l'egress de production (1 073 offres, run du 08/09) et publie 1 104 offres.

**`BLOQUÉ AVEC CONDITION DE REPRISE`** — condition : une validation qui termine depuis l'egress de production
avec `robotsVerdict = ALLOWED`, `parsed ≥ 1`, `truncated = false`. Il **reste dans le périmètre gelé** : un
dossier bloqué n'est pas retiré pour faire un meilleur bilan.

## Verdict de la vague

**`VAGUE DE DIAGNOSTIC — RÉCEPTIONNÉE`.** Elle n'a ajouté aucune offre, par construction, et n'en revendique
aucune. Elle a produit la **chaîne de preuve** sans laquelle la vague 2 n'aurait pu intégrer personne — et
c'est en la construisant qu'ont été trouvés les défauts d'échéance, de circularité et d'écrasement de preuve.
