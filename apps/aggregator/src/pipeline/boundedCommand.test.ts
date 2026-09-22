import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { REFRESH_MANIFEST_VERSION } from './refreshManifest.js';

/**
 * Le chemin est résolu depuis CE FICHIER, jamais depuis le répertoire courant.
 *
 * `test:unit` s'exécute depuis la racine du dépôt et `test:integration` depuis `apps/aggregator` : un chemin
 * relatif au cwd fonctionne dans l'un et se dédouble dans l'autre (`apps/aggregator/apps/aggregator/…`). La CI
 * l'a vu, ma vérification locale non — je n'avais lancé vitest que depuis la racine.
 */
const SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/ops/bounded-command.py');

/**
 * LA COMMANDE BORNÉE — ce qui la rend sûre doit être vérifié, pas relu.
 *
 * Elle est posée comme commande de démarrage d'un service de PRODUCTION. Une commande mal formée qui se
 * déploie quand même remplace la commande normale par quelque chose qui échoue : le service reste alors dans
 * un état borné inutilisable. Et une commande qui oublierait son allowlist lancerait les 440 sources.
 */
const build = (runName: string, keys: string) =>
  execFileSync('python3', [SCRIPT, runName, keys], { encoding: 'utf8' });

describe('bounded-command — la commande de démarrage d\'une ingestion bornée', () => {
  const keys = 'mecca,beiersdorf';
  const cmd = build('p7-test', keys);

  it('porte l\'allowlist EXACTE, visible dans le manifeste du déploiement', () => {
    // La garde d'exécution cherche littéralement `INGEST_ONLY_KEYS=<clés> ` : sans l'espace final, une
    // allowlist plus longue commençant par les mêmes clés passerait la garde.
    expect(cmd).toContain(`INGEST_ONLY_KEYS=${keys} `);
  });

  it('conserve les canaux d\'alerte et désactive seulement l\'indexation Google', () => {
    expect(cmd).not.toContain('-u BREVO_API_KEY');
    expect(cmd).not.toContain('-u HEALTHCHECK_PING_URL');
    expect(cmd).toContain('-u GOOGLE_INDEXING_CREDENTIALS');
  });

  it('appelle l\'orchestrateur d\'INGESTION, et rien d\'autre — ni refresh, ni snapshot, ni reconcile', () => {
    expect(cmd).toContain('ingestAllBySource');
    expect(cmd).not.toContain('runRefresh');
    expect(cmd).not.toContain('runSnapshot');
    expect(cmd).not.toContain('runReconcile');
  });

  it('ferme toujours son PipelineRun, y compris en erreur — sinon la garde de déploiement le croit en vol', () => {
    // Le succès distingue COMPLETED de COMPLETED_WITH_ERRORS selon le résultat ; l'échec est inconditionnel.
    expect(cmd).toContain('"COMPLETED_WITH_ERRORS":"COMPLETED"');
    expect(cmd).toContain('run.finish("FAILED")');
    expect(cmd).toContain('catch(error)');
  });

  it('n\'est jamais la commande normale : la garde d\'exécution refuserait de lancer', () => {
    expect(cmd).not.toBe('sh apps/aggregator/start.sh');
    expect(cmd.startsWith('env -u ')).toBe(true);
  });

  it('le JavaScript est échappé en UN seul argument shell, guillemets et $ compris', () => {
    // `$disconnect` et les guillemets doubles survivent : assemblée à la main en shell, la commande se cassait.
    expect(cmd).toContain('$disconnect');
    expect(cmd).toContain('startObservability');
    const quoted = cmd.slice(cmd.indexOf(" -e '") + 4);
    expect(quoted.startsWith("'")).toBe(true);
    expect(quoted.trimEnd().endsWith("'")).toBe(true);
  });

  it('le nom du run est repris tel quel, pour que l\'attente lise le bon PipelineRun', () => {
    expect(build('p7-bounded-ingest-20260912T100000Z', keys)).toContain('"p7-bounded-ingest-20260912T100000Z"');
  });
});

/**
 * LA COMMANDE DE REFRESH BORNÉ — elle porte le manifeste, donc la mutation n'a rien à recalculer.
 *
 * La version du manifeste vient du PLANIFICATEUR, jamais d'un littéral : ce test acceptait « version 2 » quand
 * le planificateur produisait la 3 depuis le lot 1, et validait donc une commande qui refusait tout manifeste
 * réel (mesuré le 16 septembre 2026).
 */
