import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pLimit from 'p-limit';
import { fetchText } from '../lib/http.js';
import { namesMatch, domainMatches } from './gateDiscovered.js';

/**
 * C-04 — score d'identité pour les lignes en revue manuelle.
 *
 * Ces lignes ont échoué au gate (nom du board ≠ maison, pas d'ancrage domaine).
 * Le signal qui tranche sans humain : LE SITE OFFICIEL DE LA MAISON pointe-t-il
 * vers ce board ? Une maison qui met « boards.greenhouse.io/x » ou
 * « career.maison.com » dans son propre site revendique le board — c'est une
 * preuve d'identité plus forte que n'importe quelle similarité de nom.
 *
 * Signaux, pondérés :
 *   +0.5  le site officiel référence le localisateur du board (l'ancre)
 *   +0.3  le domaine des offres partage le domaine de la marque (CNAME career.*)
 *   +0.2  le nom du board matche la maison (tolérant, cf. gate)
 *   -1.0  board démo/sandbox (raison du gate)
 * Verdict : ≥ 0.5 AUTO-VALIDÉ · ≤ 0 AUTO-REJETÉ · entre les deux, reste humain.
 * (Le logo, prévu au registre, est pesé 0 : sans référentiel de logos fiable,
 * le comparer inventerait de la confiance — décision par délégation.)
 */

const dataUrl = (name: string) => fileURLToPath(new URL(`../../data/${name}`, import.meta.url));

type ManualRow = {
  maison: string;
  kind: string;
  config: Record<string, unknown>;
  boardName: string;
  jobs: number;
  sampleUrl: string;
  reason: string;
};

function loadManual(path: string): ManualRow[] {
  const lines = readFileSync(path, 'utf8').trim().split('\n').slice(1);
  return lines.map((line) => {
    const [maison, kind, configJson, boardName, jobs, , sampleUrl, reason] = line.split('\t');
    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(configJson || '{}');
    } catch {
      config = {};
    }
    return { maison, kind, config, boardName: boardName ?? '', jobs: Number(jobs) || 0, sampleUrl: sampleUrl ?? '', reason: reason ?? '' };
  });
}

/** nom (roster monde) -> site officiel. */
function loadRoster(): Map<string, string> {
  const map = new Map<string, string>();
  for (const raw of readFileSync(dataUrl('maisons_monde_input.csv'), 'utf8').split(/\r?\n/).slice(1)) {
    const comma = raw.indexOf(',');
    if (comma === -1) continue;
    const name = raw.slice(0, comma).replace(/^"|"$/g, '').trim().toLowerCase();
    const site = raw.slice(comma + 1).replace(/^"|"$/g, '').trim();
    if (name && site) map.set(name, site);
  }
  return map;
}

