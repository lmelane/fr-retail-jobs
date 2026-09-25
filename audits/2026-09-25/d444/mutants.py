"""D-444 — les témoins échouent quand le défaut revient (preuve par mutants, rejouable).

Chaque mutant réintroduit un défaut précis dans une copie en mémoire du fichier, lance le témoin qui doit le détecter,
puis RESTAURE le fichier depuis la mémoire (jamais `git checkout --`, qui effacerait le travail non committé). Un mutant
« survivant » (témoin vert malgré le défaut) fait échouer le script.

Usage, depuis la racine du dépôt, sur une base jetable (le nom de la base doit contenir « test ») :
  DATABASE_URL=postgresql://…@127.0.0.1:<port>/<base_test> \
  PREFLIGHT_TEST_DATABASE_URL=postgresql://…@127.0.0.1:<port>/catwalks_preflight_test_<suffixe> \
  python3 audits/2026-09-25/d444/mutants.py
Le second URL désigne une base migrée VIDE (témoin du préflight du worker) ; sans lui, ce mutant est signalé non joué.
"""
import json
import os
import pathlib
import subprocess
import sys
from urllib.parse import urlsplit

ROOT = pathlib.Path(__file__).resolve().parents[3]
url = urlsplit(os.environ.get('DATABASE_URL', ''))
if url.hostname not in ('127.0.0.1', 'localhost') or 'test' not in url.path:
    sys.exit('REFUS : DATABASE_URL doit désigner une base jetable locale dont le nom contient « test »')

