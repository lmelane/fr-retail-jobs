"""LA BASE MONDIALE DE VILLES (D-496) : GeoNames `cities500`, chargée dans GeoCity / GeoCityName / GeoCityLabel.

Sources : https://download.geonames.org/export/dump/ (villes) et https://download.geonames.org/export/zip/ (codes
postaux, D-499) — licence Creative Commons Attribution 4.0
(https://creativecommons.org/licenses/by/4.0/). Attribution exigée : « Données géographiques : GeoNames
(geonames.org), CC BY 4.0 ». Elle est enregistrée avec chaque chargement (table GeoCityRelease).

Deux étapes, rejouables :

  preparer [--cache DIR] [--sans-libelles]
      Télécharge les fichiers absents du cache (défaut : ~/.cache/catwalks-geonames), puis écrit
      DIR/charge/{villes,noms,libelles}.tsv et DIR/charge/manifeste.json (empreintes SHA-256). Aucune base.

  charger [--cache DIR] [--ecrire] [--forcer]
      Charge DIR/charge dans la base de $DATABASE_URL (psql), en UNE transaction : tables temporaires,
      puis mise à jour idempotente (une ville inchangée n'est pas réécrite ; une ville retirée de la source est
      retirée avec ses noms). Sans --ecrire : la même transaction est annulée (ROLLBACK), le compte rendu dit ce
      qui changerait. Refuse un fichier tronqué (moins de 200 000 villes) ou un chargement qui retirerait plus de
      2 % des villes en place, sauf --forcer.

  Production (sur GO, hors RUN) :
      python3 apps/aggregator/scripts/geo/villes.py preparer
      python3 apps/aggregator/scripts/ops/db.py production python3 apps/aggregator/scripts/geo/villes.py charger
      python3 apps/aggregator/scripts/ops/db.py production python3 apps/aggregator/scripts/geo/villes.py charger --ecrire
  Après un chargement, rattraper le point des offres : scripts/geo/rattrapage-*.sql.

Ce qui est retenu, et pourquoi (README de ce dossier) :
  - toutes les localités de `cities500` (classe P, plus de 500 habitants), sauf les lieux historiques, abandonnés ou
    détruits (PPLH, PPLQ, PPLW, PPLCH) ;
  - D-499 : un arrondissement est un lieu, avec son point ; en France il s'affiche « Paris 15e » (un seul par numéro,
    GeoNames en porte certains deux fois) ; une entité administrative (« London Borough of Bexley ») n'est pas proposée ;
  - les codes postaux de GeoNames (`export/zip/allCountries.zip`, même licence), chacun avec le lieu qu'il dessert ;
  - les noms : nom principal et forme ASCII (principaux), variantes de toutes langues ;
  - les libellés : le nom d'usage dans chaque langue de l'interface (fichier alternateNamesV2), quand il diffère du
    nom principal (« München », « Londres »).
"""
import argparse
import hashlib
import io
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

SOURCE = 'https://download.geonames.org/export/dump/'
SOURCE_POSTAUX = 'https://download.geonames.org/export/zip/'
FICHIERS = ['cities500.zip', 'admin1CodesASCII.txt', 'alternateNamesV2.zip', 'readme.txt']
# Les codes postaux (D-499) : même licence ; enregistrés sous un autre nom (le dossier des villes a aussi un allCountries.zip).
FICHIERS_POSTAUX = {'postaux-allCountries.zip': 'allCountries.zip', 'postaux-readme.txt': 'readme.txt'}
POSTAUX_MIN = 1_000_000
LICENCE = 'CC BY 4.0'
ATTRIBUTION = 'Données géographiques : GeoNames (geonames.org), CC BY 4.0'
EXCLUS = {'PPLH', 'PPLQ', 'PPLW', 'PPLCH'}
# Les langues des catalogues de l'interface (sous-étiquette principale). « nb » lit aussi « no ».
LANGUES = ['fr', 'en', 'de', 'it', 'es', 'nl', 'pt', 'ja', 'ko', 'zh', 'da', 'pl', 'sv', 'tr', 'th', 'ms', 'ar', 'nb',
           'el', 'vi', 'cs', 'hu', 'ro']
