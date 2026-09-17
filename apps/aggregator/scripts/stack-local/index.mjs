#!/usr/bin/env node
/**
 * Stack locale Catwalks — un seul parcours maintenu : préparer, démarrer,
 * vérifier, arrêter, réinitialiser (les seules données de test).
 *
 *   npm run stack:prepare -- --backend=<dossier catwalks-backend> --website=<dossier catwalks-website> [--offres=650]
 *   npm run stack:start   -- [--mode=dev|build] [--only=api,backend,website]
 *   npm run stack:verify  -- [--mode=dev|build] [--sans-navigateur]
 *   npm run stack:stop    -- [--containers]
 *   npm run stack:reset   -- --oui
 *   npm run stack:status
 *   npm run stack:sync    -- [--limite=200] [--depuis=0]    (rejoue la synchronisation des offres directes, à la main)
 *   npm run stack:exec    -- <commande> [arguments…]        (lance une commande avec l'environnement isolé de la stack :
 *                                                            base catalogue, archive MinIO, flux du backend ; ex. node --import tsx apps/aggregator/scripts/ops/source-onboard.mts status oh-my-cream)
 *
 * Composants : base catalogue (PostgreSQL), base backend de test (PostgreSQL),
 * archive RAW (MinIO), API catalogue (apps/api), backend Catwalks, site,
 * boîte de réception Brevo locale. Ports et secrets : `.stack-local/config.json`.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PORTS, LABEL, PG_IMAGE, PREFIX, ROOT, STATE, StackError, assertPortFree, containerState, docker, ensureContainer, ensureState,
  hex, loadConfig, newerThan, parseArgs, processAlive, processCommand, requireConfig, restoreTypes, run, saveConfig, snapshotTypes, sql, waitPostgres,
} from './infra.mjs';
import { BACKEND_DB, CATALOGUE_DB, MINIO_BUCKET, appDirs, backendDbUrl, catalogueDbUrl, envApi, envBackend, envCli, envWebsite, urls } from './env.mjs';
import { directSync, verify } from './verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { flags, positional } = parseArgs(process.argv.slice(2));
const commande = positional[0];
const mode = flags.mode === 'build' ? 'build' : 'dev';
const CONTAINERS = (config) => ({
  catalogueDb: { name: `${PREFIX}catalogue-db`, image: PG_IMAGE, publish: [[config.ports.catalogueDb, 5432]], volume: [`${PREFIX}catalogue-data`, '/var/lib/postgresql'],
    env: { POSTGRES_USER: 'catwalks', POSTGRES_DB: CATALOGUE_DB, POSTGRES_PASSWORD: config.secrets.pgCatalogue } },
  backendDb: { name: `${PREFIX}backend-db`, image: PG_IMAGE, publish: [[config.ports.backendDb, 5432]], volume: [`${PREFIX}backend-data`, '/var/lib/postgresql'],
    env: { POSTGRES_USER: 'catwalks', POSTGRES_DB: BACKEND_DB, POSTGRES_PASSWORD: config.secrets.pgBackend } },
  minio: { name: `${PREFIX}minio`, image: config.images.minio, publish: [[config.ports.minio, 9000], [config.ports.minioConsole, 9001]], volume: [`${PREFIX}minio-data`, '/data'],
    env: { MINIO_ROOT_USER: config.secrets.minioUser, MINIO_ROOT_PASSWORD: config.secrets.minioPassword }, command: ['server', '/data', '--console-address', ':9001'] },
});

function nodeVersionCheck() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  const engines = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).engines?.node ?? '';
  const ok = (major === 22 && minor >= 12) || major === 24 || major >= 26;
  if (!ok) throw new StackError(`Node ${process.versions.node} hors de « ${engines} » (dépôt agrégateur)`);
  return `${process.versions.node} (attendu ${engines})`;
}

/** Installé = chaque paquet requis se résout vraiment depuis le dossier de résolution (un node_modules sans le
 * SDK S3 a déjà empêché un démarrage : la date du lock ne le voit pas). node_modules absent → `npm ci` ;
 * présent mais incomplet → installation ADDITIVE depuis le lock (jamais `npm ci`, qui effacerait le
 * node_modules d'un serveur de développement du propriétaire en cours d'exécution), et le lock doit rester
 * identique : sinon la préparation s'arrête et le lock est restauré. */