AGG = 'apps/aggregator'
API = 'apps/api'
MUTANTS = [
    # (nom, fichier, avant, après, application, témoin[, occurrences attendues, 1 par défaut])
    ('photo : retire même quand la photo est vide, tronquée ou illisible',
     f'{AGG}/src/direct/photo.ts', 'if (stats.complete) {', 'if (true) {', AGG, 'src/direct/photo.test.ts'),
    ('photo : réécrit chaque offre à chaque passe',
     f'{AGG}/src/direct/photo.ts', '} else if (existante.eligible && existante.payloadHash === p.payloadHash && existante.projectionHash === p.colonnes.projectionHash) {',
     '} else if (false) {', AGG, 'src/direct/photo.test.ts'),
    ('photo : ne retire jamais une offre absente',
     f'{AGG}/src/direct/photo.ts', 'if (absentes.length) stats.retirees', 'if (false) stats.retirees', AGG, 'src/direct/photo.test.ts'),
    ('photo : une panne n’est pas signalée à l’état du lecteur',
     f'{AGG}/src/direct/photo.ts', 'await noterEtat(db, luLe, error.message.slice(0, 500));', ';', AGG, 'src/direct/photo.test.ts'),
    ('photo : une liste plus courte que le compte du backend retire quand même',
     f'{AGG}/src/direct/photo.ts', "if (annoncees !== lecture.taille) return 'COMPTE_DIFFERENT';", '', AGG, 'src/direct/photo.test.ts'),
    ('photo : un compte indisponible n’empêche pas les retraits',
     f'{AGG}/src/direct/photo.ts', "if (annoncees === null) return 'COMPTE_INDISPONIBLE';", '', AGG, 'src/direct/photo.test.ts'),
    ('photo : une photo périmée s’écrit par-dessus une plus récente',
     f'{AGG}/src/direct/photo.ts', 'if (etat && etat.lastReadAt >= luLe) return { ...stats, perimee: true };', '', AGG, 'src/direct/photo.test.ts'),
    ('photo : l’instant de lecture est pris à l’horloge de la machine',
     f'{AGG}/src/direct/photo.ts', 'const luLe = await instantBase(db);', 'const luLe = new Date();', AGG, 'src/direct/photo.test.ts'),
    ('photo : l’instant du lecteur recule quand une passe plus ancienne tombe en panne',
     f'{AGG}/src/direct/photo.ts', '"lastReadAt" = GREATEST("DirectFeedCursor"."lastReadAt", EXCLUDED."lastReadAt"),', '"lastReadAt" = EXCLUDED."lastReadAt",', AGG, 'src/direct/photo.test.ts'),
    ('photo : une panne plus ancienne remplace l’état d’une passe plus récente',
     f'{AGG}/src/direct/photo.ts', '"lastError" = CASE WHEN EXCLUDED."lastReadAt" > "DirectFeedCursor"."lastReadAt" THEN EXCLUDED."lastError" ELSE "DirectFeedCursor"."lastError" END,',
     '"lastError" = EXCLUDED."lastError",', AGG, 'src/direct/photo.test.ts'),
    ('photo : une passe périmée ou concurrente passe pour réussie',
     f'{AGG}/src/direct/photo.ts', 's.complete && !s.perimee && !s.concurrente && s.reprojection', 's.complete && s.reprojection', AGG, 'src/direct/photo.test.ts'),
    ('photo : une offre hors de tout marché n’est pas signalée',
     f'{AGG}/src/direct/photo.ts', 'if (!PAYS_SERVIS.has(verdict.pays)) horsMarche.push', 'if (false) horsMarche.push', AGG, 'src/direct/photo.test.ts'),
    ('photo : la cause d’un compte manquant est perdue',
     f'{AGG}/src/direct/photo.ts', 'return { annoncees: null, erreur: error.message.slice(0, 300) };', 'return { annoncees: null, erreur: null };', AGG, 'src/direct/photo.test.ts'),
    ('commande : une passe incomplète, périmée ou concurrente sort en succès (aucune alerte)',
     f'{AGG}/src/cli.ts', 'const ok = passeReussie(stats);', 'const ok = true;', AGG, 'src/direct/cli-direct-liste.test.ts'),
    ('liste : une panne de transport n’est nommée que par le nom de l’erreur',
     f'{AGG}/src/direct/liste.ts', "return `${error.name} : ${error.message}${precision ? ` (${precision})` : ''}`.slice(0, 200);", 'return error.name;', AGG, 'src/direct/liste.test.ts'),
    ('vocabulaire : une valeur `constructor` lit Object.prototype',
     f'{AGG}/src/direct/vocabulaire.ts', 'cle !== null && cle !== undefined && Object.hasOwn(table, cle) ? table[cle] : undefined;', '(cle ? (table as any)[cle] : undefined);', AGG, 'src/direct/vocabulaire.test.ts'),
    ('frontières : les trous sont ignorés (tout anneau est un extérieur)',
     f'{AGG}/src/geo/frontieres.ts', 'for (const anneau of entite.anneaux) if (croisements(anneau, x, y)) dedans = !dedans;',
     'for (const anneau of entite.anneaux) if (croisements(anneau, x, y)) dedans = true;', AGG, 'src/geo/frontieres.test.ts'),
    ('frontières : un point ambigu prend la première entité',
     f'{AGG}/src/geo/frontieres.ts', "if (codes.size > 1) return { pays: null, motif: 'TRACE_AMBIGU', entites: touchees.map((e) => e.nom) };", '', AGG, 'src/geo/frontieres.test.ts'),
    ('frontières : hors du tracé, on devine la France',
     f'{AGG}/src/geo/frontieres.ts', "if (!touchees.length) return { pays: null, motif: 'HORS_TRACE' };", "if (!touchees.length) return { pays: 'FR', entite: 'deviné' };", AGG, 'src/geo/frontieres.test.ts'),
    ('projection : un mandat nommé par son univers (version 1)',
     f'{AGG}/src/direct/vocabulaire.ts', 'return maison?.nom.trim() || EMPLOYEUR_CATWALKS;', "return maison?.nom.trim() || 'Mode, Luxe';", AGG, 'src/direct/liste.test.ts'),
    ('projection : le mandat rattaché au registre par son employeur « Catwalks »',
     f'{AGG}/src/direct/projection.ts', 'companyId: contexte.rattacher(offre.maison?.nom),', 'companyId: contexte.rattacher(employeurAffiche(offre.maison)),', AGG, 'src/direct/liste.test.ts'),
    ('liste : une offre hors ligne est lue comme publiable',
     f'{AGG}/src/direct/liste.ts', "if (o.status !== 'ONLINE') throw", "if (false) throw", AGG, 'src/direct/liste.test.ts'),
    ('registre : un nom ambigu rattache la première société',
     f'{AGG}/src/direct/contexte.ts', 'return trouves?.size === 1 ? [...trouves][0] : null;', 'return trouves?.size ? [...trouves][0] : null;', AGG, 'src/direct/contexte.test.ts'),
    ('recherche : métier et groupe des offres directes à NULL (état d’avant D-444)',
     f'{API}/lib/job-search-query.ts', 'd.language, d."companyId", COALESCE(dc.name, d.company), d."sectorCodes", dc."parentGroup",', 'd.language, NULL::text, d.company, d."sectorCodes", NULL::text,', API, 'lib/__tests__/ordre-catwalks-r126.test.ts'),
    ('recherche : le nom publié par le backend ne ramène plus toutes les offres de la Maison (bloc Maison, fiche fermée)',
     f'{API}/lib/job-search-query.ts', '\n        UNION SELECT publiee."companyId" FROM "DirectOffer" publiee WHERE publiee."companyId" IS NOT NULL AND lower(publiee.company) = lower(${v})', '', API, 'lib/__tests__/ordre-catwalks-r126.test.ts'),
    ('annuaire : une offre rattachée forme une seconde ligne sous le nom du backend',
     f'{API}/lib/companies.ts', 'const companyId = row.companyId ?? idParNom.get(row.company) ?? null;', 'const companyId = idParNom.get(row.company) ?? null;', API, 'lib/__tests__/ordre-catwalks-r126.test.ts'),
    ('recherche : une offre rattachée garde l’orthographe du backend dans la facette « Maison »',
     f'{API}/lib/job-search-query.ts', 'COALESCE(dc.name, d.company)', 'd.company', API, 'lib/__tests__/ordre-catwalks-r126.test.ts'),
    ('recherche : métier des offres directes à NULL',
     f'{API}/lib/job-search-query.ts', "SELECT ${PREFIXE_DIRECT} || d.id, 0 AS origine, d.\"occupationCode\",", "SELECT ${PREFIXE_DIRECT} || d.id, 0 AS origine, NULL::text,", API, 'lib/__tests__/ordre-catwalks-r126.test.ts'),
    ('recherche : l’origine n’ordonne plus (Catwalks = agrégée)',
     f'{API}/lib/job-search-query.ts', "SELECT ${PREFIXE_DIRECT} || d.id, 0 AS origine,", "SELECT ${PREFIXE_DIRECT} || d.id, 1 AS origine,", API, 'lib/__tests__/ordre-catwalks-r126.test.ts'),
    # La clé ordonnée apparaît quatre fois (clé servie, ordre du tableau, ordre de la page, curseur) : toutes permutées.
    ('recherche : le pays du visiteur passe devant l’origine',
     f'{API}/lib/job-search-query.ts', 'origine, nc, pri, ns, np, nf, id', 'pri, origine, nc, ns, np, nf, id', API, 'lib/__tests__/ordre-catwalks-r126.test.ts', 4),
    ('recherche : le document d’une offre directe ignore son métier de la taxonomie',
     f'{API}/lib/search-index.ts', "        occupationCode: true,\n      } }),\n    ]);", "      } }),\n    ]);", API, 'lib/__tests__/ordre-catwalks-r126.test.ts'),
    ('recherche : search-3, le texte indexé d’une offre directe est ignoré',
     f'{API}/lib/search-model.ts', 'j.employmentTerm, direct ? j.searchText : undefined]', 'j.employmentTerm]', API, 'lib/__tests__/recherche-univers-d455.test.ts'),
    ('liste : le corps de la réponse est lu sans borne',
     f'{AGG}/src/direct/liste.ts', 'if (octets > OCTETS_MAX) {', 'if (false) {', AGG, 'src/direct/liste.test.ts'),
    ('état du worker : une passe direct-liste en échec masque sa dernière erreur',
     f'{AGG}/scripts/ops/worker-status.mts', "where: { level: 'error', run: horsDirect }", "where: { level: 'error' }", '.',
     ['node', '--test', '--test-name-pattern', 'paused preflight', 'apps/aggregator/scripts/ops/tests/pipeline-pause.test.mjs'], 1, 'PREFLIGHT_TEST_DATABASE_URL'),
    ('préflight du worker : une passe direct-liste vivante le bloque',
     f'{AGG}/scripts/ops/worker-status.mts', "const horsDirect = { command: { not: 'direct-liste' } };", 'const horsDirect = {};', '.',
     ['node', '--test', '--test-name-pattern', 'paused preflight', 'apps/aggregator/scripts/ops/tests/pipeline-pause.test.mjs'], 1, 'PREFLIGHT_TEST_DATABASE_URL'),
]

