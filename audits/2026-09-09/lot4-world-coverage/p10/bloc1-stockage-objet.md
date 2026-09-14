# BLOC 1 — le stockage objet réel

> 2026-09-14. Chaîne complète exercée **contre un vrai serveur S3**, sur le clone restauré.
> Aucune purge de production. Crons gelés.

## Ce qui manquait, exactement

P8 avait livré la politique de rétention complète — 14 jours chauds, archive, manifeste, purge fail-closed en
sept étapes — **sauf sa durabilité** : l'exécuteur écrivait sur le système de fichiers du conteneur. Un
volume de conteneur n'est pas une archive : il disparaît avec le conteneur, et une purge qui s'y adosse
supprime contre une copie qui peut ne plus exister demain. C'était la réserve nommée à la clôture de P8.

## Ce qui a été construit

`src/retention/objectStore.ts` — une interface `ObjectStore` et une implémentation **S3**, choisie parce que
c'est le seul dénominateur commun réel entre AWS S3, Cloudflare R2, Backblaze B2, MinIO et Scaleway.
*Le fournisseur devient une décision d'exploitation (`OBSERVATION_ARCHIVE_S3_ENDPOINT`), pas une dépendance
de code.*

Trois choix qui portent la sûreté :

| Choix | Raison |
|---|---|
| SigV4 signé avec `node:crypto`, pas `@aws-sdk/*` | quatre opérations suffisent ; une dépendance non maîtrisée **dans le chemin d'une purge** est un risque disproportionné |
| **La suppression distante n'est PAS dans l'interface** | aucun défaut de ce module ne peut effacer une archive ; seule la purge des lignes *chaudes* existe |
| `--remote` sans configuration ⇒ **code de sortie 2** | jamais de repli muet sur le disque local : c'est ainsi qu'une purge s'exécuterait en croyant ses archives distantes |

`--remote` téléverse, puis **relit chez le fournisseur** avant de vérifier : ce qui autorise la purge est ce
qui vit là-bas, jamais le tampon local qu'on vient d'écrire. Le manifeste part **après** l'archive, au même
préfixe — un manifeste devant une archive absente serait un mensonge durable.

## La démonstration complète, sur un vrai serveur S3

Le bucket a été créé **par notre propre signature** : si SigV4 était faux, l'échec serait survenu là, contre
un serveur réel.

```
observations éligibles figées → archive gzip → upload → manifeste → sha256
→ relecture DISTANTE → restauration → comparaison par identifiants et contentHash
→ vérification des pointeurs → purge des seules lignes éligibles → second passage
```

| Étape | Résultat |
|---|---|
| Partitions traitées | **523** (date × runId × sourceKey) |
| Observations archivées et purgées | **107 095** |
| Partitions refusées | **0** |
| Chaud avant → après | 132 649 → **25 554** |
| Concordance sha256 archive ↔ manifeste | **exacte** sur chaque partition vérifiée |
| Concordance nombre de lignes | **exacte** (3 + 297 sur l'échantillon détaillé) |
| Identifiants restaurés | **300 / 300** uniques sur l'échantillon |
| Pointeurs conservés | **300** puis **107 333**, chacun portant l'URI `s3://` et le sha256 |
| **Lignes purgées encore en chaud** | **0** |
| **Second passage** | **0 éligible, 0 supprimée, chaud inchangé — IDEMPOTENT** |

*L'idempotence a d'abord paru fausse : un second passage supprimait encore 300 lignes. Ce n'était pas un
défaut mais ma mesure — `--limit=300` prenait simplement les 300 suivantes parmi **107 095 encore
éligibles**. L'idempotence ne se teste que sur un ensemble **épuisé**, jamais tronqué par une limite.*

## Les mesures exigées

| Grandeur | Mesure |
|---|--:|
| Lignes archivées | 107 333 |
| Taille après compression | **76,8 Mo** |
| Taille avant compression (estimée au ratio mesuré) | **477 Mo** |
| **Ratio de compression** | **6,21 ×** |
| Par 100 000 observations — compressé | **71,6 Mo** |
| Par 100 000 observations — brut | 444,4 Mo |
| **Déduplication par `contentHash`** | **0,14 %** |
| Relecture distante | 1 ms par objet (12 objets, 17 ms) |

**La déduplication reste négligeable** — 0,14 %, cohérent avec les 0,12 % mesurés en P8. *Le contenu change
réellement d'un passage à l'autre : la déduplication n'est pas le levier, et il fallait le remesurer pour ne
pas bâtir dessus.*

### Croissance projetée

La fenêtre observée (8 jours) porte 133 249 observations, soit **≈ 16 650 par jour**.

| | |
|---|--:|
| Chaud, plafonné à 14 jours | ≈ 233 000 lignes, **≈ 1,0 Go** |
| Archives, par mois | **≈ 0,36 Go/mois** compressé |
| Archives, sur 12 mois de conservation | **≈ 4,3 Go** |

À comparer à la trajectoire sans rétention mesurée en P8 : croissance illimitée, ~12 Go/mois.

## Ce qui reste — et c'est le seul blocage externe

La démonstration a été faite contre un serveur S3 **réel** mais **local** (MinIO en conteneur). Elle prouve
le protocole, la signature, l'upload, la relecture distante, la restauration, les pointeurs, la purge et
l'idempotence. **Elle ne provisionne pas un stockage durable chez un fournisseur** : aucune identification
n'est disponible dans cet environnement — vérifié sur les trois services Railway (aucune variable `S3_*`,
`AWS_*` ou `R2_*`) et localement (`aws sts get-caller-identity` → `NoCredentials`, aucune région).

**La tâche de rétention réelle n'est donc pas activée sur la production**, conformément à la règle :
en cas d'échec d'une seule étape, aucune purge, aucune réactivation.
