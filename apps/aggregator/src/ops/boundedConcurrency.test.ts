import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

/**
 * LA CONCURRENCE D'UN PASSAGE A/B — portée par la COMMANDE DÉPLOYÉE, jamais par une variable de service.
 *
 * L'A/B de P8 compare le débit à concurrence 4 puis 6. Le paramètre est lu par l'orchestrateur
 * (`ingestOrchestrator.ts:56`, `INGEST_SOURCE_CONCURRENCY`, défaut 4). Deux façons de le poser :
 *
 *   · une variable de SERVICE — invisible dans le manifeste du déploiement, donc invérifiable par la garde
 *     d'exécution, et surtout PERSISTANTE : oubliée après le passage, elle s'appliquerait à tous les runs
 *     suivants sans que rien ne le dise. C'est exactement la famille de défaut qu'`INGEST_ONLY_KEYS` résiduel
 *     a déjà produite dans ce lot ;
 *   · la COMMANDE elle-même — visible dans le manifeste, donc attribuable au run, et retirée avec la commande
 *     lors de la restauration. C'est la seule qui rend la mesure imputable.
 *
 * Ces tests fixent le second choix, et surtout l'invariant qui rend l'A/B lisible : **une valeur absente
 * n'écrit rien** — un passage sans consigne reste au défaut du code, il ne se voit pas imposer un « 4 »
 * explicite qui masquerait un futur changement de défaut.
 */
const OPS = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/ops');

function build(runName: string, keys: string, concurrency?: string, stopOn429 = false): string {
  // `--stop-on-first-429` est un DRAPEAU, pas un positionnel : on peut le demander sans inventer une
  // concurrence, donc sans sentinelle vide qui avalerait au passage une valeur mal formée.
  const args = [`${OPS}/bounded-command.py`, runName, keys];
  if (concurrency !== undefined) args.push(concurrency);
  if (stopOn429) args.push('--stop-on-first-429');
  return execFileSync('python3', args, { encoding: 'utf8' });
}

const KEYS = 'mecca,ganni-talentrecruiter';