const REFRESH_SCRIPT = resolve(dirname(fileURLToPath(import.meta.url)), '../../scripts/ops/bounded-refresh-command.py');

describe('bounded-refresh-command — le refresh consomme le manifeste', () => {
  const manifestFile = resolve('/tmp', `p7-manifest-${process.pid}.json`);
  writeFileSync(manifestFile, JSON.stringify({ version: REFRESH_MANIFEST_VERSION, planHash: 'a'.repeat(64), allowedSourceKeys: ['mecca','beiersdorf'], entries: [{ jobSourceId: 'JS1' }, { jobSourceId: 'JS2' }] }));
  const cmd = execFileSync('python3', [REFRESH_SCRIPT, 'p7-test', 'mecca,beiersdorf', manifestFile],
    { encoding: 'utf8' });

  it('porte REFRESH_ONLY_KEYS exactement, et JAMAIS INGEST_ONLY_KEYS', () => {
    expect(cmd).toContain('REFRESH_ONLY_KEYS=mecca,beiersdorf ');
    expect(cmd).not.toContain('INGEST_ONLY_KEYS');
  });

  it('charge le manifeste complet par son empreinte sans limite de taille des arguments', () => {
    expect(cmd).toContain(`loadRefreshManifest(p,\"${'a'.repeat(64)}\")`);
    expect(cmd).not.toContain('jobSourceId');
    expect(cmd).toContain('onlyKeys:keys,manifest');
  });

  it('appelle runRefresh et RIEN d\'autre — ni ingestion, ni snapshot, ni geocode', () => {
    expect(cmd).toContain('runRefresh');
    expect(cmd).not.toContain('ingestAllBySource');
    expect(cmd).not.toContain('runSnapshot');
    expect(cmd).not.toContain('runGeocode');
  });

  it('ferme toujours son PipelineRun, y compris en erreur', () => {
    expect(cmd).toContain('run.finish("FAILED")');
    expect(cmd).toContain('catch(error)');
  });

  it('conserve les canaux d\'alerte et désactive seulement l\'indexation Google', () => {
    expect(cmd).not.toContain('-u BREVO_API_KEY');
    expect(cmd).not.toContain('-u HEALTHCHECK_PING_URL');
    expect(cmd).toContain('-u GOOGLE_INDEXING_CREDENTIALS');
  });

  it('refuse un manifeste d\'une version antérieure : il ne nomme pas sa capture attestante', () => {
    const stale = resolve('/tmp', `p7-manifest-stale-${process.pid}.json`);
    writeFileSync(stale, JSON.stringify({ version: REFRESH_MANIFEST_VERSION - 1, planHash: 'a'.repeat(64), allowedSourceKeys: ['mecca'], entries: [] }));
    expect(() => execFileSync('python3', [REFRESH_SCRIPT, 'p7-test', 'mecca', stale], { encoding: 'utf8', stdio: 'pipe' })).toThrow(/Unsupported refresh manifest/);
  });
});

function commandArgs(command: string): string[] {
  return JSON.parse(execFileSync('python3', ['-c', 'import json,shlex,sys;print(json.dumps(shlex.split(sys.stdin.read())))'],
    { input: command, encoding: 'utf8' })) as string[];
}

/** Execute the generated control flow with inert boundaries: no Prisma, transport or heartbeat network. */
async function executeGenerated(command: string, mode: 'success' | 'partial' | 'throw' | 'startup-error' | 'paused') {
  const events: string[] = [];
  const processState = { exitCode: 0 };
  const paused = new Error('paused');
  const body = commandArgs(command).at(-1)!.replace(/import \{[^}]+\} from "[^"]+"; /g, '');
  const result = { failed: mode === 'partial' ? 1 : 0, timedOut: 0, refused: mode === 'partial' ? 1 : 0 };
  const operation = async () => {
    events.push('operation');
    if (mode === 'throw') throw new Error('operation failed');
    return result;
  };
  try {
    await runInNewContext(`(async () => { ${body} })()`, {
      process: processState,
      exitIfPipelinePaused: () => { events.push('pause-check'); if (mode === 'paused') throw paused; },
      PrismaClient: class { constructor() { events.push('database'); } async $disconnect() { events.push('disconnect'); } },
      startObservability: async () => {
        events.push('start');
        if (mode === 'startup-error') throw new Error('observability failed');
        return { finish: async (status: string) => { events.push(`finish:${status}`); } };
      },
      ingestAllBySource: operation, runRefresh: operation,
      loadRefreshManifest: async () => { events.push('manifest'); return { entries: [] }; },
      pingHeartbeat: async (ok: boolean) => { events.push(`heartbeat:${ok}`); return 'pinged'; },
      log: { info: async (event: string) => { events.push(`log:${event}`); }, error: async () => {} },
      closeBrowser: async () => { events.push('close-browser'); },
    });
  } catch (error) { if (error !== paused) throw error; }
  return { events, exitCode: processState.exitCode };
}