ALIAS_LANGUE = {'no': 'nb'}
VILLES_MIN = 200_000
RETRAIT_MAX = 0.02
# « Paris 15 Vaugirard », « Lyon 03 », « Marseille 13e Arrondissement » : la ville, un numéro, éventuellement un nom.
ARRONDISSEMENT = re.compile(r'^(.+?) (\d{1,2})(?:e|er|ème)?(?: .*)?$')
ARRONDISSEMENT_POSTAL = re.compile(r'^(.+?) (\d{1,2})$')
# « London Borough of Bexley », « Royal Borough of Greenwich » : une subdivision administrative, jamais proposée.
SUBDIVISION_NOMMEE = re.compile(r'^(?:London|Royal|Metropolitan|County) Borough of |\bCounty Borough$')
# Un code « CEDEX » (France) désigne un gros destinataire de courrier, pas un lieu.
CEDEX = re.compile(r'\bCEDEX\b', re.I)


def cache_par_defaut() -> pathlib.Path:
    return pathlib.Path(os.environ.get('CATWALKS_GEONAMES_CACHE', pathlib.Path.home() / '.cache' / 'catwalks-geonames'))


def sha256(chemin: pathlib.Path) -> str:
    h = hashlib.sha256()
    with chemin.open('rb') as f:
        for bloc in iter(lambda: f.read(1 << 20), b''):
            h.update(bloc)
    return h.hexdigest()


def telecharger(cache: pathlib.Path, sans_libelles: bool) -> None:
    cache.mkdir(parents=True, exist_ok=True)
    a_telecharger = [(nom, SOURCE + nom) for nom in FICHIERS if not (sans_libelles and nom == 'alternateNamesV2.zip')]
    a_telecharger += [(local, SOURCE_POSTAUX + distant) for local, distant in FICHIERS_POSTAUX.items()]
    for nom, url in a_telecharger:
        cible = cache / nom
        if cible.exists() and cible.stat().st_size > 0:
            continue
        print(f'téléchargement {url}', file=sys.stderr)
        partiel = cible.with_suffix(cible.suffix + '.partiel')
        with urllib.request.urlopen(url, timeout=600) as r, partiel.open('wb') as f:
            while bloc := r.read(1 << 20):
                f.write(bloc)
        partiel.replace(cible)


def echapper(v) -> str:
    """Une valeur au format texte de COPY : \\N pour NULL, sans tabulation ni retour à la ligne."""
    if v is None:
        return r'\N'
    return str(v).replace('\\', '\\\\').replace('\t', ' ').replace('\n', ' ').replace('\r', ' ')


def lire_admin1(chemin: pathlib.Path) -> tuple:
    """Le nom de chaque première subdivision (« FR.11 » → Île-de-France), et son identifiant GeoNames (ses noms par
    langue sont dans alternateNamesV2 : « Bayern », « Bretagne »)."""
    noms, ids = {}, {}
    for ligne in chemin.read_text(encoding='utf8').splitlines():
        p = ligne.split('\t')
        if len(p) >= 2:
            noms[p[0]] = p[1]
        if len(p) >= 4 and p[3].isdigit():
            ids[int(p[3])] = p[0]
    return noms, ids


def lire_villes(chemin_zip: pathlib.Path):
    with zipfile.ZipFile(chemin_zip) as z, z.open('cities500.txt') as f:
        for brute in io.TextIOWrapper(f, encoding='utf8'):
            p = brute.rstrip('\n').split('\t')
            if len(p) < 19 or p[6] != 'P' or p[7] in EXCLUS:
                continue
            yield p