resultats = []
for nom, fichier, avant, apres, app, temoin, *options in MUTANTS:
    occurrences = options[0] if options else 1
    requis = options[1] if len(options) > 1 else None
    if requis and not os.environ.get(requis):
        resultats.append({'mutant': nom, 'temoin': str(temoin), 'tue': None, 'echecs': [f'non joué : {requis} absente']})
        print(json.dumps(resultats[-1], ensure_ascii=False), flush=True)
        continue
    chemin = ROOT / fichier
    original = chemin.read_text(encoding='utf-8')
    if original.count(avant) != occurrences:
        sys.exit(f'Mutant « {nom} » : motif introuvable ou multiple dans {fichier}')
    commande = temoin if isinstance(temoin, list) else ['npx', 'vitest', 'run', temoin]
    try:
        chemin.write_text(original.replace(avant, apres), encoding='utf-8')
        env = {**os.environ, 'PGOPTIONS': ''}
        r = subprocess.run(commande, cwd=ROOT / app, env=env, capture_output=True, text=True, timeout=600)
    finally:
        chemin.write_text(original, encoding='utf-8')
    tue = r.returncode != 0
    echecs = [l.strip() for l in (r.stdout + r.stderr).splitlines() if l.strip().startswith(('×', 'FAIL', '✖'))][:3]
    resultats.append({'mutant': nom, 'temoin': ' '.join(commande) if isinstance(temoin, list) else f'{app}/{temoin}', 'tue': tue, 'echecs': echecs})
    print(json.dumps(resultats[-1], ensure_ascii=False), flush=True)

survivants = [r for r in resultats if r['tue'] is False]
non_joues = [r['mutant'] for r in resultats if r['tue'] is None]
print(json.dumps({'mutants': len(resultats), 'tues': sum(1 for r in resultats if r['tue']), 'survivants': [r['mutant'] for r in survivants], 'nonJoues': non_joues}, ensure_ascii=False))
sys.exit(1 if survivants or non_joues else 0)
