/**
 * D-453 §3 (arbitrage CEO du 24/09/2026, validé, non implémenté jusqu'au 30/09/2026) — « le certificat
 * manquant est complété comme le fait un navigateur (récupération de l'intermédiaire désigné par le
 * certificat, vérification complète jusqu'à une racine de confiance) ». Écartés par la même décision : la
 * pause avec incident source, et l'ajout de l'intermédiaire à notre liste de confiance.
 *
 * Mesuré le 30/09/2026 (Node 22.23.3 de l'image et 26.7.0) : careers.ralphlauren.com ne présente que sa
 * feuille, émise par « Sectigo Public Server Authentication CA OV R36 », et Node refuse la connexion
 * (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`). L'AIA de la feuille désigne
 * http://crt.sectigo.com/SectigoPublicServerAuthenticationCAOVR36.crt, qui rend cet intermédiaire (AC,
 * signé par « Sectigo Public Server Authentication Root R46 », racine livrée avec Node).
 *
 * Ce que fait ce module, SEULEMENT sur cet échec exact et pour un hôte nommé par la décision :
 *  1. relit la feuille sur une poignée de main dédiée, vérification ACTIVE, sans rien y écrire ;
 *  2. télécharge l'émetteur que désigne son AIA (« CA Issuers », http/https), sous la garde SSRF, sans
 *     redirection, borné en taille et en temps, mis en cache par URL pour ISSUER_TTL_MS ;
 *  3. ne l'accepte que s'il est une AC (CA:TRUE, keyCertSign dès que keyUsage est présent), ni auto-émise
 *     ni auto-signée, dans sa validité, signataire de la feuille, et lui-même signé par une racine de Node ;
 *  4. rejoue la connexion avec `ca = racines de Node + cet intermédiaire` et `rejectUnauthorized: true` :
 *     OpenSSL revérifie toute la chaîne, Node le nom d'hôte. Aucune vérification n'est jamais désactivée.
 * Tout refus rend l'erreur d'origine : la source échoue comme avant (`TRANSPORT_UNABLE_TO_VERIFY_LEAF_SIGNATURE`).
 *
 * Le point 3 n'est PAS redondant avec le point 4. Mesuré le 30/09/2026 sur les deux versions de Node : un
 * certificat AUTO-SIGNÉ placé dans `ca` devient une ancre, et la chaîne d'un attaquant qui sert sa propre
 * AC par l'AIA passe alors la vérification d'OpenSSL. Un intermédiaire non auto-signé, lui, n'en devient
 * pas une : Node ne pose `X509_V_FLAG_PARTIAL_CHAIN` que sur `allowPartialTrustChain`, et la chaîne doit
 * encore finir sur une racine. Les deux faits sont gardés par des témoins (tlsChainCompletion.test.ts).
 */
import tls from 'node:tls';
import { X509Certificate } from 'node:crypto';
import type { LookupFunction } from 'node:net';
import { Agent, Client, Pool, buildConnector, request, type Dispatcher } from 'undici';
import { CRAWLER_IDENTITY } from './crawlerIdentity.js';
import { assertPublicUrl } from './ssrf.js';

/**
 * D-453 §3 nomme Ralph Lauren, et lui seul. Le mécanisme est générique (aucun intermédiaire épinglé), son
 * ACTIVATION ne l'est pas : un autre hôte est une nouvelle décision, pas un réglage. La liste borne aussi
 * l'exposition : pour tout autre hôte la connexion reste celle d'undici, et un attaquant qui intercepterait
 * une autre origine ne peut pas nous faire télécharger un certificat.
 */
export const CHAIN_COMPLETION_HOSTS: ReadonlySet<string> = new Set(['careers.ralphlauren.com']);
/** Le seul échec complété : la feuille seule. Expirée, mauvais nom, auto-signée… ne sont jamais touchées. */
export const LEAF_ONLY = 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
/** R36 fait 1 616 octets en DER : 16 Kio laissent la place d'un PEM RSA-4096, pas d'un corps arbitraire. */
export const ISSUER_MAX_BYTES = 16_384;
/** Délai TOTAL du téléchargement, en-têtes et corps : un hôte AIA lent ne retient pas la connexion au-delà. */
export const ISSUER_TIMEOUT_MS = 10_000;
/** Un intermédiaire téléchargé sert au plus six heures, et jamais au-delà de sa propre validité. */
export const ISSUER_TTL_MS = 6 * 60 * 60_000;
/** Après un refus, l'hôte échoue comme avant, sans nouveau téléchargement, pendant dix minutes. */
export const REFUSAL_RETRY_MS = 10 * 60_000;

