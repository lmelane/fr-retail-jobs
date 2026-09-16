/**
 * CONSTRUIRE UN DOSSIER DE PREUVE D60 — générique, pour toute source, jamais un script par Maison.
 *
 * D60 exige, pour certifier un portail, une page officielle **archivée et hachée** qui NOMME le board
 * réellement configuré. La vague 1 de P9 a montré que le domaine ne suffit pas : `kult-olymp-hades`
 * (domaine `kult-olymp-hades.de`) appelle `jpweltersgorgensgmbhcobekleidungskg.recruitee.com`, et
 * `oak-essentials` (domaine `oakessentials.com`) le board Greenhouse `jennikayne`.
 *
 * Ce programme automatise ce qui peut l'être — téléchargement, redirections, archivage, hachage, extraction
 * de la référence, brouillon de spec — et **rien de plus** : la concordance est décidée par
 * `src/certification/portalProof.ts`, testée hors réseau, et le verdict est **fail-closed**. Une page qui ne
 * nomme pas le board laisse la source bloquée.
 *
 * Le locator attendu n'est pas saisi à la main : il est **dérivé de la configuration** de la source par type
 * d'ATS (`boardReferenceFor`), pour qu'on ne puisse pas prouver autre chose que ce qui est réellement appelé.
 *
 * usage: db.py readonly npx tsx scripts/ops/certification/build-proof.mts --key=<sourceKey>
 *          --official-url=<url> [--official-domain=<domaine>] [--scope=SINGLE_BRAND|MULTI_BRAND]
 *          [--sector=<code>] [--out-dir=<dossier>]
 */
import { PrismaClient } from '@prisma/client';
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { portalProof } from '../../../src/certification/portalProof.js';
import { boardReferenceFor } from '../../../src/certification/boardReference.js';
import { fetchFollowingSafely, readBodyBounded } from '../../../src/lib/http.js';
import { sourceSignal, withSourceBudget } from '../../../src/lib/sourceBudget.js';

const arg = (n: string) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const key = arg('key');
const officialUrl = arg('official-url');
if (!key || !officialUrl) {
  console.error('usage: build-proof.mts --key=<sourceKey> --official-url=<url> [--official-domain=] [--scope=] [--sector=] [--out-dir=]');
  process.exit(2);
}
const outDir = arg('out-dir') ?? 'backups/lot4-20260909/p9-proofs';
const scope = arg('scope') ?? 'SINGLE_BRAND';

const prisma = new PrismaClient();
const source = await prisma.source.findUniqueOrThrow({
  where: { key },
  select: { key: true, maison: true, kind: true, tier: true, config: true, careersDomain: true },
});
const config = (source.config ?? {}) as Record<string, unknown>;

// La référence à trouver est DÉRIVÉE de la configuration : on ne peut pas prouver un board qu'on n'appelle pas.
const mustContain = boardReferenceFor(source.kind, config, { maison: source.maison });
const officialDomain = arg('official-domain') ?? new URL(officialUrl).hostname.replace(/^www\./, '');

let httpStatus = 0;
let finalUrl = officialUrl;
let body = '';
try {
  const page = await withSourceBudget(async () => {
    const response = await fetchFollowingSafely(officialUrl,
      { headers: { accept: 'text/html,application/xhtml+xml' } }, sourceSignal()!);
    return { status: response.status, url: response.url || officialUrl,
      body: await readBodyBounded(response, officialUrl) };
  }, 60_000, `${key}:official-page`);
  httpStatus = page.status;
  finalUrl = page.url;
  body = page.body;
} catch (error) {
  // Un échec de lecture n'est PAS une réfutation : `portalProof` le classera UNVERIFIABLE.
  httpStatus = 0;
  body = '';
  console.error(`${key}: lecture de la page officielle impossible — ${error instanceof Error ? error.message : String(error)}`);
}

const proof = portalProof({ requestedUrl: officialUrl, finalUrl, httpStatus, body, officialDomain, mustContain });

mkdirSync(outDir, { recursive: true });
// L'archive elle-même, nommée par son hachage : deux dossiers qui citent le même sha pointent le même contenu.
if (proof.sha256) writeFileSync(join(outDir, `${proof.sha256}.txt`), body);

const draftSpec = proof.verdict === 'PROVEN' ? {
  key: source.key, maison: source.maison, kind: source.kind, tier: source.tier, config,
  careersDomain: source.careersDomain, officialDomain,
  proofUrl: officialUrl, proofSha: proof.sha256, mustContain,
  portalUrl: `https://${source.careersDomain ?? officialDomain}`, portalScope: scope,
  statement: `${officialDomain} (page officielle, archivée le ${proof.collectedAt.slice(0, 10)}) nomme le board configuré ${mustContain}.`,
  sector: arg('sector') ?? null,
} : null;

const record = { key, verdict: proof.verdict, reason: proof.reason, mustContain, officialDomain, proof, draftSpec };

/**
 * Un dossier PROUVÉ ne se perd pas parce qu'une tentative ultérieure a échoué.
 *
 * Défaut mesuré sur `rituals` : une seconde URL rendant 404 a écrasé le dossier de la première, avec un
 * `sha256: null` — l'archive survivait (nommée par son hachage) mais le dossier qui la citait avait disparu.
 * Une tentative qui échoue ne doit jamais détruire une preuve acquise.
 */
const recordPath = join(outDir, `${key}.proof.json`);
const previous = existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, 'utf8')) : null;
if (previous?.verdict === 'PROVEN' && proof.verdict !== 'PROVEN') {
  writeFileSync(join(outDir, `${key}.attempt-${proof.collectedAt.replace(/[:.]/g, '')}.json`), JSON.stringify(record, null, 2));
  console.error(`${key}: tentative ${proof.verdict} conservée à part — le dossier PROUVÉ existant n'est pas écrasé`);
} else {
  writeFileSync(recordPath, JSON.stringify(record, null, 2));
}
console.log(JSON.stringify({ key, verdict: proof.verdict, reason: proof.reason, sha256: proof.sha256, mustContain }, null, 1));

await prisma.$disconnect();
// Fail-closed : seul PROVEN sort en 0. Une chaîne appelante s'arrête sur tout le reste.
process.exit(proof.verdict === 'PROVEN' ? 0 : 1);
