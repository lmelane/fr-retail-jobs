import type { AtsType } from '@prisma/client';

/**
 * Tech-scan discovery — the technographics approach (the piece that complements
 * API-first, Loïc 2026-09-03).
 *
 * A brand's careers subdomain almost always CNAMEs straight to its ATS provider:
 *   careers.lacoste.com    -> external-career.digitalrecruiters.com
 *   careers.elcompanies.com -> elcompanies.eightfold.ai
 *   jobs.sephora.com        -> sephora.jobs2web.com   (SuccessFactors/SAP)
 * So resolving the CNAME tells us WHICH ATS a domain uses WITHOUT loading its
 * (possibly bot-blocked) page and without blind-probing every ATS — it is pure
 * DNS. We resolve over DNS-over-HTTPS (Cloudflare) so it works everywhere with no
 * `dig` dependency and follows the CNAME chain reliably.
 */

const DOH_URL = 'https://cloudflare-dns.com/dns-query';
const DOH_TIMEOUT_MS = Number(process.env.DOH_TIMEOUT_MS ?? 4_000);

/** CNAME target substring -> the ATS it identifies. Order: most specific first. */
const CNAME_FINGERPRINTS: ReadonlyArray<readonly [RegExp, AtsType]> = [
  [/digitalrecruiters\.com/i, 'DIGITALRECRUITERS'],
  [/eightfold\.ai/i, 'EIGHTFOLD'],
  [/jobs2web\.com|successfactors\.com|sapsf\.(com|eu)/i, 'SUCCESSFACTORS'],
  [/myworkdayjobs\.com|workday\.com/i, 'WORKDAY'],
  [/teamtailor\.com/i, 'TEAMTAILOR'],
  [/smartrecruiters\.com/i, 'SMARTRECRUITERS'],
  [/greenhouse\.io/i, 'GREENHOUSE'],
  [/lever\.co/i, 'LEVER'],
  [/recruitee\.com/i, 'RECRUITEE'],
  [/personio\.(de|com)/i, 'PERSONIO'],
  [/workable\.com/i, 'WORKABLE'],
  [/avature\.net/i, 'AVATURE'],
  [/phenompeople\.com|phenom\.com/i, 'PHENOM'],
  [/welcomekit\.co|welcometothejungle\.com/i, 'WTTJ'],
  [/talentsoft\.com|talent-soft\.com|cegid\.com/i, 'TALENTSOFT'],
];

type DohAnswer = { Answer?: { type: number; data: string }[] };

/** The full CNAME chain for a hostname, via DNS-over-HTTPS. Empty on any failure. */
async function resolveCnameChain(hostname: string): Promise<string[]> {
  try {
    const response = await fetch(`${DOH_URL}?name=${encodeURIComponent(hostname)}&type=CNAME`, {
      headers: { accept: 'application/dns-json' },
      signal: AbortSignal.timeout(DOH_TIMEOUT_MS),
    });
    if (!response.ok) return [];
    const body = (await response.json()) as DohAnswer;
    // type 5 = CNAME. Also chase A-record answers' names, which can carry the
    // chain when the CNAME is flattened.
    return (body.Answer ?? []).map((a) => a.data.replace(/\.$/, ''));
  } catch {
    return [];
  }
}

/** The ATS a CNAME chain points to, or null. */
function fingerprint(chain: string[]): AtsType | null {
  for (const target of chain) {
    for (const [re, ats] of CNAME_FINGERPRINTS) {
      if (re.test(target)) return ats;
    }
  }
  return null;
}

export type TechScanHit = { ats: AtsType; host: string; cname: string };

/**
 * Resolve the ATS for a set of candidate careers hostnames by CNAME fingerprint.
 * Returns the first hit (host + ATS + the CNAME target that identified it), or
 * null. Pure DNS — never loads a page, never blocked.
 */
export async function techScanHostnames(hostnames: string[]): Promise<TechScanHit | null> {
  const results = await Promise.all(
    hostnames.map(async (host) => {
      const chain = await resolveCnameChain(host);
      const ats = fingerprint(chain);
      return ats ? { ats, host, cname: chain.find((c) => fingerprint([c]) === ats) ?? chain[0] ?? '' } : null;
    }),
  );
  return results.find(Boolean) ?? null;
}