def arrondissements(villes: list) -> dict:
    """D-499 : un arrondissement est un lieu, avec son point. GeoNames les nomme « Paris 15 Vaugirard », « Lyon 03 »,
    « Marseille 13 » : la ville, puis son numéro. En France, il s'affiche comme Indeed : « Paris 15e », « Paris 1er ».
    GeoNames porte le 10e au 13e de Paris deux fois (« Paris 13 Gobelins », PPL, et « Paris 13e Arrondissement », PPLX) :
    un seul est proposé, le plus peuplé. Rend {gid: (nom affiché, proposable)}."""
    plus_peuplee = {}
    for p in villes:
        cle = (p[8], p[1].lower())
        plus_peuplee[cle] = max(plus_peuplee.get(cle, 0), int(p[14] or 0))
    trouves = {}
    for p in villes:
        m = ARRONDISSEMENT.match(p[1])
        pop = int(p[14] or 0)
        if not m or plus_peuplee.get((p[8], m.group(1).lower()), 0) <= pop:
            continue
        n = int(m.group(2))
        nom = f"{m.group(1)} {n}{'er' if n == 1 else 'e'}" if p[8] in ('FR', 'MC') else p[1]
        trouves.setdefault((p[8], m.group(1).lower(), n), []).append((pop, p[7] != 'PPLX', int(p[0]), nom))
    resultat = {}
    for groupe in trouves.values():
        groupe.sort(reverse=True)
        for rang, (_pop, _ppl, gid, nom) in enumerate(groupe):
            resultat[gid] = (nom, rang == 0)
    return resultat


def preparer(cache: pathlib.Path, sans_libelles: bool) -> dict:
    telecharger(cache, sans_libelles)
    admin1, admin1_ids = lire_admin1(cache / 'admin1CodesASCII.txt')
    villes = list(lire_villes(cache / 'cities500.zip'))
    arr = arrondissements(villes)
    sortie = cache / 'charge'
    sortie.mkdir(exist_ok=True)
    ids, n_noms = set(), 0
    noms_principaux = {}
    with (sortie / 'villes.tsv').open('w', encoding='utf8') as fv, (sortie / 'noms.tsv').open('w', encoding='utf8') as fn:
        for p in villes:
            gid, nom, ascii_, alternatifs, lat, lon, fc, pays, a1, a2, pop = (
                int(p[0]), p[1], p[2], p[3], p[4], p[5], p[7], p[8], p[10] or None, p[11] or None, int(p[14] or 0))
            affiche, proposable = arr.get(gid, (nom, True))
            suggestible = proposable and not SUBDIVISION_NOMMEE.search(nom)
            nom_a1 = admin1.get(f'{pays}.{a1}') if a1 else None
            fv.write('\t'.join(echapper(v) for v in (gid, affiche, pays, a1, a2, nom_a1, lat, lon, pop, fc,
                                                     't' if suggestible else 'f')) + '\n')
            ids.add(gid)
            noms_principaux[gid] = affiche
            vus = set()
            variantes = [(affiche, True), (nom, True), (ascii_, True), *((a, False) for a in alternatifs.split(',') if a)]
            if gid in arr:
                m = ARRONDISSEMENT.match(nom)
                variantes.append((f'{m.group(1)} {int(m.group(2))}', True))  # « Paris 15 » : la clé de « Paris 15e »
            for variante, principal in variantes:
                if not variante.strip() or variante in vus:
                    continue
                vus.add(variante)
                fn.write('\t'.join(echapper(v) for v in (gid, pays, variante, 't' if principal else 'f')) + '\n')
                n_noms += 1
    n_postaux = ecrire_postaux(cache, sortie)
    # Un arrondissement garde son nom affiché (« Paris 15e ») : GeoNames ne le nomme pas ainsi par langue.
    n_libelles = 0 if sans_libelles else ecrire_libelles(cache, sortie, ids - set(arr), noms_principaux, admin1_ids)
    manifeste = {
        'source': SOURCE, 'licence': LICENCE, 'attribution': ATTRIBUTION,
        'fichiers': {nom: {'sha256': sha256(cache / nom), 'octets': (cache / nom).stat().st_size}
                     for nom in [*FICHIERS, *FICHIERS_POSTAUX]
                     if (cache / nom).exists() and not (sans_libelles and nom == 'alternateNamesV2.zip')},
        'villes': len(ids), 'noms': n_noms, 'libelles': n_libelles, 'postaux': n_postaux,
    }
    (sortie / 'manifeste.json').write_text(json.dumps(manifeste, ensure_ascii=False, indent=1), encoding='utf8')
    if sans_libelles:
        (sortie / 'libelles.tsv').write_text('', encoding='utf8')
        (sortie / 'subdivisions.tsv').write_text('', encoding='utf8')
    return manifeste


