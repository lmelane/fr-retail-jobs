/**
 * D-453 §3 — audit renforcé exigé par la décision (« changement de sécurité réseau »), sous forme de suite
 * d'attaques. Chaque témoin passe par un VRAI serveur TLS local qui ne présente que sa feuille, et par le
 * même assemblage que la production (Agent undici + fabrique). La PKI de test est générée par
 * `scripts/ops/generer-pki-test-chaine-tls.sh` ; aucune de ses autorités n'est une racine de Node.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { X509Certificate } from 'node:crypto';
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createServer as createHttpsServer } from 'node:https';
import type { AddressInfo, LookupFunction } from 'node:net';
import tls from 'node:tls';
import { Agent, request } from 'undici';
import { publicLookup } from './publicTransport.js';
import {
  CHAIN_COMPLETION_HOSTS, ISSUER_TTL_MS, LEAF_ONLY, REFUSAL_RETRY_MS, caIssuersUrl, chainCompletingConnector,
  chainCompletingFactory, issuerFetcher, readRejectedLeaf, verifiedIssuer,
  type ChainCompleted, type ChainCompletionOptions, type ChainRefused,
} from './tlsChainCompletion.js';

const FIXTURES = new URL('./__fixtures__/tls-chain/', import.meta.url);
const pem = (name: string) => readFileSync(new URL(`${name}.pem`, FIXTURES), 'utf8');
const der = (name: string) => readFileSync(new URL(`${name}.der`, FIXTURES));
const cert = (name: string) => new X509Certificate(pem(name));
const ROOTS = [pem('root')];
const HOST = 'careers.test';
const NOW = Date.parse('2026-09-30T12:00:00Z');
/** Tout nom vers 127.0.0.1 : la garde DNS publique est éprouvée à part, avec `publicLookup`. */
const loopback: LookupFunction = (_host, options, callback) => options.all
  ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4);
const BASE = { lookup: loopback, timeout: 5_000 };
/** Ce que l'AIA de chaque feuille de test désigne, servi comme le ferait l'hôte de l'autorité. */
const AIA: Record<string, Buffer> = {
  'http://aia.test/inter.crt': der('inter'),
  'http://aia.test/rogue-inter.crt': Buffer.from(pem('rogue-inter')),
  'http://aia.test/attacker-ca.crt': Buffer.from(pem('attacker-ca')),
  'http://aia.test/not-ca.crt': Buffer.from(pem('not-ca')),
  'http://aia.test/no-certsign.crt': Buffer.from(pem('no-certsign')),
  'http://aia.test/expired-inter.crt': Buffer.from(pem('expired-inter')),
};
const codeOf = (error: unknown): string | undefined => {
  const e = error as { code?: string; cause?: { code?: string } } | undefined;
  return e?.code ?? e?.cause?.code;
};

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()!(); });

/** Un serveur HTTPS qui ne présente que `leaves[i]` à sa i-ème poignée de main (la dernière ensuite). */
async function serve(...leaves: string[]) {
  const key = readFileSync(new URL('leaf.key', FIXTURES));
  const contexts = leaves.map(leaf => tls.createSecureContext({ key, cert: pem(leaf) }));
  let handshakes = 0;
  let connections = 0;
  let requests = 0;
  const server = createHttpsServer({ key, cert: pem(leaves[0]),
    SNICallback: (_name, done) => done(null, contexts[Math.min(handshakes++, contexts.length - 1)]) },
  (_req, res) => { requests++; res.end('ok'); });
  // Les connexions TCP, pas les rappels SNI : une session TLS reprise ne repasse pas par SNICallback.
  server.on('connection', () => { connections++; });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
  return { port: (server.address() as AddressInfo).port, connections: () => connections, requests: () => requests };
}