type Connector = buildConnector.connector;
type ConnectCallback = buildConnector.Callback;
type Completion = { connector: Connector | null; expiresAt: number };
export type BaseConnect = { lookup: LookupFunction; timeout: number };
export type IssuerFetcher = (url: string) => Promise<Buffer>;
export type ChainCompleted = { host: string; url: string; issuer: string; fingerprint256: string };
export type ChainRefused = { host: string; reason: string };
export type ChainCompletionOptions = {
  hosts?: ReadonlySet<string>;
  /** Ancres PEM. Production : exactement les racines livrées avec Node, celles de la connexion par défaut. */
  roots?: readonly string[];
  fetchIssuer?: IssuerFetcher;
  now?: () => number;
  onCompleted?: (event: ChainCompleted) => unknown;
  onRefused?: (event: ChainRefused) => unknown;
};

export class ChainCompletionRefused extends Error {
  constructor(message: string) { super(message); this.name = 'ChainCompletionRefused'; }
}
function refuse(message: string): never { throw new ChainCompletionRefused(message); }
const errorCode = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

/** Le premier URI « CA Issuers » http(s) de l'AIA (Node cite en JSON une valeur à caractères spéciaux). */
export function caIssuersUrl(leaf: X509Certificate): string | null {
  for (const line of (leaf.infoAccess ?? '').split('\n')) {
    const raw = line.match(/^CA Issuers - URI:(.+)$/)?.[1];
    if (!raw) continue;
    let value: unknown = raw;
    if (raw.startsWith('"')) { try { value = JSON.parse(raw); } catch { continue; } }
    if (typeof value === 'string' && /^https?:\/\//i.test(value)) return value;
  }
  return null;
}

function withinValidity(certificate: X509Certificate, now: number): boolean {
  const from = Date.parse(certificate.validFrom);
  const to = Date.parse(certificate.validTo);
  return Number.isFinite(from) && Number.isFinite(to) && from <= now && now <= to;
}

/** N'accepte le certificat téléchargé que comme intermédiaire NON fiable dont une racine de Node répond. */
export function verifiedIssuer(leaf: X509Certificate, bytes: Buffer, anchors: readonly X509Certificate[], now: number): X509Certificate {
  const text = bytes.toString('latin1');
  if (text.includes('-----BEGIN') && text.split('-----BEGIN').length !== 2) refuse('issuer: not exactly one PEM block');
  let issuer: X509Certificate;
  try { issuer = new X509Certificate(bytes); } catch { return refuse('issuer: not a DER or PEM certificate'); }
  // `ca` = X509_check_ca(...) === 1 : CA:TRUE, et keyCertSign dès que keyUsage est présent (mesuré le 30/09).
  if (!issuer.ca) refuse('issuer: not a CA (basicConstraints CA:TRUE, keyCertSign when keyUsage is present)');
  if (issuer.checkIssued(issuer) || issuer.verify(issuer.publicKey)) refuse('issuer: self-issued or self-signed, it would become a trust anchor');
  if (!withinValidity(issuer, now)) refuse('issuer: outside its validity period');
  if (!leaf.checkIssued(issuer) || !leaf.verify(issuer.publicKey)) refuse('issuer: did not sign the leaf');
  if (!anchors.some(root => withinValidity(root, now) && issuer.checkIssued(root) && issuer.verify(root.publicKey))) {
    refuse('issuer: not signed by a trusted root');
  }
  return issuer;
}

/**
 * La feuille d'une poignée de main que Node REFUSE, lue juste avant son verdict — `rejectUnauthorized` reste
 * vrai et rien n'est écrit sur ce socket. `secure` précède le verdict de Node (`onConnectSecure`), vérifié le
 * 30/09/2026 sur 22.23.3 et 26.7.0. Lecture par `getPeerCertificate().raw` : sur ces deux versions,
 * `getPeerX509Certificate()` appelé à cet instant fait échouer la vérification du nom d'hôte de Node qui suit.
 * Si une version future déplace l'événement, la feuille reste nulle et la complétion échoue fermée.
 */
export function readRejectedLeaf(host: string, port: number, base: BaseConnect, ca?: readonly string[]): Promise<X509Certificate | null> {
  return new Promise(resolve => {
    let leaf: X509Certificate | null = null;
    let settled = false;
    const socket = tls.connect({ host, port, servername: host, lookup: base.lookup, timeout: base.timeout,
      ALPNProtocols: ['http/1.1'], rejectUnauthorized: true, ...(ca ? { ca: [...ca] } : {}) });
    socket.prependListener('secure', () => {
      const raw = socket.getPeerCertificate()?.raw;
      try { leaf = raw ? new X509Certificate(raw) : null; } catch { leaf = null; }
    });
    const done = (value: X509Certificate | null) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    // Acceptée, la connexion n'a rien à compléter ; refusée pour une autre raison, elle n'est pas notre cas.
    socket.once('secureConnect', () => done(null));
    socket.once('error', (error: NodeJS.ErrnoException) => done(error.code === LEAF_ONLY ? leaf : null));
    socket.once('timeout', () => done(null));
    socket.once('close', () => done(null));
  });
}

/** Téléchargement AIA : garde SSRF, DNS public épinglé, aucune redirection, taille et durée bornées. */
export function issuerFetcher(base: BaseConnect, limits = { maxBytes: ISSUER_MAX_BYTES, timeoutMs: ISSUER_TIMEOUT_MS }): IssuerFetcher {
  // Agent dédié : même résolution publique que les sources, sans complétion (aucune récursion possible).
  const dispatcher = new Agent({ connect: { lookup: base.lookup, timeout: base.timeout } });
  return async url => {
    assertPublicUrl(url);
    const { statusCode, headers, body } = await request(url, {
      dispatcher, method: 'GET', signal: AbortSignal.timeout(limits.timeoutMs),
      headers: { 'user-agent': CRAWLER_IDENTITY, accept: 'application/pkix-cert, application/x-x509-ca-cert;q=0.9, */*;q=0.1' },
    });
    try {
      // undici `request` ne suit aucune redirection : un 3xx est un refus, jamais un second saut.
      if (statusCode !== 200) refuse(`issuer: HTTP ${statusCode}`);
      const declared = Number(headers['content-length']);
      if (Number.isFinite(declared) && declared > limits.maxBytes) refuse(`issuer: over ${limits.maxBytes} bytes`);
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of body) {
        size += (chunk as Buffer).byteLength;
        if (size > limits.maxBytes) refuse(`issuer: over ${limits.maxBytes} bytes`);
        chunks.push(chunk as Buffer);
      }
      return Buffer.concat(chunks);
    } finally {
      // Un corps détruit avant sa fin émet une AbortError d'undici : sans écouteur, elle tuerait le worker
      // (mesuré le 30/09/2026 par les témoins du 302 et du corps trop long). Le refus est déjà levé plus haut.
      body.on('error', () => undefined);
      body.destroy();
    }
  };
}