def ecrire_postaux(cache: pathlib.Path, sortie: pathlib.Path) -> int:
    """D-499 : chaque code postal et le lieu qu'il dessert, avec sa subdivision affichée (le département en France, l'État
    aux États-Unis, comme les villes) et son point. Colonnes GeoNames : pays, code, lieu, région (nom, code), département
    (nom, code), …, latitude, longitude."""
    vus, n = set(), 0
    with zipfile.ZipFile(cache / 'postaux-allCountries.zip') as z, z.open('allCountries.txt') as f, \
            (sortie / 'postaux.tsv').open('w', encoding='utf8') as fp:
        for brute in io.TextIOWrapper(f, encoding='utf8'):
            p = brute.rstrip('\n').split('\t')
            if len(p) < 11 or not p[1].strip() or not p[2].strip() or not p[9] or not p[10]:
                continue
            pays, code, lieu = p[0], p[1].strip(), p[2].strip()
            if CEDEX.search(code) or CEDEX.search(lieu):  # GeoNames l'écrit dans le code : « 94431 CEDEX »
                continue
            m = ARRONDISSEMENT_POSTAL.match(lieu)
            if m and pays in ('FR', 'MC'):  # « Paris 09 » → « Paris 9e », comme les arrondissements des villes
                numero = int(m.group(2))
                lieu = f"{m.group(1)} {numero}{'er' if numero == 1 else 'e'}"
            # La même clé que `catwalks_code_postal_cle` (lettres et chiffres, majuscules) : un code et son lieu une fois.
            cle = (pays, ''.join(c for c in code if c.isalnum()).upper(), lieu)
            if cle in vus or not cle[1]:
                continue
            vus.add(cle)
            sub = p[6] if pays == 'FR' else p[4] if pays == 'US' else None
            fp.write('\t'.join(echapper(v) for v in (pays, code, lieu, sub or None, p[9], p[10])) + '\n')
            n += 1
    return n


