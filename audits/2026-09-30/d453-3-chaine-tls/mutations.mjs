/**
 * D-453 §3 — chaque contrôle de `tlsChainCompletion.ts` est RETIRÉ à tour de rôle, et la suite d'attaques
 * doit passer au rouge. Un témoin qui reste vert sans son contrôle ne garde rien.
 *
 * Rejouable depuis `apps/aggregator` (dépôt propre, rien en cours) :
 *   node ../../audits/2026-09-30/d453-3-chaine-tls/mutations.mjs
 * Le fichier source est relu avant chaque mutation et réécrit à l'identique après (empreinte vérifiée) :
 * aucun `git checkout`, qui effacerait un travail non committé.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SOURCE = 'src/lib/tlsChainCompletion.ts';
const SUITE = 'src/lib/tlsChainCompletion.test.ts';
const original = readFileSync(SOURCE, 'utf8');
const sha = text => createHash('sha256').update(text).digest('hex');
const before = sha(original);
const restore = () => writeFileSync(SOURCE, original);
process.on('SIGINT', () => { restore(); process.exit(130); });

/** [identifiant, contrôle retiré, [texte exact, remplacement][]] — chaque texte doit exister une seule fois. */
const MUTATIONS = [
  ['M1', 'intermédiaire qui n’est pas une AC (CA:TRUE, keyCertSign)', [['if (!issuer.ca) refuse(', 'if (false) refuse(']]],
  ['M2', 'intermédiaire auto-émis ou auto-signé', [['if (issuer.checkIssued(issuer) || issuer.verify(issuer.publicKey)) refuse(', 'if (false) refuse(']]],
  ['M3', 'validité de l’intermédiaire', [['if (!withinValidity(issuer, now)) refuse(', 'if (false) refuse(']]],
  ['M4', 'l’intermédiaire a signé la feuille', [['if (!leaf.checkIssued(issuer) || !leaf.verify(issuer.publicKey)) refuse(', 'if (false) refuse(']]],
  ['M5', 'l’intermédiaire est signé par une racine de confiance', [['if (!anchors.some(root => withinValidity(root, now) && issuer.checkIssued(root) && issuer.verify(root.publicKey))) {', 'if (false) {']]],
  ['M2+M5', 'auto-signé ET racine de confiance (seuls remparts contre l’AC d’un attaquant)', [
    ['if (issuer.checkIssued(issuer) || issuer.verify(issuer.publicKey)) refuse(', 'if (false) refuse('],
    ['if (!anchors.some(root => withinValidity(root, now) && issuer.checkIssued(root) && issuer.verify(root.publicKey))) {', 'if (false) {']]],
  ['M6', 'la feuille nomme l’hôte', [['if (!leaf.checkHost(host)) refuse(', 'if (false) refuse(']]],
  ['M7', 'seul l’échec « feuille seule » déclenche la complétion', [['if (errorCode(args[0]) !== LEAF_ONLY) return callback(...args);', 'if (!args[0]) return callback(...args);']]],
  ['M8', 'liste des hôtes (connecteur ET fabrique)', [
    ["if (opts.protocol !== 'https:' || !hosts.has(host)) return plain(opts, callback);", "if (opts.protocol !== 'https:') return plain(opts, callback);"],
    ["protocol === 'https:' && hosts.has(hostname)", "protocol === 'https:'"]]],
  ['M8a', 'liste des hôtes (connecteur seul)', [["if (opts.protocol !== 'https:' || !hosts.has(host)) return plain(opts, callback);", "if (opts.protocol !== 'https:') return plain(opts, callback);"]]],
  ['M8b', 'liste des hôtes (fabrique seule)', [["protocol === 'https:' && hosts.has(hostname)", "protocol === 'https:'"]]],
  ['M9', 'garde SSRF de l’URL AIA', [['    assertPublicUrl(url);\n', '    void url;\n']]],
  ['M10', 'résolution DNS publique du téléchargement AIA', [['connect: { lookup: base.lookup, timeout: base.timeout } });\n  return async url', 'connect: { timeout: base.timeout } });\n  return async url']]],
  ['M11', 'borne de taille en flux', [['if (size > limits.maxBytes) refuse(', 'if (false) refuse(']]],
  ['M11b', 'borne de taille annoncée (sortie anticipée)', [['if (Number.isFinite(declared) && declared > limits.maxBytes) refuse(', 'if (false) refuse(']]],
  ['M12', 'délai total du téléchargement', [['signal: AbortSignal.timeout(limits.timeoutMs),', 'signal: undefined,']]],
  ['M13', 'statut 200 seulement (pas de redirection)', [['if (statusCode !== 200) refuse(', 'if (false) refuse(']]],
  ['M14', 'le rejeu revérifie tout (rejectUnauthorized)', [["ca: [...rootPems, issuer.toString()], rejectUnauthorized: true })", "ca: [...rootPems, issuer.toString()], rejectUnauthorized: false })"]]],
  ['M15', 'la chaîne rejouée finit sur les racines', [["ca: [...rootPems, issuer.toString()], rejectUnauthorized: true })", "ca: [issuer.toString()], rejectUnauthorized: true })"]]],
  ['M16', 'une feuille renouvelée oublie la complétion', [['if (errorCode(args[0]) === LEAF_ONLY && completions.get(host) === known) completions.delete(host);', '']]],
  ['M17', 'cache négatif après refus', [['return { connector: null, expiresAt: now() + REFUSAL_RETRY_MS };', 'return { connector: null, expiresAt: now() };']]],
  ['M18', 'TTL du cache par URL', [['Math.min(now() + ISSUER_TTL_MS, Date.parse(issuer.validTo))', 'Date.parse(issuer.validTo)']]],
  ['M19', 'un seul certificat PEM', [["if (text.includes('-----BEGIN') && text.split('-----BEGIN').length !== 2) refuse(", 'if (false) refuse(']]],
];