describe('commande bornée — la concurrence est portée par la commande', () => {
  it('sans consigne, n\'écrit AUCUNE concurrence : le défaut du code reste le défaut', () => {
    const cmd = build('run-a', KEYS);
    expect(cmd).not.toContain('INGEST_SOURCE_CONCURRENCY');
    // Le périmètre, lui, reste toujours porté par la commande.
    expect(cmd).toContain(`INGEST_ONLY_KEYS=${KEYS} `);
  });

  it('avec une consigne, la pose dans la commande, donc dans le manifeste', () => {
    const cmd = build('run-b', KEYS, '6');
    expect(cmd).toContain('INGEST_SOURCE_CONCURRENCY=6 ');
    expect(cmd).toContain(`INGEST_ONLY_KEYS=${KEYS} `);
  });

  it('la concurrence précède `node` : c\'est une variable d\'environnement, pas un argument', () => {
    const cmd = build('run-b', KEYS, '6');
    expect(cmd.indexOf('INGEST_SOURCE_CONCURRENCY=6')).toBeLessThan(cmd.indexOf('node '));
  });

  it('refuse une valeur qui n\'est pas un entier positif — un A/B ne se pilote pas au hasard', () => {
    for (const bad of ['0', '-2', '4.5', 'six', '', '4;rm -rf /']) {
      let status = 0;
      try { execFileSync('python3', [`${OPS}/bounded-command.py`, 'r', KEYS, bad], { stdio: 'pipe' }); }
      catch (e: any) { status = e.status ?? -1; }
      expect(status, `valeur refusée attendue : ${JSON.stringify(bad)}`).not.toBe(0);
    }
  });

  it('refuse une valeur déraisonnable — la borne protège les portails, pas notre confort', () => {
    // P8 interdit explicitement de monter la concurrence pour trouver le point de rupture.
    let status = 0;
    try { execFileSync('python3', [`${OPS}/bounded-command.py`, 'r', KEYS, '64'], { stdio: 'pipe' }); }
    catch (e: any) { status = e.status ?? -1; }
    expect(status).not.toBe(0);
  });

  it('l\'arrêt sur premier 429 est PORTÉ par la commande quand il est demandé', () => {
    // Défaut mesuré le 2026-09-13 : `export P8_STOP_ON_FIRST_429=1` dans le shell LOCAL n'atteint jamais le
    // conteneur Railway, où le run s'exécute réellement. Trois passages ont été décrits comme « arrêt 429
    // armé » alors qu'aucune garde n'était active — et T2 a encaissé 82 réponses 429 sans s'arrêter.
    // Une garde qu'on CROIT armée est pire qu'une garde absente : elle fait relire un run comme sûr.
    const cmd = build('run-429', KEYS, undefined, true);
    expect(cmd).toContain('P8_STOP_ON_FIRST_429=1 ');
    expect(cmd.indexOf('P8_STOP_ON_FIRST_429=1')).toBeLessThan(cmd.indexOf('node '));
  });

  it('sans demande explicite, la commande ne porte AUCUN arrêt 429', () => {
    expect(build('run-plain', KEYS)).not.toContain('P8_STOP_ON_FIRST_429');
  });

  it('le drapeau est lu par le code qui l\'applique — nom vérifié, pas recopié', () => {
    const src = execFileSync('cat', [resolve(OPS, '../../src/observability/rateLimitSignal.ts')], { encoding: 'utf8' });
    expect(src).toContain("process.env.P8_STOP_ON_FIRST_429 === '1'");
  });

  it('les canaux d\'alerte restent disponibles, quelle que soit la concurrence', () => {
    const cmd = build('run-b', KEYS, '6');
    for (const v of ['BREVO_API_KEY', 'HEALTHCHECK_PING_URL']) {
      expect(cmd).not.toContain(`-u ${v}`);
    }
    expect(cmd).toContain('-u GOOGLE_INDEXING_CREDENTIALS');
  });

  it('l\'orchestrateur lit bien CETTE variable — le nom n\'est pas recopié de mémoire', () => {
    const src = execFileSync('cat', [resolve(OPS, '../../src/pipeline/ingestOrchestrator.ts')], { encoding: 'utf8' });
    expect(src).toContain('INGEST_SOURCE_CONCURRENCY');
  });

  it('la garde d\'exécution accepte encore le périmètre : la variable insérée ne le casse pas', () => {
    // La garde cherche `INGEST_ONLY_KEYS=<clés> ` AVEC l'espace final. Insérer une variable juste après est
    // sûr — mais « sûr par lecture » ne suffit pas : on exerce le MOTIF RÉEL, lu dans le programme.
    const code = `
import re, pathlib, sys
src = pathlib.Path(${JSON.stringify(`${OPS}/railway-service.py`)}).read_text()
m = re.search(r"bounds = \\[v for v in \\((.*?)\\) if f'\\{v\\}=\\{expected_keys\\} ' in \\(manifest or ''\\)\\]", src)
if not m:
    print("MOTIF_INTROUVABLE"); sys.exit(0)
names = [n.strip().strip("'\\"") for n in m.group(1).split(",") if n.strip()]
manifest = sys.argv[1]; expected_keys = sys.argv[2]
bounds = [v for v in names if f"{v}={expected_keys} " in (manifest or "")]
print(("ACCEPTE:" + bounds[0]) if len(bounds) == 1 else "REFUS")`;
    const withConcurrency = build('run-b', KEYS, '6');
    const verdict = execFileSync('python3', ['-c', code, withConcurrency, KEYS], { encoding: 'utf8', cwd: '/' }).trim();
    expect(verdict).toBe('ACCEPTE:INGEST_ONLY_KEYS');
  });
});
