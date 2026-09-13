# P8 · stockage et coût — la vraie limite de capacité n'est pas le temps

> Mesuré sur les **deux passes T2** (18 sources, 10 281 offres chacune), 2026-09-13.
> Références `pg_total_relation_size` (table + index + TOAST) avant/après.

## Ce que deux passes T2 ont coûté

| | |
|---|--:|
| Taille de la base après | **3,351 Go** |
| **Delta pour deux passes** | **+104,8 Mo** |

| Table | Delta | Part |
|---|--:|--:|
| **`SourceObservation`** | **+61,6 Mo** | **59 %** |
| `JobSource` | +16,8 Mo | 16 % |
| `Job` | +15,2 Mo | 14 % |
| `PipelineEvent` | +0,9 Mo | 1 % |
| `JobEvent` | +0,2 Mo | — |

Lignes : `SourceObservation` **+12 451**, `Job` +590, `JobSource` +592, `PipelineEvent` +278.

*Un delta de taille inclut autovacuum et statistiques : il **majore** ce que le run a écrit.*

## Le point qui décide : `SourceObservation` croît SANS BORNE

Une observation pèse ~4,95 ko. Le corpus T2 en écrit **12 451 pour deux passes**, soit ~6 200 par passe pour
10 281 offres — **une observation par offre et par passe**, par construction : c'est la trace qui permet de
prouver une absence par ensemble d'identifiants (P7).

**Aucune purge n'existe.** Mesuré en base :

| | |
|---|--:|
| Total | **128 821** lignes |
| Plus ancienne | 2026-09-06 |
| Plus récente | 2026-09-13 |
| Plus de 30 jours | **0** |
| Plus de 7 jours | **3** |

Le « 0 au-delà de 30 jours » n'est pas une purge qui fonctionne : **la table n'a que sept jours d'existence.**
Rien ne la borne.

## Extrapolation à la production — prudente, et nommée comme extrapolation

La production compte **86 429 représentations** sur 433 sources actives, soit **8,4 ×** le corpus T2.

| | |
|---|--:|
| Coût d'une passe T2 | 52,4 Mo |
| **Une passe complète de production** | **~441 Mo** |
| **Un mois de passes quotidiennes** | **~13,2 Go** |

*Ce sont des extrapolations linéaires depuis un corpus de 12 % de la production. Elles donnent un ordre de
grandeur, pas une prévision : le coût par offre pourrait varier avec la taille des descriptions.*

**Sur une base de 3,35 Go, ajouter ~13 Go par mois quadruple la base en un mois et la multiplie par treize en
un trimestre.**

## Le verdict de capacité, et il n'est pas celui qu'on attendait

P8 cherchait la capacité soutenable. Le temps ne la borne pas : T2 absorbe 5,2 × le volume de T1 pour 2,4 × le
mur, la mémoire reste à 4 % de la limite, le CPU à 20 %, et les portails freinent sans jamais rejeter.

**La borne est le stockage, et plus précisément l'absence de politique de rétention sur `SourceObservation`.**

C'est un défaut **réel et non corrigé**, hors du périmètre de P8 — le corriger demande une décision produit
(combien de jours d'observation faut-il conserver pour que la preuve d'absence garde sa valeur ?), pas un
réglage technique. La question appartient au propriétaire.

**Ce que P8 peut affirmer** : la capacité en temps, en mémoire et en politesse réseau est soutenable à
l'échelle mesurée. La capacité en stockage ne l'est pas au-delà de quelques semaines de passes quotidiennes,
faute de rétention. Les deux verdicts sont distincts et aucun ne remplace l'autre.
