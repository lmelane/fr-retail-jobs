import { Resolver } from 'node:dns/promises';
import { Agent, setGlobalDispatcher } from 'undici';

/**
 * Opt-in DNS bypass for bulk local runs (incident, 2026-09-03).
 *
 * A 40-concurrency sweep starved macOS's mDNSResponder, which then POISONED its
 * negative cache: thousands of live hosts — github.com included — kept failing
 * with ENOTFOUND from every getaddrinfo caller for hours, while resolving fine
 * on any external resolver. That mislabelled 5 700+ live Maisons as dead.
 *
 * When EXTERNAL_DNS_RESOLVERS is set (comma-separated IPs, e.g.
 * "1.1.1.1,8.8.8.8"), every fetch in this process resolves through those
 * servers directly, bypassing the system resolver entirely.
 *
 * STRICTLY opt-in and NEVER set in production: Railway's internal hostnames
 * (the Postgres host among them) only exist on Railway's own resolver — forcing
 * a public one there would sever the database.
 */
export function configureExternalDnsFromEnv(): boolean {
  const servers = (process.env.EXTERNAL_DNS_RESOLVERS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (servers.length === 0) return false;

  const resolver = new Resolver({ timeout: 4_000, tries: 2 });
  resolver.setServers(servers);

  const notFound = (hostname: string) =>
    Object.assign(new Error(`ENOTFOUND ${hostname}`), { code: 'ENOTFOUND', hostname });

  type LookupCallback = (
    err: NodeJS.ErrnoException | null,
    addresses?: { address: string; family: number }[],
  ) => void;

  const lookup = (hostname: string, _options: unknown, callback: LookupCallback) => {
    const answer = (addrs: string[], family: number): boolean => {
      if (!addrs.length) return false;
      callback(null, addrs.map((address) => ({ address, family })));
      return true;
    };
    resolver.resolve4(hostname).then(
      (a4) => {
        if (answer(a4, 4)) return;
        resolver.resolve6(hostname).then(
          (a6) => { if (!answer(a6, 6)) callback(notFound(hostname)); },
          () => callback(notFound(hostname)),
        );
      },
      () =>
        resolver.resolve6(hostname).then(
          (a6) => { if (!answer(a6, 6)) callback(notFound(hostname)); },
          () => callback(notFound(hostname)),
        ),
    );
  };

  // Node's built-in fetch shares undici's global dispatcher registry
  // (Symbol.for), so this rewires it too — verified live on 3 955 hosts.
  setGlobalDispatcher(new Agent({ connect: { lookup: lookup as never, timeout: 12_000 } }));
  console.log(`[dns] system resolver bypassed -> ${servers.join(', ')}`);
  return true;
}