async function installIfNeeded(dir, label, { args = [], requis, resolveFrom = dir }) {
  const lock = path.join(dir, 'package-lock.json');
  if (!existsSync(lock)) throw new StackError(`${label} : package-lock.json absent, installation depuis le lock impossible`);
  // Résolution à la manière de Node (node_modules en remontant), sans passer par la carte `exports` des paquets.
  const resolu = (pkg) => { for (let d = resolveFrom; ; d = path.dirname(d)) { if (existsSync(path.join(d, 'node_modules', pkg, 'package.json'))) return true; if (d === path.dirname(d)) return false; } };
  const manquants = () => requis.filter((pkg) => !resolu(pkg));
  const absents = existsSync(path.join(dir, 'node_modules')) ? false : true;
  if (!absents && manquants().length === 0) return `${label} : installé (${requis.length} paquets requis résolus)`;
  const avant = readFileSync(lock);
  if (absents) { console.log(`${label} : npm ci depuis le lock…`); await run('npm', ['ci', '--no-audit', '--no-fund', ...args], { cwd: dir }); }
  else { console.log(`${label} : installation additive depuis le lock (manquants : ${manquants().join(', ')})…`); await run('npm', ['install', '--no-audit', '--no-fund', ...args], { cwd: dir }); }
  if (!readFileSync(lock).equals(avant)) {
    const copie = path.join(STATE, 'logs', `${label}-package-lock.modifie.json`);
    writeFileSync(copie, readFileSync(lock)); writeFileSync(lock, avant);
    throw new StackError(`${label} : npm a modifié package-lock.json ; lock restauré, version modifiée conservée dans ${path.relative(ROOT, copie)} pour examen`);
  }
  const encore = manquants();
  if (encore.length) throw new StackError(`${label} : après installation, paquets toujours introuvables : ${encore.join(', ')}`);
  return `${label} : installé (${absents ? 'npm ci' : 'additif'}, lock inchangé)`;
}