/** Le même assemblage que `publicTransport.ts`, avec la PKI de test et une horloge fixe. */
function harness(options: ChainCompletionOptions & { served?: Record<string, Buffer>; clock?: { now: number } } = {}) {
  const fetched: string[] = [];
  const completed: ChainCompleted[] = [];
  const refused: ChainRefused[] = [];
  const clock = options.clock ?? { now: NOW };
  const settings: ChainCompletionOptions = {
    hosts: new Set([HOST]), roots: ROOTS, now: () => clock.now,
    fetchIssuer: async url => {
      fetched.push(url);
      const bytes = options.served?.[url] ?? AIA[url];
      if (!bytes) throw new Error(`no fixture for ${url}`);
      return bytes;
    },
    onCompleted: event => { completed.push(event); }, onRefused: event => { refused.push(event); },
    ...options,
  };
  const agent = new Agent({ connect: BASE, factory: chainCompletingFactory(BASE, settings) });
  cleanups.push(() => agent.destroy());
  const get = async (port: number, host = HOST) => {
    try {
      const response = await request(`https://${host}:${port}/`, { dispatcher: agent, reset: true });
      return { body: await response.body.text() };
    } catch (error) { return { code: codeOf(error) }; }
  };
  return { get, fetched, completed, refused, clock };
}

/** Une poignée de main directe, pour établir les prémisses sur OpenSSL lui-même. */
function handshake(port: number, ca: string[]): Promise<string> {
  return new Promise(resolve => {
    const socket = tls.connect({ host: HOST, port, servername: HOST, lookup: loopback, ca });
    socket.once('secureConnect', () => { socket.destroy(); resolve('OK'); });
    socket.once('error', (error: NodeJS.ErrnoException) => { socket.destroy(); resolve(error.code ?? error.message); });
  });
}

describe('prémisses mesurées sur OpenSSL — ce sur quoi la conception repose', () => {
  it('le serveur de test ne présente que sa feuille : la connexion normale échoue comme Ralph Lauren', async () => {
    const { port } = await serve('leaf');
    expect(await handshake(port, ROOTS)).toBe(LEAF_ONLY);
    expect(await handshake(port, [...ROOTS, pem('inter')])).toBe('OK');
  });
  it('un intermédiaire seul dans `ca` n’est PAS une ancre : la chaîne doit finir sur une racine', async () => {
    const { port } = await serve('leaf');
    expect(await handshake(port, [pem('inter')])).toBe('UNABLE_TO_GET_ISSUER_CERT');
  });
  it('une AC auto-signée dans `ca` DEVIENT une ancre : sans nos contrôles, l’attaquant passerait', async () => {
    const { port } = await serve('leaf-attacker');
    expect(await handshake(port, [...ROOTS, pem('attacker-ca')])).toBe('OK');
  });
  it('la feuille d’une poignée de main refusée se lit avant le verdict, vérification active', async () => {
    const { port } = await serve('leaf');
    expect((await readRejectedLeaf(HOST, port, BASE, ROOTS))?.fingerprint256).toBe(cert('leaf').fingerprint256);
    // Une chaîne acceptée n'est pas notre cas : rien à compléter.
    expect(await readRejectedLeaf(HOST, port, BASE, [...ROOTS, pem('inter')])).toBeNull();
  });
});