def ecrire_libelles(cache: pathlib.Path, sortie: pathlib.Path, ids: set, noms_principaux: dict, admin1_ids: dict) -> int:
    """Le nom d'usage par langue : le nom préféré s'il est marqué, sinon le premier nom courant (ni court, ni familier,
    ni historique). Écrit seulement quand il diffère du nom principal. Dans la même lecture, les noms des premières
    subdivisions dans les langues de l'interface (subdivisions.tsv) : « Bretagne » et « Bayern » se reconnaissent comme
    des régions, et une offre qui écrit « Bayern » départage ses homonymes."""
    choisis = {}  # (gid, langue) -> (rang, libellé) ; rang 0 = préféré
    regions = set()  # (« FR.53 », nom)
    with zipfile.ZipFile(cache / 'alternateNamesV2.zip') as z, z.open('alternateNamesV2.txt') as f:
        for brute in io.TextIOWrapper(f, encoding='utf8'):
            p = brute.rstrip('\n').split('\t')
            if len(p) < 8:
                continue
            langue = ALIAS_LANGUE.get(p[2], p[2])
            if langue not in LANGUES:
                continue
            gid = int(p[1])
            if p[6] == '1' or p[7] == '1' or (len(p) > 9 and p[9]):
                continue
            if gid in admin1_ids and p[3].strip():
                regions.add((admin1_ids[gid], p[3].strip()))
            if gid not in ids or p[5] == '1':
                continue
            rang = 0 if p[4] == '1' else 1
            # « nb » préféré à « no » à rang égal : le code d'origine exact passe devant l'alias.
            rang = rang * 2 + (1 if p[2] != langue else 0)
            actuel = choisis.get((gid, langue))
            if actuel is None or rang < actuel[0]:
                choisis[(gid, langue)] = (rang, p[3].strip())
    with (sortie / 'subdivisions.tsv').open('w', encoding='utf8') as fs:
        for code, nom in sorted(regions):
            pays, _, a1 = code.partition('.')
            fs.write('\t'.join(echapper(v) for v in (pays, a1, nom)) + '\n')
    n = 0
    with (sortie / 'libelles.tsv').open('w', encoding='utf8') as fl:
        for (gid, langue), (_rang, libelle) in sorted(choisis.items()):
            # Un nom d'entité administrative (« London Borough of Bexley ») n'est pas le nom d'usage d'une ville.
            if libelle and libelle != noms_principaux[gid] and not SUBDIVISION_NOMMEE.search(libelle):
                fl.write('\t'.join(echapper(v) for v in (gid, langue, libelle)) + '\n')
                n += 1
    return n