describe.each(['ingest', 'refresh'] as const)('bounded %s — pause et résultat observé', kind => {
  function command(keys = 'mecca', runName = 'bounded-test') {
    if (kind === 'ingest') return build(runName, keys);
    const file = resolve('/tmp', `bounded-control-${process.pid}.json`);
    writeFileSync(file, JSON.stringify({ version: REFRESH_MANIFEST_VERSION, planHash: 'a'.repeat(64), allowedSourceKeys: keys ? keys.split(',') : [], entries: [] }));
    return execFileSync('python3', [REFRESH_SCRIPT, runName, keys, file], { encoding: 'utf8', stdio: 'pipe' });
  }

  it('arrête une pause avant Prisma, observabilité, manifeste, collecte et heartbeat', async () => {
    expect((await executeGenerated(command(), 'paused')).events).toEqual(['pause-check']);
  });

  it.each(['success', 'partial', 'throw'] as const)('rapporte exactement une fois le résultat terminal %s', async mode => {
    const { events, exitCode } = await executeGenerated(command(), mode);
    const ok = mode === 'success';
    const finish = mode === 'throw' ? 'FAILED' : ok ? 'COMPLETED' : 'COMPLETED_WITH_ERRORS';
    expect(exitCode).toBe(ok ? 0 : 1);
    expect(events.filter(event => event.startsWith('heartbeat:'))).toEqual([`heartbeat:${ok}`]);
    expect(events.indexOf(`finish:${finish}`)).toBeLessThan(events.indexOf(`heartbeat:${ok}`));
    expect(events).toContain('log:heartbeat.completed');
    expect(events.at(-1)).toBe('disconnect');
  });

  it('signale aussi un échec de démarrage sans lancer le travail', async () => {
    const { events, exitCode } = await executeGenerated(command(), 'startup-error');
    expect(exitCode).toBe(1);
    expect(events).not.toContain('operation');
    expect(events).toContain('heartbeat:false');
    expect(events.at(-1)).toBe('disconnect');
  });

  it('refuse une allowlist vide qui élargirait le passage à tout le registre', () => {
    expect(() => command('')).toThrow();
  });

  it('préserve les clés et le nom de run comme données shell et JavaScript', () => {
    const keys = 'source;echo unsafe';
    const args = commandArgs(command(keys, 'run"; throw new Error("injected"); //'));
    expect(args).toContain(`${kind === 'ingest' ? 'INGEST' : 'REFRESH'}_ONLY_KEYS=${keys}`);
    expect(execFileSync('node', ['--check', '--input-type=module'], { input: args.at(-1)!, encoding: 'utf8' })).toBe('');
  });
});


it('keeps a large refresh plan out of argv and safely quotes the run name', () => {
  const file = resolve('/tmp', `large-refresh-plan-${process.pid}.json`);
  writeFileSync(file, JSON.stringify({ version: REFRESH_MANIFEST_VERSION, planHash: 'f'.repeat(64), allowedSourceKeys: ['source'],
    entries: Array.from({ length: 1000 }, (_, i) => ({ jobSourceId: String(i), rawPlaceholder: 'x'.repeat(1000) })) }));
  const command = execFileSync('python3', [REFRESH_SCRIPT, 'run"; throw new Error("injected"); //', 'source', file], { encoding: 'utf8' });
  expect(Buffer.byteLength(command)).toBeLessThan(5000);
  const args = JSON.parse(execFileSync('python3', ['-c', 'import json,shlex,sys;print(json.dumps(shlex.split(sys.stdin.read())))'], { input: command, encoding: 'utf8' })) as string[];
  expect(args.at(-1)).toContain('run\\"; throw new Error(\\"injected\\"); //');
  expect(execFileSync('node', ['--check', '--input-type=module'], { input: args.at(-1)!, encoding: 'utf8' })).toBe('');
});