/** Un observateur (le journal) ne change jamais l'issue TLS. */
async function observe<T>(hook: ((event: T) => unknown) | undefined, event: T): Promise<void> {
  // Un journal indisponible rend son propre échec persistant (ObservabilityUnavailableError) et arrête le
  // worker à son prochain contrôle : l'avaler ICI ne le masque pas, et ne transforme pas une chaîne vérifiée
  // en refus — ni l'inverse.
  try { await hook?.(event); } catch { /* voir ci-dessus */ }
}

const refusalReason = (reason: unknown) => reason instanceof ChainCompletionRefused ? reason.message
  : reason instanceof Error ? `${reason.name}: ${reason.message}${errorCode(reason.cause) ? ` [${errorCode(reason.cause)}]` : ''}` : String(reason);

/** Le connecteur des hôtes de la décision : la connexion d'undici, plus D-453 §3 sur l'échec « feuille seule ». */
export function chainCompletingConnector(base: BaseConnect, options: ChainCompletionOptions = {}): Connector {
  const hosts = options.hosts ?? CHAIN_COMPLETION_HOSTS;
  const rootPems = [...(options.roots ?? tls.rootCertificates)];
  const anchors = rootPems.map(pem => new X509Certificate(pem));
  const fetchIssuer = options.fetchIssuer ?? issuerFetcher(base);
  const now = options.now ?? Date.now;
  const probeRoots = options.roots ? rootPems : undefined;
  // Même connexion qu'avant la décision ; `ca` n'est posé que lorsque des ancres sont imposées (témoins).
  const plain = buildConnector({ ...base, ...(probeRoots ? { ca: probeRoots } : {}) });
  const issuers = new Map<string, { bytes: Buffer; expiresAt: number }>(); // par URL AIA
  const completions = new Map<string, Promise<Completion>>(); // par hôte : en cours, complétée ou refusée

  async function complete(host: string, port: number): Promise<Completion> {
    try {
      const leaf = await readRejectedLeaf(host, port, base, probeRoots);
      if (!leaf) refuse('leaf: not readable from a handshake rejected for the same reason');
      if (!leaf.checkHost(host)) refuse('leaf: does not name the host');
      const url = caIssuersUrl(leaf) ?? refuse('leaf: no http(s) CA Issuers URI');
      const cached = issuers.get(url);
      const fresh = cached && cached.expiresAt > now() ? cached : undefined;
      const bytes = fresh?.bytes ?? await fetchIssuer(url);
      // Revérifié pour CETTE feuille même quand l'octet vient du cache : le cache évite un téléchargement, pas un contrôle.
      const issuer = verifiedIssuer(leaf, bytes, anchors, now());
      const expiresAt = fresh?.expiresAt ?? Math.min(now() + ISSUER_TTL_MS, Date.parse(issuer.validTo));
      if (!fresh) issuers.set(url, { bytes, expiresAt });
      await observe(options.onCompleted, { host, url, issuer: issuer.subject.replace(/\n/g, ', '), fingerprint256: issuer.fingerprint256 });
      return { connector: buildConnector({ ...base, ca: [...rootPems, issuer.toString()], rejectUnauthorized: true }), expiresAt };
    } catch (reason) {
      await observe(options.onRefused, { host, reason: refusalReason(reason) });
      return { connector: null, expiresAt: now() + REFUSAL_RETRY_MS };
    }
  }

  const connect: Connector = (opts, reply) => {
    const host = opts.hostname;
    if (opts.protocol !== 'https:' || !hosts.has(host)) return plain(opts, reply);
    // Les suites différées ci-dessous rendent la main à undici UNE fois, et même si un connecteur lève :
    // sans cela, une exception dans un `.then` laisserait la connexion pendante et le rejet sans gestionnaire.
    let answered = false;
    const callback: ConnectCallback = (...args) => { if (!answered) { answered = true; reply(...args); } };
    const fail = (error: unknown) => callback(error instanceof Error ? error : new Error(String(error)), null);
    const known = completions.get(host);
    if (known) {
      void known.then(completion => {
        if (completion.expiresAt <= now()) {
          if (completions.get(host) === known) completions.delete(host);
          return connect(opts, callback);
        }
        // Refus récent : la connexion se passe exactement comme avant la décision, sans nouveau téléchargement.
        if (!completion.connector) return plain(opts, callback);
        completion.connector(opts, (...args: Parameters<ConnectCallback>) => {
          // Feuille renouvelée par un autre émetteur : cette complétion ne vaut plus, la suivante la refait.
          if (errorCode(args[0]) === LEAF_ONLY && completions.get(host) === known) completions.delete(host);
          callback(...args);
        });
      }).catch(fail);
      return;
    }
    plain(opts, (...args: Parameters<ConnectCallback>) => {
      if (errorCode(args[0]) !== LEAF_ONLY) return callback(...args);
      // Des connexions refusées en même temps partagent UNE sonde et UN téléchargement.
      const attempt = completions.get(host) ?? complete(host, Number(opts.port) || 443);
      completions.set(host, attempt);
      void attempt.then(completion => completion.connector ? completion.connector(opts, callback) : callback(...args)).catch(fail);
    });
  };
  return connect;
}

/**
 * Fabrique de l'Agent public : les origines https des hôtes de la décision reçoivent le connecteur complétant ;
 * toutes les autres, le Pool d'undici tel quel. Le connecteur est UNIQUE : undici referme le Pool d'une origine
 * après une erreur de connexion, et un état porté par le Pool serait perdu à chaque refus.
 */
export function chainCompletingFactory(base: BaseConnect, options: ChainCompletionOptions = {}) {
  const hosts = options.hosts ?? CHAIN_COMPLETION_HOSTS;
  const connector = chainCompletingConnector(base, { ...options, hosts });
  return (origin: string | URL, opts: object): Dispatcher => {
    const { protocol, hostname } = new URL(String(origin));
    const settings = protocol === 'https:' && hosts.has(hostname) ? { ...opts, connect: connector } : opts;
    // Même choix que `defaultFactory` d'undici (lib/dispatcher/agent.js) : Client si une seule connexion, Pool sinon.
    return (settings as { connections?: number }).connections === 1
      ? new Client(origin, settings as Client.Options) : new Pool(origin, settings as Pool.Options);
  };
}