function run() {
  const dir = mkdtempSync(join(tmpdir(), 'd453-mut-'));
  const out = join(dir, 'report.json');
  spawnSync('npx', ['vitest', 'run', SUITE, '--reporter=json', `--outputFile=${out}`, '--testTimeout=8000'], { encoding: 'utf8' });
  try {
    const report = JSON.parse(readFileSync(out, 'utf8'));
    const tests = report.testResults.flatMap(file => file.assertionResults);
    return { total: tests.length, failed: tests.filter(t => t.status !== 'passed').map(t => t.fullName) };
  } catch { return { total: 0, failed: ['(suite non exécutable)'] }; }
  finally { rmSync(dir, { recursive: true, force: true }); }
}

const baseline = run();
console.log(`Témoin sans mutation : ${baseline.total} tests, ${baseline.failed.length} en échec`);
if (baseline.failed.length) { console.log(baseline.failed.join('\n')); process.exit(1); }
let survivors = 0;
for (const [id, label, edits] of MUTATIONS) {
  let mutated = original;
  for (const [find, replace] of edits) {
    if (mutated.split(find).length !== 2) { restore(); throw new Error(`${id} : texte introuvable ou ambigu — ${find}`); }
    mutated = mutated.replace(find, replace);
  }
  try {
    writeFileSync(SOURCE, mutated);
    const { failed } = run();
    if (!failed.length) survivors++;
    console.log(`\n${id} — sans « ${label} » : ${failed.length ? `${failed.length} témoin(s) ROUGE(S)` : 'AUCUN témoin rouge'}`);
    for (const name of failed) console.log(`   ✗ ${name}`);
  } finally { restore(); }
}
if (sha(readFileSync(SOURCE, 'utf8')) !== before) throw new Error('Source non restaurée à l’identique');
console.log(`\nSource restaurée à l’identique (sha256 ${before.slice(0, 12)}). Mutations sans témoin rouge : ${survivors}.`);
