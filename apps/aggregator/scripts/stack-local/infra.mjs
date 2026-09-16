/**
 * Stack locale Catwalks — infrastructure partagée par les commandes.
 *
 * Tout l'état vit dans `<racine>/.stack-local/` (ignoré par Git) : configuration
 * et secrets (0600), PID des serveurs, journaux, boîte de réception, preuves.
 * Rien dans /tmp. Les conteneurs Docker portent le préfixe `catwalks-stack-`
 * et le label `catwalks.purpose=stack-local` : le script ne touche jamais un
 * conteneur qui n'a pas les deux (Supabase `*_dix`, clones, bases jetables
 * d'autres lots).
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, statSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
export const STATE = path.join(ROOT, '.stack-local');
export const CONFIG_FILE = path.join(STATE, 'config.json');
export const LABEL = 'catwalks.purpose=stack-local';
export const PREFIX = 'catwalks-stack-';
/** Image PostgreSQL exacte de la répétition du 2026-09-15 et de `test:local`. */
export const PG_IMAGE = 'postgres@sha256:d3e1620b530c944afa6e887d22eb899824da68e19c52024bf98f5220c88a65b2';

export const DEFAULT_PORTS = {
  catalogueDb: 56432, backendDb: 56433, minio: 56900, minioConsole: 56901, inbox: 56025,
  api: 3110, backend: 3101, website: 3100,
};
export const MARCHES = ['FR', 'US', 'GB', 'CA', 'DE', 'IT', 'ES', 'NL', 'AU', 'CH', 'BE', 'CN'];

export class StackError extends Error {}

export function ensureState() {
  for (const d of ['', 'pids', 'logs', 'inbox', 'proofs', 'snapshots']) mkdirSync(path.join(STATE, d), { recursive: true, mode: 0o700 });
}

export function loadConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  return JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));
}
export function saveConfig(config) {
  ensureState();
  writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  chmodSync(CONFIG_FILE, 0o600);
}
export function requireConfig() {
  const config = loadConfig();
  if (!config) throw new StackError('Stack non préparée : lancer d’abord `npm run stack:prepare -- --backend=<dossier> --website=<dossier>`');
  return config;
}

export const hex = (bytes) => randomBytes(bytes).toString('hex');

/** Exécute une commande ; `capture` rend la sortie, sinon elle est héritée. */
export function run(command, args, { cwd = ROOT, env = process.env, capture = false, allowFailure = false, input } = {}) {
  return new Promise((resolve, reject) => {
    let output = '';
    const child = spawn(command, args, { cwd, env, stdio: [input === undefined ? 'ignore' : 'pipe', capture ? 'pipe' : 'inherit', capture ? 'pipe' : 'inherit'] });
    if (input !== undefined) { child.stdin.write(input); child.stdin.end(); }
    child.stdout?.on('data', (d) => { output += d; });
    child.stderr?.on('data', (d) => { output += d; });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0 || allowFailure) resolve({ code, output: output.trim() });
      else reject(new StackError(`${command} ${args.join(' ')} → code ${code}${capture ? `\n${output.trim().slice(-2000)}` : ''}`));
    });
  });
}

let dockerHost;
/** Un démon Docker local sur socket Unix, sinon « localhost » désignerait une autre machine. */
export async function dockerEndpoint() {
  if (dockerHost) return dockerHost;
  const { output } = await run('docker', ['context', 'inspect', ...(process.env.DOCKER_CONTEXT ? [process.env.DOCKER_CONTEXT] : [])], { capture: true });
  const contextEndpoint = JSON.parse(output)[0]?.Endpoints?.docker?.Host;
  const endpoint = process.env.DOCKER_CONTEXT ? contextEndpoint : process.env.DOCKER_HOST || contextEndpoint;
  if (!endpoint?.startsWith('unix://')) throw new StackError('La stack exige un démon Docker local (socket Unix)');
  dockerHost = endpoint;
  return endpoint;
}
export async function docker(args, options = {}) {
  const host = await dockerEndpoint();
  const env = { ...(options.env ?? process.env) };
  delete env.DOCKER_CONTEXT; delete env.DOCKER_HOST;
  return run('docker', ['--host', host, ...args], { ...options, env, capture: options.capture ?? true });
}