async function ensureBucket(config) {
  const { S3Client, CreateBucketCommand, HeadBucketCommand } = await import('@aws-sdk/client-s3');
  const client = new S3Client({ endpoint: urls(config).minio, region: 'local', forcePathStyle: true, credentials: { accessKeyId: config.secrets.minioUser, secretAccessKey: config.secrets.minioPassword } });
  for (let attempt = 0; attempt < 30; attempt++) {
    try { await client.send(new HeadBucketCommand({ Bucket: MINIO_BUCKET })); return 'existant'; }
    catch (error) {
      if (error.$metadata?.httpStatusCode === 404 || error.name === 'NotFound') { await client.send(new CreateBucketCommand({ Bucket: MINIO_BUCKET })); return 'créé'; }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new StackError('MinIO ne répond pas');
}

async function containersUp(config) {
  const etats = {};
  for (const [key, spec] of Object.entries(CONTAINERS(config))) etats[key] = await ensureContainer(spec);
  await waitPostgres(`${PREFIX}catalogue-db`, 'catwalks', CATALOGUE_DB);
  await waitPostgres(`${PREFIX}backend-db`, 'catwalks', BACKEND_DB);
  etats.bucket = await ensureBucket(config);
  return etats;
}

async function migrate(config) {
  const cli = envCli(config);
  await run('npx', ['--no-install', 'prisma', 'generate', '--schema', 'packages/db/prisma/schema.prisma'], { cwd: ROOT, env: cli, capture: true });
  await run('npx', ['--no-install', 'prisma', 'migrate', 'deploy', '--schema', 'packages/db/prisma/schema.prisma'], { cwd: ROOT, env: cli, capture: true });
  const backend = envBackend(config, 'dev');
  await run('npx', ['--no-install', 'prisma', 'migrate', 'deploy'], { cwd: config.dirs.backend, env: backend, capture: true });
  const a = await sql(`${PREFIX}catalogue-db`, 'catwalks', CATALOGUE_DB, 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;');
  const b = await sql(`${PREFIX}backend-db`, 'catwalks', BACKEND_DB, 'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL;');
  return { catalogue: Number(a), backend: Number(b) };
}

async function seed(config) {
  const env = { ...envBackend(config, 'dev'), BACKEND_DIR: config.dirs.backend, SEED_OFFRES: String(config.seed.offres), CANDIDATE_EMAIL: config.seed.candidatEmail, CANDIDATE_PASSWORD: config.secrets.candidatPassword };
  const { output } = await run('node', [path.join(HERE, 'seed.mjs')], { cwd: ROOT, env, capture: true });
  return JSON.parse(output.split('\n').filter(Boolean).at(-1));
}

async function prepare() {
  ensureState();
  const node = nodeVersionCheck();
  let config = loadConfig();
  const backendDir = flags.backend ?? config?.dirs?.backend ?? process.env.CATWALKS_BACKEND_DIR;
  const websiteDir = flags.website ?? config?.dirs?.website ?? process.env.CATWALKS_WEBSITE_DIR;
  for (const [label, dir] of [['backend', backendDir], ['website', websiteDir]]) {
    if (!dir || !existsSync(path.join(dir, 'package.json'))) throw new StackError(`Dossier ${label} introuvable : passer --${label}=<dossier du dépôt ${label === 'backend' ? 'catwalks-backend' : 'catwalks-website'}>`);
  }
  if (!config) {
    const { output } = await docker(['image', 'inspect', '--format', '{{index .RepoDigests 0}}', 'minio/minio:latest'], { allowFailure: true });
    const minio = output.startsWith('minio/minio@') ? output : 'minio/minio:latest';
    config = {
      creeLe: new Date().toISOString(), dirs: { backend: path.resolve(backendDir), website: path.resolve(websiteDir) }, ports: { ...DEFAULT_PORTS },
      images: { postgres: PG_IMAGE, minio },
      secrets: { pgCatalogue: hex(16), pgBackend: hex(16), catalogueApiKey: `stack-${hex(24)}`, fluxKey: `stack-${hex(24)}`, nextauthSecret: hex(32), cronSecret: hex(24), brevoKey: `xkeysib-stack-local-${hex(8)}`, minioUser: `stack-${hex(4)}`, minioPassword: hex(16), candidatPassword: `Stack-${hex(6)}-Test1!` },
      seed: { offres: Number(flags.offres ?? 650), candidatEmail: 'candidat.stack@catwalks.test', maison: 'Maison Test Stack (synthétique)' },
    };
    saveConfig(config);
  } else if (flags.offres) { config.seed.offres = Number(flags.offres); saveConfig(config); }
  for (const [role, port] of [['base catalogue', config.ports.catalogueDb], ['base backend', config.ports.backendDb], ['MinIO', config.ports.minio], ['console MinIO', config.ports.minioConsole]]) {
    const name = role === 'base catalogue' ? `${PREFIX}catalogue-db` : role === 'base backend' ? `${PREFIX}backend-db` : `${PREFIX}minio`;
    const state = await containerState(name);
    if (!state || state.status !== 'running') await assertPortFree(port, role);
  }
  const installations = [
    await installIfNeeded(ROOT, 'agrégateur', { args: ['--workspaces', '--include-workspace-root'], resolveFrom: path.join(ROOT, 'apps/aggregator'), requis: ['@aws-sdk/client-s3', 'playwright', 'tsx', '@prisma/client', 'prisma'] }),
    await installIfNeeded(config.dirs.backend, 'backend', { requis: ['next', '@prisma/client', 'prisma', 'bcryptjs'] }),
    await installIfNeeded(config.dirs.website, 'site', { requis: ['next'] }),
  ];
  const conteneurs = await containersUp(config);
  const migrations = await migrate(config);
  const semis = await seed(config);
  console.log(JSON.stringify({ node, conteneurs, installations, migrations, semis, configuration: path.relative(ROOT, path.join(STATE, 'config.json')) }, null, 2));
  console.log('\nPrêt. Ensuite : npm run stack:start, puis npm run stack:verify.');
}

const pidFile = (key) => path.join(STATE, 'pids', `${key}.json`);
function readPid(key) {
  if (!existsSync(pidFile(key))) return null;
  const info = JSON.parse(readFileSync(pidFile(key), 'utf8'));
  return processAlive(info.pid) ? info : null;
}
async function spawnServer(key, args, { cwd, env, port }) {
  const log = openSync(path.join(STATE, 'logs', `${key}.log`), 'a');
  const child = spawn('npx', ['--no-install', ...args], { cwd, env, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  writeFileSync(pidFile(key), JSON.stringify({ pid: child.pid, port, cwd, args, startedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
  return child.pid;
}
async function waitHttp(url, label, timeoutMs = 240_000) {
  const debut = Date.now();
  while (Date.now() - debut < timeoutMs) {
    try { const r = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(5000) }); if (r.status < 500) return r.status; } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new StackError(`${label} ne répond pas sur ${url} après ${timeoutMs / 1000} s (journal : .stack-local/logs/)`);
}

async function start() {
  const config = requireConfig(); ensureState();
  const only = flags.only ? String(flags.only).split(',') : ['inbox', 'api', 'backend', 'website'];
  const dirs = appDirs(config), u = urls(config);
  await containersUp(config);
  const demarre = {};
  if (only.includes('inbox')) {
    const info = readPid('inbox');
    if (info) demarre.inbox = `déjà vivant (pid ${info.pid})`;
    else {
      await assertPortFree(config.ports.inbox, 'boîte de réception');
      const log = openSync(path.join(STATE, 'logs', 'inbox.log'), 'a');
      const child = spawn(process.execPath, [path.join(HERE, 'inbox.mjs')], { env: { PATH: process.env.PATH, INBOX_PORT: String(config.ports.inbox), INBOX_DIR: path.join(STATE, 'inbox') }, detached: true, stdio: ['ignore', log, log] });
      child.unref();
      writeFileSync(pidFile('inbox'), JSON.stringify({ pid: child.pid, port: config.ports.inbox, startedAt: new Date().toISOString() }) + '\n', { mode: 0o600 });
      demarre.inbox = `pid ${child.pid}`;
    }
  }
  const apps = [
    ['api', dirs.api, envApi(config, mode), config.ports.api, `${u.api}/api/health`],
    ['backend', dirs.backend, envBackend(config, mode), config.ports.backend, `${u.backend}/api/catalogue/flux`],
    ['website', dirs.website, envWebsite(config, mode), config.ports.website, `${u.website}/emplois?marche=FR`],
  ];
  for (const [key, dir, env, port, probe] of apps) {
    if (!only.includes(key)) continue;
    const info = readPid(key);
    if (info) { demarre[key] = `déjà vivant (pid ${info.pid}, port ${info.port})`; continue; }
    await assertPortFree(port, key);
    snapshotTypes(dir, key);
    if (mode === 'build') {
      console.log(`${key} : next build (${path.relative(ROOT, dir) || dir})…`);
      const log = openSync(path.join(STATE, 'logs', `${key}-build.log`), 'a');
      await new Promise((resolve, reject) => {
        const child = spawn('npx', ['--no-install', 'next', 'build'], { cwd: dir, env, stdio: ['ignore', log, log] });
        child.once('exit', (code) => (code === 0 ? resolve() : reject(new StackError(`${key} : next build a échoué (code ${code}, journal .stack-local/logs/${key}-build.log)`))));
      });
      restoreTypes(dir, key);
      await spawnServer(key, ['next', 'start', '-p', String(port)], { cwd: dir, env, port });
    } else {
      await spawnServer(key, ['next', 'dev', '-p', String(port)], { cwd: dir, env, port });
    }
    const status = await waitHttp(probe, key);
    demarre[key] = `pid ${readPid(key)?.pid} (mode ${mode}, port ${port}, sonde ${status})`;
  }
  console.log(JSON.stringify({ mode, demarre, urls: { site: u.website, siteFrance: `http://fr.catwalks.localhost:${config.ports.website}/emplois`, api: u.api, backend: u.backendPublic, inbox: `${u.inbox}/`, minioConsole: u.minioConsole } }, null, 2));
}

async function stop() {
  const config = loadConfig();
  const arrets = {};
  for (const f of existsSync(path.join(STATE, 'pids')) ? readdirSync(path.join(STATE, 'pids')) : []) {
    const key = f.replace(/\.json$/, ''), info = JSON.parse(readFileSync(pidFile(key), 'utf8'));
    if (processAlive(info.pid)) {
      const cmd = await processCommand(info.pid);
      // Ne tuer que ce que la stack a lancé : la commande doit encore être un serveur Next/Node de la stack.
      if (/next|inbox\.mjs|node/.test(cmd)) { try { process.kill(-info.pid, 'SIGTERM'); } catch { process.kill(info.pid, 'SIGTERM'); } arrets[key] = `arrêté (pid ${info.pid})`; }
      else arrets[key] = `pid ${info.pid} réutilisé par un autre processus, non touché`;
    } else arrets[key] = 'déjà arrêté';
    unlinkSync(pidFile(key));
  }
  if (config) for (const [key, dir] of Object.entries(appDirs(config))) { const r = restoreTypes(dir, key); if (r.length) arrets[`${key}.types_restaures`] = r; }
  if (flags.containers && config) for (const spec of Object.values(CONTAINERS(config))) { if ((await containerState(spec.name))?.status === 'running') { await docker(['stop', spec.name]); arrets[spec.name] = 'conteneur arrêté'; } }
  console.log(JSON.stringify(arrets, null, 2));
}

async function status() {
  const config = loadConfig();
  if (!config) { console.log('Stack non préparée.'); return; }
  const etat = { conteneurs: {}, serveurs: {}, urls: urls(config) };
  for (const spec of Object.values(CONTAINERS(config))) etat.conteneurs[spec.name] = (await containerState(spec.name))?.status ?? 'absent';
  for (const key of ['inbox', 'api', 'backend', 'website']) { const info = readPid(key); etat.serveurs[key] = info ? `vivant (pid ${info.pid}, port ${info.port}, depuis ${info.startedAt})` : 'arrêté'; }
  console.log(JSON.stringify(etat, null, 2));
}

async function reset() {
  if (!flags.oui) throw new StackError('Réinitialisation : ajouter --oui (elle efface les bases, l’archive et la boîte de réception DE LA STACK, rien d’autre)');
  const config = requireConfig();
  await stop();
  for (const spec of Object.values(CONTAINERS(config))) {
    if (await containerState(spec.name)) await docker(['rm', '--force', '--volumes', spec.name]);
    if (spec.volume) { const { output } = await docker(['volume', 'inspect', '--format', '{{index .Labels "catwalks.purpose"}}', spec.volume[0]], { allowFailure: true }); if (output === 'stack-local') await docker(['volume', 'rm', spec.volume[0]]); }
  }
  for (const d of ['inbox', 'proofs']) for (const f of readdirSync(path.join(STATE, d))) unlinkSync(path.join(STATE, d, f));
  await containersUp(config);
  const migrations = await migrate(config), semis = await seed(config);
  console.log(JSON.stringify({ reinitialise: true, migrations, semis }, null, 2));
}

try {
  switch (commande) {
    case 'prepare': await prepare(); break;
    case 'start': await start(); break;
    case 'verify': { const ok = await verify(requireConfig(), { mode, navigateur: !flags['sans-navigateur'] }); process.exitCode = ok ? 0 : 1; break; }
    case 'stop': await stop(); break;
    case 'reset': await reset(); break;
    case 'status': await status(); break;
    case 'exec': {
      // Arguments BRUTS après « exec » : les options de la commande lancée (--import, --apply…) ne sont pas les nôtres.
      const brut = process.argv.slice(2); const [cmd, ...args] = brut.slice(brut.indexOf('exec') + 1);
      if (!cmd) throw new StackError('exec : indiquer la commande à lancer après stack:exec --');
      const child = spawn(cmd, args, { cwd: ROOT, env: envCli(requireConfig()), stdio: 'inherit' });
      process.exitCode = await new Promise((resolve) => child.once('exit', (code) => resolve(code ?? 1)));
      break;
    }
    case 'sync': {
      const args = ['--limite=' + String(flags.limite ?? 200), ...(flags.depuis !== undefined ? ['--depuis=' + String(flags.depuis)] : [])];
      const { stats, output } = await directSync(requireConfig(), args);
      console.log(JSON.stringify(stats ?? { erreur: output.slice(-800) }, null, 2)); process.exitCode = stats && !stats.refus ? 0 : 1; break;
    }
    default: throw new StackError('Commandes : prepare | start | verify | stop | reset | status | sync | exec');
  }
} catch (error) {
  console.error(error instanceof StackError ? `stack : ${error.message}` : error);
  process.exitCode = 1;
}