describe('la chaîne incomplète est complétée comme un navigateur', () => {
  it('télécharge l’intermédiaire désigné par l’AIA, le vérifie, et la requête aboutit', async () => {
    const { port } = await serve('leaf');
    const h = harness();
    expect(await h.get(port)).toEqual({ body: 'ok' });
    expect(h.fetched).toEqual(['http://aia.test/inter.crt']);
    expect(h.completed).toEqual([expect.objectContaining({ host: HOST, fingerprint256: cert('inter').fingerprint256 })]);
    expect(h.refused).toEqual([]);
  });
  it('lit aussi un intermédiaire servi en PEM', async () => {
    const { port } = await serve('leaf');
    const h = harness({ served: { 'http://aia.test/inter.crt': Buffer.from(pem('inter')) } });
    expect(await h.get(port)).toEqual({ body: 'ok' });
  });
  it('une connexion suivante réutilise la complétion : ni sonde ni téléchargement', async () => {
    const server = await serve('leaf');
    const h = harness();
    expect(await h.get(server.port)).toEqual({ body: 'ok' });
    // Première connexion : l'essai normal refusé, la sonde, le rejeu vérifié — et UNE requête HTTP :
    // ni l'essai refusé ni la sonde n'ont envoyé un octet applicatif.
    expect(server.connections()).toBe(3);
    expect(server.requests()).toBe(1);
    expect(await h.get(server.port)).toEqual({ body: 'ok' });
    expect(server.connections()).toBe(4);
    expect(server.requests()).toBe(2);
    expect(h.fetched).toHaveLength(1);
  });
  it('au-delà du TTL, l’intermédiaire est téléchargé à nouveau', async () => {
    const { port } = await serve('leaf');
    const h = harness();
    expect(await h.get(port)).toEqual({ body: 'ok' });
    h.clock.now += ISSUER_TTL_MS + 1;
    expect(await h.get(port)).toEqual({ body: 'ok' });
    expect(h.fetched).toHaveLength(2);
  });
  it('le rejeu revérifie TOUT : une feuille changée après la sonde est refusée (nom d’hôte)', async () => {
    // Essai normal et sonde voient la bonne feuille ; le rejeu en reçoit une au mauvais nom, même émetteur.
    const { port } = await serve('leaf', 'leaf', 'leaf-wrong-host');
    const h = harness();
    expect(await h.get(port)).toEqual({ code: 'ERR_TLS_CERT_ALTNAME_INVALID' });
  });
  it('une feuille renouvelée par un autre émetteur n’hérite pas de l’ancienne complétion', async () => {
    const h = harness();
    expect(await h.get((await serve('leaf')).port)).toEqual({ body: 'ok' });
    const renewed = await serve('leaf-rogue');
    expect(await h.get(renewed.port)).toEqual({ code: LEAF_ONLY });
    expect(await h.get(renewed.port)).toEqual({ code: LEAF_ONLY });
    expect(h.refused).toEqual([{ host: HOST, reason: 'issuer: not signed by a trusted root' }]);
  });
});

describe('attaques — l’intermédiaire servi par l’AIA est refusé, la source échoue comme avant', () => {
  const attacks: [string, string, string, Record<string, Buffer>?][] = [
    ['AC auto-signée (deviendrait une ancre)', 'leaf-attacker', 'issuer: self-issued or self-signed, it would become a trust anchor'],
    ['certificat qui n’est pas une AC', 'leaf-not-ca', 'issuer: not a CA (basicConstraints CA:TRUE, keyCertSign when keyUsage is present)'],
    ['AC sans keyCertSign', 'leaf-no-certsign', 'issuer: not a CA (basicConstraints CA:TRUE, keyCertSign when keyUsage is present)'],
    ['intermédiaire au même nom qui n’a pas signé la feuille', 'leaf', 'issuer: did not sign the leaf', { 'http://aia.test/inter.crt': Buffer.from(pem('impostor')) }],
    ['intermédiaire expiré', 'leaf-expired-inter', 'issuer: outside its validity period'],
    ['intermédiaire chaîné à une racine non reconnue', 'leaf-rogue', 'issuer: not signed by a trusted root'],
    ['plusieurs certificats servis d’un coup', 'leaf', 'issuer: not exactly one PEM block', { 'http://aia.test/inter.crt': Buffer.from(pem('inter') + pem('root')) }],
    ['corps qui n’est pas un certificat', 'leaf', 'issuer: not a DER or PEM certificate', { 'http://aia.test/inter.crt': Buffer.from('<html>moved</html>') }],
  ];
  it.each(attacks)('%s', async (_label, leaf, reason, served) => {
    const { port } = await serve(leaf);
    const h = harness({ served });
    expect(await h.get(port)).toEqual({ code: LEAF_ONLY });
    expect(h.refused).toEqual([{ host: HOST, reason }]);
    expect(h.completed).toEqual([]);
  });
  it.each([
    ['feuille au mauvais nom d’hôte', 'leaf-wrong-host', 'leaf: does not name the host'],
    ['feuille sans AIA', 'leaf-no-aia', 'leaf: no http(s) CA Issuers URI'],
    ['AIA hors http(s) (ldap)', 'leaf-aia-ldap', 'leaf: no http(s) CA Issuers URI'],
  ])('%s : refusé AVANT tout téléchargement', async (_label, leaf, reason) => {
    const { port } = await serve(leaf);
    const h = harness();
    expect(await h.get(port)).toEqual({ code: LEAF_ONLY });
    expect(h.refused).toEqual([{ host: HOST, reason }]);
    expect(h.fetched).toEqual([]);
  });
  it('après un refus, l’hôte échoue comme avant sans nouveau téléchargement, puis réessaie', async () => {
    const { port } = await serve('leaf-rogue');
    const h = harness();
    expect(await h.get(port)).toEqual({ code: LEAF_ONLY });
    expect(await h.get(port)).toEqual({ code: LEAF_ONLY });
    expect(h.fetched).toHaveLength(1);
    h.clock.now += REFUSAL_RETRY_MS + 1;
    expect(await h.get(port)).toEqual({ code: LEAF_ONLY });
    expect(h.fetched).toHaveLength(2);
  });
});