/** Le localisateur textuel qu'un site officiel citerait pour CE board. */
export function boardLocators(kind: string, config: Record<string, unknown>): string[] {
  const found: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.length >= 3) found.push(value.toLowerCase());
  };
  switch (kind) {
    case 'greenhouse': add(`greenhouse.io/${config.board}`); add(`boards.greenhouse.io/${config.board}`); break;
    case 'lever': case 'lever-eu': add(`jobs.lever.co/${config.site}`); break;
    case 'smartrecruiters-whitelabel': add(`smartrecruiters.com/${config.company}`); break;
    case 'teamtailor': add(String(config.origin ?? '').replace(/^https?:\/\//, '')); break;
    case 'recruitee': add(`${config.subdomain}.recruitee.com`); break;
    case 'personio': add(String(config.host ?? `${config.subdomain}.jobs.personio.de`)); break;
    case 'workable': add(`apply.workable.com/${config.account}`); break;
    case 'wttj': add(`welcometothejungle.com/fr/companies/${config.slug}`); add(`welcometothejungle.com/en/companies/${config.slug}`); break;
    default: add(String(config.origin ?? '').replace(/^https?:\/\//, ''));
  }
  return found.filter((v) => !v.endsWith('/undefined') && !v.includes('undefined'));
}

/** Domaine enregistrable approx. (2 derniers labels; assez pour comparer marque/board). */
function rootDomain(host: string): string {
  const labels = host.toLowerCase().replace(/^www\./, '').split('.');
  return labels.slice(-2).join('.');
}

export type ScoredRow = ManualRow & {
  score: number;
  signals: string;
  verdict: 'AUTO-VALIDE' | 'AUTO-REJETE' | 'HUMAIN';
};

export async function scoreRow(row: ManualRow, officialSite: string | undefined): Promise<ScoredRow> {
  let score = 0;
  const signals: string[] = [];

  if (/demo|sandbox/i.test(row.reason)) {
    score -= 1;
    signals.push('démo(-1)');
  }

  if (row.boardName && namesMatch(row.maison, row.boardName)) {
    score += 0.2;
    signals.push('nom(+0.2)');
  }

  // CNAME/host des offres sur le domaine de la marque.
  try {
    const sampleHost = row.sampleUrl ? new URL(row.sampleUrl).hostname : '';
    if (sampleHost && officialSite) {
      const brandRoot = rootDomain(new URL(officialSite).hostname);
      if (rootDomain(sampleHost) === brandRoot || domainMatches(row.maison, sampleHost)) {
        score += 0.3;
        signals.push('domaine(+0.3)');
      }
    }
  } catch {
    /* URL invalide: pas de signal */
  }

  // L'ancre : le site officiel référence le board.
  if (officialSite) {
    const locators = boardLocators(row.kind, row.config);
    if (locators.length > 0) {
      try {
        const html = (await fetchText(officialSite, {
          headers: {
            'user-agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          },
        })).toLowerCase();
        if (locators.some((locator) => html.includes(locator))) {
          score += 0.5;
          signals.push('ancre-site(+0.5)');
        }
      } catch {
        signals.push('site-injoignable(0)');
      }
    }
  } else {
    signals.push('site-inconnu(0)');
  }

  // Un rejet exige que la preuve ait été COLLECTABLE : si le site officiel n'a
  // pas pu être lu (bot-wall, timeout) et qu'aucun signal négatif n'existe,
  // l'absence de preuve n'est pas une preuve — la ligne reste humaine.
  const evidenceMissing = signals.some((s) => s.startsWith('site-injoignable') || s.startsWith('site-inconnu'));
  const verdict =
    score >= 0.5
      ? 'AUTO-VALIDE'
      : score <= 0 && !(evidenceMissing && score === 0)
        ? 'AUTO-REJETE'
        : 'HUMAIN';
  return { ...row, score: Math.round(score * 100) / 100, signals: signals.join(' '), verdict };
}

async function main(): Promise<void> {
  const { configureExternalDnsFromEnv } = await import('../lib/externalDns.js');
  configureExternalDnsFromEnv();

  const rows = loadManual(dataUrl('sources.manual-review.tsv'));
  const roster = loadRoster();
  console.log(`scoring ${rows.length} lignes de revue manuelle…`);

  const limit = pLimit(Number(process.env.SCORE_CONCURRENCY ?? 6));
  let done = 0;
  const scored = await Promise.all(
    rows.map((row) =>
      limit(async () => {
        const site = roster.get(row.maison.toLowerCase());
        const result = await scoreRow(row, site);
        done++;
        if (done % 100 === 0) console.log(`[${done}/${rows.length}]`);
        return result;
      }),
    ),
  );

  const clean = (v: string) => v.replace(/[\t\n\r]+/g, ' ');
  writeFileSync(
    dataUrl('manual-review.scored.tsv'),
    'maison\tkind\tscore\tverdict\tsignals\tboard_name\tjobs\tsample_url\treason\n' +
      scored
        .sort((a, b) => b.score - a.score)
        .map((r) => [clean(r.maison), r.kind, r.score, r.verdict, r.signals, clean(r.boardName), r.jobs, clean(r.sampleUrl), clean(r.reason)].join('\t'))
        .join('\n') + '\n',
  );

  const counts = { 'AUTO-VALIDE': 0, 'AUTO-REJETE': 0, HUMAIN: 0 } as Record<string, number>;
  for (const r of scored) counts[r.verdict]++;
  const auto = counts['AUTO-VALIDE'] + counts['AUTO-REJETE'];
  console.log(JSON.stringify({ ...counts, autoResolues: auto, part: `${Math.round((auto / scored.length) * 100)}%` }, null, 1));
  console.log('rapport -> data/manual-review.scored.tsv');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