def sql_chargement(dossier: pathlib.Path, manifeste: dict, ecrire: bool, forcer: bool) -> str:
    q = lambda s: "'" + s.replace("'", "''") + "'"
    chemin = lambda nom: q(str(dossier / nom))
    fichiers = json.dumps(manifeste['fichiers'], ensure_ascii=False)
    return f"""\\set ON_ERROR_STOP on
\\pset footer off
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30min';
CREATE TEMP TABLE s_villes (id int, name text, pays text, a1 text, a2 text, a1nom text, lat float8, lon float8,
  pop bigint, fc text, suggestible boolean) ON COMMIT DROP;
CREATE TEMP TABLE s_noms (id int, pays text, nom text, principal boolean) ON COMMIT DROP;
CREATE TEMP TABLE s_libelles (id int, langue text, libelle text) ON COMMIT DROP;
CREATE TEMP TABLE s_subdivisions (pays text, a1 text, nom text) ON COMMIT DROP;
CREATE TEMP TABLE s_postaux (pays text, code text, lieu text, sub text, lat float8, lon float8) ON COMMIT DROP;
\\copy s_villes FROM {chemin('villes.tsv')}
\\copy s_noms FROM {chemin('noms.tsv')}
\\copy s_libelles FROM {chemin('libelles.tsv')}
\\copy s_subdivisions FROM {chemin('subdivisions.tsv')}
\\copy s_postaux FROM {chemin('postaux.tsv')}
CREATE TEMP TABLE s_regions ON COMMIT DROP AS
SELECT pays, a1, coalesce(array_agg(DISTINCT catwalks_lieu_cle(nom)) FILTER (WHERE catwalks_lieu_cle(nom) IS NOT NULL), '{{}}') AS cles
  FROM s_subdivisions GROUP BY pays, a1;
CREATE INDEX ON s_regions (pays, a1);
ANALYZE s_regions;

DO $$ BEGIN
  IF (SELECT count(*) FROM s_villes) < {VILLES_MIN} THEN
    RAISE EXCEPTION 'Fichier des villes tronqué : % villes (minimum {VILLES_MIN})', (SELECT count(*) FROM s_villes);
  END IF;
  IF (SELECT count(*) FROM s_postaux) < {POSTAUX_MIN} THEN
    RAISE EXCEPTION 'Fichier des codes postaux tronqué : % codes (minimum {POSTAUX_MIN})', (SELECT count(*) FROM s_postaux);
  END IF;
  IF {'false' if forcer else 'true'} AND (SELECT count(*) FROM "GeoCity" c WHERE NOT EXISTS (SELECT 1 FROM s_villes s WHERE s.id = c.id))
     > {RETRAIT_MAX} * (SELECT count(*) FROM "GeoCity") THEN
    RAISE EXCEPTION 'Le chargement retirerait plus de {int(RETRAIT_MAX * 100)} %% des villes en place : vérifier la source (--forcer pour passer outre)';
  END IF;
END $$;

INSERT INTO "GeoCityRelease" ("source", "licence", "attribution", "files", "cities", "names", "labels", "postalCodes")
VALUES ({q(manifeste['source'] + 'cities500.zip, ' + SOURCE_POSTAUX + 'allCountries.zip')}, {q(LICENCE)}, {q(ATTRIBUTION)}, {q(fichiers)}::jsonb,
  {manifeste['villes']}, {manifeste['noms']}, {manifeste['libelles']}, {manifeste.get('postaux', 0)})
RETURNING "id" AS release \\gset

-- La subdivision écrite entre parenthèses : le département en France et à Monaco (aucun), l'État aux États-Unis ;
-- ailleurs la première subdivision, seulement quand le nom principal existe deux fois dans le pays.
CREATE TEMP TABLE s_finales ON COMMIT DROP AS
WITH cles AS (SELECT s.*, catwalks_lieu_cle(s.name) AS k FROM s_villes s),
homonymes AS (SELECT pays, k FROM cles WHERE suggestible AND fc <> 'PPLX' GROUP BY pays, k HAVING count(*) > 1)
SELECT c.id, c.name, c.pays, c.a1, c.a2, c.a1nom, c.lat, c.lon, c.pop, c.fc, c.suggestible,
  CASE WHEN c.pays = 'FR' THEN c.a2 WHEN c.pays = 'US' THEN c.a1
       WHEN h.k IS NOT NULL THEN c.a1nom END AS subdivision
FROM cles c LEFT JOIN homonymes h ON h.pays = c.pays AND h.k = c.k;

CREATE TEMP TABLE s_bilan (etape text, lignes bigint) ON COMMIT DROP;

WITH maj AS (
  INSERT INTO "GeoCity" ("id", "name", "countryCode", "admin1Code", "admin2Code", "admin1Name", "subdivision", "subdivisionKeys",
    "latitude", "longitude", "population", "featureCode", "suggestible", "releaseId")
  SELECT f.id, f.name, f.pays, f.a1, f.a2, f.a1nom, f.subdivision,
    ARRAY(SELECT DISTINCT x FROM unnest(catwalks_subdivision_cles(f.a1nom, f.a1, f.a2, f.subdivision)
      || coalesce((SELECT r.cles FROM s_regions r WHERE r.pays = f.pays AND r.a1 = f.a1), '{{}}')) x ORDER BY x),
    f.lat, f.lon, f.pop, f.fc, f.suggestible, :release
  FROM s_finales f
  ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "countryCode" = EXCLUDED."countryCode",
    "admin1Code" = EXCLUDED."admin1Code", "admin2Code" = EXCLUDED."admin2Code", "admin1Name" = EXCLUDED."admin1Name",
    "subdivision" = EXCLUDED."subdivision", "subdivisionKeys" = EXCLUDED."subdivisionKeys", "latitude" = EXCLUDED."latitude",
    "longitude" = EXCLUDED."longitude", "population" = EXCLUDED."population", "featureCode" = EXCLUDED."featureCode",
    "suggestible" = EXCLUDED."suggestible", "releaseId" = EXCLUDED."releaseId"
  WHERE ("GeoCity"."name", "GeoCity"."countryCode", "GeoCity"."admin1Code", "GeoCity"."admin2Code", "GeoCity"."admin1Name",
         "GeoCity"."subdivision", "GeoCity"."subdivisionKeys", "GeoCity"."latitude", "GeoCity"."longitude",
         "GeoCity"."population", "GeoCity"."featureCode", "GeoCity"."suggestible")
    IS DISTINCT FROM (EXCLUDED."name", EXCLUDED."countryCode", EXCLUDED."admin1Code", EXCLUDED."admin2Code",
         EXCLUDED."admin1Name", EXCLUDED."subdivision", EXCLUDED."subdivisionKeys", EXCLUDED."latitude",
         EXCLUDED."longitude", EXCLUDED."population", EXCLUDED."featureCode", EXCLUDED."suggestible")
  RETURNING 1
) INSERT INTO s_bilan SELECT 'villes écrites (nouvelles ou changées)', count(*) FROM maj;

WITH retrait AS (DELETE FROM "GeoCity" c WHERE NOT EXISTS (SELECT 1 FROM s_finales f WHERE f.id = c.id) RETURNING 1)
INSERT INTO s_bilan SELECT 'villes retirées', count(*) FROM retrait;

CREATE TEMP TABLE s_cles ON COMMIT DROP AS
SELECT pays, catwalks_lieu_cle(nom) COLLATE "C" AS k, id, bool_or(principal) AS principal
FROM s_noms WHERE catwalks_lieu_cle(nom) IS NOT NULL AND EXISTS (SELECT 1 FROM s_finales f WHERE f.id = s_noms.id)
GROUP BY 1, 2, 3;

WITH maj AS (
  INSERT INTO "GeoCityName" ("countryCode", "nameKey", "cityId", "primary") SELECT pays, k, id, principal FROM s_cles
  ON CONFLICT ("countryCode", "nameKey", "cityId") DO UPDATE SET "primary" = EXCLUDED."primary"
  WHERE "GeoCityName"."primary" IS DISTINCT FROM EXCLUDED."primary"
  RETURNING 1
) INSERT INTO s_bilan SELECT 'noms écrits', count(*) FROM maj;

WITH retrait AS (DELETE FROM "GeoCityName" n WHERE NOT EXISTS (SELECT 1 FROM s_cles s
  WHERE s.pays = n."countryCode" AND s.k = n."nameKey" AND s.id = n."cityId") RETURNING 1)
INSERT INTO s_bilan SELECT 'noms retirés', count(*) FROM retrait;

WITH maj AS (
  INSERT INTO "GeoCityLabel" ("cityId", "language", "label")
  SELECT l.id, l.langue, l.libelle FROM s_libelles l WHERE EXISTS (SELECT 1 FROM s_finales f WHERE f.id = l.id)
  ON CONFLICT ("cityId", "language") DO UPDATE SET "label" = EXCLUDED."label" WHERE "GeoCityLabel"."label" IS DISTINCT FROM EXCLUDED."label"
  RETURNING 1
) INSERT INTO s_bilan SELECT 'libellés écrits', count(*) FROM maj;

WITH retrait AS (DELETE FROM "GeoCityLabel" g WHERE NOT EXISTS (SELECT 1 FROM s_libelles l
  WHERE l.id = g."cityId" AND l.langue = g."language" AND EXISTS (SELECT 1 FROM s_finales f WHERE f.id = l.id)) RETURNING 1)
INSERT INTO s_bilan SELECT 'libellés retirés', count(*) FROM retrait;

-- Sans tri : la préparation a déjà retiré les doublons (pays, clé du code, lieu) ; 1,8 million de lignes.
CREATE TEMP TABLE s_codes ON COMMIT DROP AS
SELECT pays, code, catwalks_code_postal_cle(code) COLLATE "C" AS ck, lieu, catwalks_lieu_cle(lieu) COLLATE "C" AS lk, sub, lat, lon
  FROM s_postaux;
DELETE FROM s_codes WHERE ck IS NULL OR lk IS NULL;
CREATE INDEX ON s_codes (pays, ck, lieu);
ANALYZE s_codes;

WITH maj AS (
  INSERT INTO "GeoPostalCode" ("countryCode", "postalCode", "postalKey", "placeName", "placeKey", "subdivision", "latitude", "longitude", "releaseId")
  SELECT pays, code, ck, lieu, lk, sub, lat, lon, :release FROM s_codes
  ON CONFLICT ("countryCode", "postalKey", "placeName") DO UPDATE SET "postalCode" = EXCLUDED."postalCode", "placeKey" = EXCLUDED."placeKey",
    "subdivision" = EXCLUDED."subdivision", "latitude" = EXCLUDED."latitude", "longitude" = EXCLUDED."longitude", "releaseId" = EXCLUDED."releaseId"
  WHERE ("GeoPostalCode"."postalCode", "GeoPostalCode"."placeKey", "GeoPostalCode"."subdivision", "GeoPostalCode"."latitude", "GeoPostalCode"."longitude")
    IS DISTINCT FROM (EXCLUDED."postalCode", EXCLUDED."placeKey", EXCLUDED."subdivision", EXCLUDED."latitude", EXCLUDED."longitude")
  RETURNING 1
) INSERT INTO s_bilan SELECT 'codes postaux écrits', count(*) FROM maj;

WITH retrait AS (DELETE FROM "GeoPostalCode" g WHERE NOT EXISTS (SELECT 1 FROM s_codes s
  WHERE s.pays = g."countryCode" AND s.ck = g."postalKey" AND s.lieu = g."placeName") RETURNING 1)
INSERT INTO s_bilan SELECT 'codes postaux retirés', count(*) FROM retrait;

SELECT * FROM s_bilan;
SELECT (SELECT count(*) FROM "GeoCity") AS villes, (SELECT count(*) FROM "GeoCity" WHERE "suggestible") AS proposables,
  (SELECT count(*) FROM "GeoCityName") AS noms, (SELECT count(*) FROM "GeoCityLabel") AS libelles,
  (SELECT count(*) FROM "GeoPostalCode") AS codes_postaux;
{'COMMIT' if ecrire else 'ROLLBACK'};
\\echo {'ÉCRIT' if ecrire else 'À BLANC : transaction annulée, rien n’est écrit'}
"""