export async function containerState(name) {
  const { code, output } = await docker(['inspect', '--format', '{{.State.Status}}|{{index .Config.Labels "catwalks.purpose"}}|{{.Config.Image}}', name], { allowFailure: true });
  if (code !== 0) return null;
  const [status, purpose, image] = output.split('|');
  if (purpose !== 'stack-local' || !name.startsWith(PREFIX)) throw new StackError(`Le conteneur ${name} existe mais n’appartient pas à la stack locale : refus de le toucher`);
  return { status, image };
}

export async function ensureImage(image) {
  const { code } = await docker(['image', 'inspect', image], { allowFailure: true });
  if (code !== 0) await docker(['pull', image], { capture: false });
}

/** Crée le conteneur s’il manque, le démarre s’il est arrêté ; ne recrée jamais un conteneur vivant. */
export async function ensureContainer({ name, image, env = {}, publish = [], volume, command = [] }) {
  const state = await containerState(name);
  if (!state) {
    await ensureImage(image);
    if (volume) await docker(['volume', 'create', '--label', LABEL, volume[0]]);
    const args = ['create', '--name', name, '--label', LABEL, '--restart', 'unless-stopped'];
    for (const [hostPort, containerPort] of publish) args.push('--publish', `127.0.0.1:${hostPort}:${containerPort}`);
    for (const [k, v] of Object.entries(env)) args.push('--env', `${k}=${v}`);
    if (volume) args.push('--volume', `${volume[0]}:${volume[1]}`);
    await docker([...args, image, ...command]);
  }
  if (!state || state.status !== 'running') await docker(['start', name]);
  return state ? 'existant' : 'créé';
}

export async function waitPostgres(name, user, db) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const { code } = await docker(['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', user, '-d', db], { allowFailure: true });
    if (code === 0) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new StackError(`${name} ne répond pas (pg_isready)`);
}

/** Exécute du SQL dans un conteneur PostgreSQL de la stack (psql du conteneur, jamais une URL affichée). */
export async function sql(name, user, db, query, { readOnly = true } = {}) {
  const prelude = readOnly ? 'SET default_transaction_read_only = on;\n' : '';
  const { output } = await docker(['exec', '-i', name, 'psql', '-U', user, '-d', db, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-At', '-F', '|'], { input: prelude + query });
  return output;
}

export function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, () => server.close(() => resolve(true)));
  });
}
export async function whoListens(port) {
  const { output } = await run('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], { capture: true, allowFailure: true });
  return output.split('\n').slice(1).map((l) => l.split(/\s+/).slice(0, 2).join(' ')).filter(Boolean).join(', ') || 'processus inconnu';
}
/** Un port pris par autre chose que la stack arrête la commande : rien n’est jamais tué. */
export async function assertPortFree(port, role, { ownPid } = {}) {
  if (await portFree(port)) return;
  const owner = await whoListens(port);
  if (ownPid && owner.includes(String(ownPid))) return;
  throw new StackError(`Le port ${port} (${role}) est déjà pris par ${owner} ; choisir un autre port dans .stack-local/config.json ou libérer celui-ci`);
}

export function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
export async function processCommand(pid) {
  const { output } = await run('ps', ['-o', 'command=', '-p', String(pid)], { capture: true, allowFailure: true });
  return output;
}

export const pgUrl = (user, password, port, db) => `postgresql://${user}:${password}@127.0.0.1:${port}/${db}`;

export function newerThan(a, b) {
  if (!existsSync(a)) return false;
  if (!existsSync(b)) return true;
  return statSync(a).mtimeMs > statSync(b).mtimeMs;
}

/** Les fichiers que Next réécrit (include de tsconfig, next-env.d.ts) sont sauvegardés puis restaurés. */
export function snapshotTypes(appDir, key) {
  const dir = path.join(STATE, 'snapshots', key); mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const f of ['tsconfig.json', 'next-env.d.ts']) {
    const p = path.join(appDir, f);
    if (existsSync(p)) writeFileSync(path.join(dir, f), readFileSync(p));
  }
}
export function restoreTypes(appDir, key) {
  const dir = path.join(STATE, 'snapshots', key); const restored = [];
  for (const f of ['tsconfig.json', 'next-env.d.ts']) {
    const saved = path.join(dir, f), p = path.join(appDir, f);
    if (!existsSync(saved) || !existsSync(p)) continue;
    const before = readFileSync(saved), after = readFileSync(p);
    if (!before.equals(after)) { writeFileSync(p, before); restored.push(f); }
  }
  return restored;
}

export function parseArgs(argv) {
  const flags = {}; const positional = [];
  for (const a of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(a);
    if (m) flags[m[1]] = m[2] ?? true; else positional.push(a);
  }
  return { flags, positional };
}