describe('périmètre — rien ne change hors de la décision', () => {
  it('la production ne nomme que l’hôte de Ralph Lauren', () => {
    expect([...CHAIN_COMPLETION_HOSTS]).toEqual(['careers.ralphlauren.com']);
  });
  it('un hôte absent de la liste échoue exactement comme avant, sans téléchargement', async () => {
    const { port } = await serve('leaf');
    const h = harness();
    expect(await h.get(port, 'unlisted.test')).toEqual({ code: LEAF_ONLY });
    expect(h.fetched).toEqual([]);
    expect(h.refused).toEqual([]);
  });
  it('une autre erreur TLS n’est jamais complétée (feuille auto-signée)', async () => {
    const { port } = await serve('leaf-self-signed');
    const h = harness();
    expect(await h.get(port)).toEqual({ code: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
    expect(h.fetched).toEqual([]);
    expect(h.refused).toEqual([]);
  });
  it('le connecteur seul applique aussi la liste (défense si la fabrique changeait)', async () => {
    const { port } = await serve('leaf');
    const fetched: string[] = [];
    const connect = chainCompletingConnector(BASE, { hosts: new Set([HOST]), roots: ROOTS, fetchIssuer: async url => { fetched.push(url); return der('inter'); } });
    const code = await new Promise<string | undefined>(resolve => connect({ protocol: 'https:', hostname: 'unlisted.test', port: String(port) },
      (error, socket) => { socket?.destroy(); resolve(codeOf(error)); }));
    expect(code).toBe(LEAF_ONLY);
    expect(fetched).toEqual([]);
  });
});

describe('lecture de l’AIA et contrôles unitaires', () => {
  it('ne retient que le premier URI « CA Issuers » en http(s)', () => {
    expect(caIssuersUrl(cert('leaf'))).toBe('http://aia.test/inter.crt');
    expect(caIssuersUrl(cert('leaf-aia-ldap'))).toBeNull();
    expect(caIssuersUrl(cert('leaf-no-aia'))).toBeNull();
  });
  it('accepte l’intermédiaire sain ; sans ancre, ou hors de sa validité, il est refusé', () => {
    const anchors = [cert('root')];
    expect(verifiedIssuer(cert('leaf'), der('inter'), anchors, NOW).fingerprint256).toBe(cert('inter').fingerprint256);
    expect(() => verifiedIssuer(cert('leaf'), der('inter'), anchors, Date.parse('2200-01-01'))).toThrow('outside its validity period');
    expect(() => verifiedIssuer(cert('leaf'), der('inter'), [], NOW)).toThrow('not signed by a trusted root');
  });
});

describe('téléchargement AIA — garde SSRF, bornes de taille et de temps', () => {
  type Handler = (req: IncomingMessage, res: ServerResponse) => void;
  async function aiaServer(handler: Handler) {
    let requests = 0;
    const server = createHttpServer((req, res) => { requests++; handler(req, res); });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    cleanups.push(() => { server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); });
    return { url: (path: string) => `http://aia.test:${(server.address() as AddressInfo).port}${path}`,
      port: (server.address() as AddressInfo).port, requests: () => requests };
  }
  const fetcher = (limits = { maxBytes: 4_096, timeoutMs: 400 }) => issuerFetcher(BASE, limits);

  it('rend les octets d’une réponse 200 bornée', async () => {
    const server = await aiaServer((_req, res) => res.end(der('inter')));
    expect(await fetcher()(server.url('/inter.crt'))).toEqual(der('inter'));
  });
  it.each(['http://169.254.169.254/latest/meta-data/', 'http://127.0.0.1/inter.crt', 'http://localhost/inter.crt',
    'http://[::1]/inter.crt', 'http://metadata.google.internal/', 'ldap://aia.test/cn=inter', 'file:///etc/passwd',
    'http://user:pass@aia.test/inter.crt'])('refuse %s avant toute connexion', async url => {
    const opened: string[] = [];
    const spy: LookupFunction = (host, options, callback) => { opened.push(host); loopback(host, options, callback); };
    await expect(issuerFetcher({ lookup: spy, timeout: 1_000 })(url)).rejects.toThrow('Refusing to fetch non-public or non-HTTP URL');
    expect(opened).toEqual([]);
  });
  it('refuse un nom qui résout vers une adresse privée (DNS épinglé, pas de seconde résolution)', async () => {
    const server = await aiaServer((_req, res) => res.end(der('inter')));
    const privateDns = publicLookup((_host, options, callback) => options.all
      ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4));
    await expect(issuerFetcher({ lookup: privateDns, timeout: 1_000 })(server.url('/inter.crt'))).rejects.toThrow('DNS:aia.test');
    expect(server.requests()).toBe(0);
  });
  it('refuse une taille annoncée trop grande', async () => {
    const server = await aiaServer((_req, res) => { res.setHeader('content-length', '100000'); res.end(Buffer.alloc(100_000)); });
    await expect(fetcher()(server.url('/big'))).rejects.toThrow('issuer: over 4096 bytes');
  });
  it('coupe un corps sans longueur qui dépasse la borne', async () => {
    let written = 0;
    const server = await aiaServer((_req, res) => {
      const push = () => { if (res.destroyed || written > 10_000_000) return res.end(); written += 1_024; res.write(Buffer.alloc(1_024), () => setImmediate(push)); };
      push();
    });
    await expect(fetcher()(server.url('/stream'))).rejects.toThrow('issuer: over 4096 bytes');
    expect(written).toBeLessThan(10_000_000);
  });
  it('abandonne un corps qui traîne au-delà du délai total', async () => {
    const server = await aiaServer((_req, res) => { res.writeHead(200); res.write('-'); });
    const started = Date.now();
    await expect(fetcher()(server.url('/slow'))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3_000);
  });
  it('abandonne un hôte qui ne répond jamais', async () => {
    const server = await aiaServer(() => undefined);
    const started = Date.now();
    await expect(fetcher()(server.url('/silent'))).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(3_000);
  });
  it('ne suit aucune redirection et refuse tout statut autre que 200', async () => {
    const server = await aiaServer((req, res) => {
      if (req.url === '/moved') { res.writeHead(302, { location: 'http://169.254.169.254/latest/meta-data/' }); return res.end(); }
      res.writeHead(404); res.end();
    });
    await expect(fetcher()(server.url('/moved'))).rejects.toThrow('issuer: HTTP 302');
    await expect(fetcher()(server.url('/missing'))).rejects.toThrow('issuer: HTTP 404');
    expect(server.requests()).toBe(2);
  });
  it.each([
    ['vise l’adresse de métadonnées', 'leaf-aia-metadata', 'BlockedUrlError: Refusing to fetch non-public or non-HTTP URL: http://169.254.169.254/'],
    ['vise un nom qui résout vers une adresse privée', 'leaf-aia-private-dns', 'DNS:aia-internal.test'],
  ])('bout en bout : une feuille dont l’AIA %s est refusée', async (_label, leaf, reason) => {
    const { port } = await serve(leaf);
    // Le serveur TLS de test est joint en boucle locale ; l'AIA, lui, passe par la garde DNS de production.
    const privateAnswer = publicLookup((_host, options, callback) => options.all
      ? callback(null, [{ address: '10.0.0.7', family: 4 }]) : callback(null, '10.0.0.7', 4));
    const h = harness({ fetchIssuer: issuerFetcher({ lookup: privateAnswer, timeout: 1_000 }) });
    expect(await h.get(port)).toEqual({ code: LEAF_ONLY });
    expect(h.refused).toEqual([{ host: HOST, reason: expect.stringContaining(reason) }]);
    expect(h.completed).toEqual([]);
  });
});