def charger(cache: pathlib.Path, ecrire: bool, forcer: bool) -> int:
    dossier = cache / 'charge'
    manifeste = json.loads((dossier / 'manifeste.json').read_text(encoding='utf8'))
    url = os.environ.get('DATABASE_URL')
    if not url:
        print('DATABASE_URL absent : lancer par apps/aggregator/scripts/ops/db.py <cible> …', file=sys.stderr)
        return 2
    with tempfile.NamedTemporaryFile('w', suffix='.sql', encoding='utf8', delete=False) as f:
        f.write(sql_chargement(dossier, manifeste, ecrire, forcer))
        script = f.name
    try:
        return subprocess.run(['psql', url, '-X', '-f', script]).returncode
    finally:
        os.unlink(script)


def main(argv=None) -> int:
    parseur = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sous = parseur.add_subparsers(dest='commande', required=True)
    p = sous.add_parser('preparer')
    p.add_argument('--cache', type=pathlib.Path, default=cache_par_defaut())
    p.add_argument('--sans-libelles', action='store_true')
    c = sous.add_parser('charger')
    c.add_argument('--cache', type=pathlib.Path, default=cache_par_defaut())
    c.add_argument('--ecrire', action='store_true')
    c.add_argument('--forcer', action='store_true')
    a = parseur.parse_args(argv)
    if a.commande == 'preparer':
        print(json.dumps(preparer(a.cache, a.sans_libelles), ensure_ascii=False, indent=1))
        return 0
    return charger(a.cache, a.ecrire, a.forcer)


if __name__ == '__main__':
    sys.exit(main())
