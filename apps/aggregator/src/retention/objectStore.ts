/**
 * LE STOCKAGE OBJET — l'endroit où les archives d'observations vivent réellement.
 *
 * La chaîne de rétention (P8/D61-a) était complète SAUF sa durabilité : elle écrivait sur le système de
 * fichiers local du conteneur. Or un volume de conteneur n'est pas une archive — il disparaît avec le
 * conteneur, et une purge fail-closed qui s'appuie dessus supprimerait des observations contre une copie
 * qui peut ne plus exister demain. C'est la réserve nommée en clôture de P8.
 *
 * ──────────────────────────────────────────────────────────────────────────────────────────────────────
 * POURQUOI UNE INTERFACE, ET POURQUOI S3
 *
 * Le protocole S3 est le seul dénominateur commun réel entre AWS S3, Cloudflare R2, Backblaze B2, MinIO et
 * Scaleway. Programmer contre lui, et non contre un SDK propriétaire, laisse le choix du fournisseur ouvert
 * — il se règle par `S3_ENDPOINT`, pas par une réécriture. *Le fournisseur est une décision d'exploitation,
 * pas une dépendance de code.*
 *
 * La signature SigV4 est implémentée ici avec `node:crypto` plutôt qu'en tirant `@aws-sdk/*` : quatre
 * opérations sont nécessaires (PUT, GET, HEAD, LIST), le SDK pèse plusieurs mégaoctets, et une dépendance
 * qu'on ne maîtrise pas dans le chemin d'une PURGE est un risque disproportionné.
 *
 * ──────────────────────────────────────────────────────────────────────────────────────────────────────
 * CE QUE CE MODULE NE FAIT JAMAIS
 *
 * · il ne supprime rien — la suppression distante n'est pas dans l'interface, donc aucun défaut ici ne peut
 *   effacer une archive ; seule la purge des lignes CHAUDES existe, et elle vit dans la chaîne de rétention ;
 * · il ne journalise ni clé, ni jeton, ni en-tête `Authorization` ;
 * · il ne crée pas le bucket : provisionner est une décision de propriétaire, avec ses coûts et sa région.
 */
import { createHash, createHmac } from 'node:crypto';

/** Ce qu'un stockage doit savoir faire pour que la chaîne de rétention soit durable. */
export interface ObjectStore {
  /** Écrit l'objet. Doit échouer bruyamment : un upload silencieusement raté autoriserait une purge. */
  put(key: string, body: Uint8Array, contentType?: string): Promise<{ etag: string | null }>;
  /** Relit l'objet — c'est cette relecture DISTANTE qui prouve l'archive, jamais le tampon local. */
  get(key: string): Promise<Uint8Array>;
  /** Taille et présence, sans transférer le corps. `null` si absent. */
  head(key: string): Promise<{ size: number } | null>;
  /** Les clés sous un préfixe, paginées jusqu'au bout. */
  list(prefix: string): Promise<string[]>;
  /** De quoi tracer l'emplacement dans une preuve, sans secret. */
  describe(): { provider: string; bucket: string; prefix: string; endpoint: string; region: string };
  /** L'URI stable écrite dans le manifeste et les pointeurs. */
  uri(key: string): string;
}

export type S3Config = {
  endpoint: string;      // https://s3.eu-west-3.amazonaws.com, https://<id>.r2.cloudflarestorage.com …
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  /** Préfixe de rangement, séparé PAR ENVIRONNEMENT : une purge de recette ne doit jamais viser la prod. */
  prefix: string;
  /** R2 et MinIO n'acceptent pas l'hébergement virtuel par défaut. */
  forcePathStyle?: boolean;
};

const UNSIGNED = 'UNSIGNED-PAYLOAD';
const sha256Hex = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const hmac = (k: Uint8Array | string, d: string) => createHmac('sha256', k).update(d).digest();

/** Chaque segment est encodé, mais les `/` restent des séparateurs de clé. */
function encodeKey(key: string): string {
  return key.split('/').map((s) => encodeURIComponent(s)).join('/');
}

/**
 * SigV4, réduit à ce que quatre opérations exigent.
 *
 * Le corps n'est pas haché (`UNSIGNED-PAYLOAD`) : l'intégrité de l'archive est déjà prouvée par son sha256
 * porté au manifeste et REVÉRIFIÉ à la relecture distante. Hacher deux fois plusieurs centaines de mégaoctets
 * coûterait sans rien prouver de plus.
 */
function sign(cfg: S3Config, method: string, key: string, query: string, headers: Record<string, string>) {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const host = new URL(cfg.endpoint).host;

  const all: Record<string, string> = {
    ...headers, host, 'x-amz-content-sha256': UNSIGNED, 'x-amz-date': amzDate,
  };
  const signedHeaders = Object.keys(all).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = signedHeaders.map((h) => {
    const [, v] = Object.entries(all).find(([k]) => k.toLowerCase() === h)!;
    return `${h}:${String(v).trim()}\n`;
  }).join('');

  const canonicalUri = cfg.forcePathStyle !== false
    ? `/${cfg.bucket}${key ? `/${encodeKey(key)}` : ''}`
    : `/${encodeKey(key)}`;

  const canonicalRequest = [
    method, canonicalUri, query, canonicalHeaders, signedHeaders.join(';'), UNSIGNED,
  ].join('\n');

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const kDate = hmac(`AWS4${cfg.secretAccessKey}`, dateStamp);
  const kSigning = hmac(hmac(hmac(kDate, cfg.region), 's3'), 'aws4_request');
  const signature = createHmac('sha256', kSigning).update(toSign).digest('hex');

  return {
    ...all,
    Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`,
  };
}

export class S3ObjectStore implements ObjectStore {
  constructor(private readonly cfg: S3Config, private readonly provider = 'S3_COMPATIBLE') {}

  private url(key: string, query = ''): string {
    const base = this.cfg.endpoint.replace(/\/$/, '');
    const path = this.cfg.forcePathStyle !== false
      ? `${base}/${this.cfg.bucket}${key ? `/${encodeKey(key)}` : ''}`
      : `${base}/${encodeKey(key)}`;
    return query ? `${path}?${query}` : path;
  }

  /** Le préfixe d'environnement est ajouté ICI, en un seul endroit : aucun appelant ne peut l'oublier. */
  private scoped(key: string): string {
    const p = this.cfg.prefix.replace(/^\/|\/$/g, '');
    return p ? `${p}/${key.replace(/^\//, '')}` : key.replace(/^\//, '');
  }

  async put(key: string, body: Uint8Array, contentType = 'application/octet-stream') {
    const k = this.scoped(key);
    const headers = sign(this.cfg, 'PUT', k, '', {
      'content-type': contentType, 'content-length': String(body.length),
    });
    const r = await fetch(this.url(k), { method: 'PUT', headers, body });
    if (!r.ok) throw new Error(`PUT ${k}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
    return { etag: r.headers.get('etag') };
  }

  async get(key: string): Promise<Uint8Array> {
    const k = this.scoped(key);
    const r = await fetch(this.url(k), { method: 'GET', headers: sign(this.cfg, 'GET', k, '', {}) });
    if (!r.ok) throw new Error(`GET ${k}: HTTP ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }

  async head(key: string) {
    const k = this.scoped(key);
    const r = await fetch(this.url(k), { method: 'HEAD', headers: sign(this.cfg, 'HEAD', k, '', {}) });
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`HEAD ${k}: HTTP ${r.status}`);
    return { size: Number(r.headers.get('content-length') ?? 0) };
  }

  /**
   * Paginée JUSQU'AU BOUT. S'arrêter à la première page ferait lire « la clé n'existe pas » là où elle est
   * simplement plus loin — la même erreur que le plafond de pages corrigé en P9, avec une purge au bout.
   */
  async list(prefix: string): Promise<string[]> {
    const full = this.scoped(prefix);
    const keys: string[] = [];
    let token: string | undefined;
    for (let page = 0; page < 1000; page++) {
      const q = new URLSearchParams({ 'list-type': '2', prefix: full });
      if (token) q.set('continuation-token', token);
      const query = [...q.entries()].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .sort().join('&');
      const r = await fetch(this.url('', query), { method: 'GET', headers: sign(this.cfg, 'GET', '', query, {}) });
      if (!r.ok) throw new Error(`LIST ${full}: HTTP ${r.status}`);
      const xml = await r.text();
      for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
      const next = xml.match(/<NextContinuationToken>([^<]+)</)?.[1];
      if (xml.includes('<IsTruncated>true</IsTruncated>') && next) { token = next; continue; }
      return keys;
    }
    throw new Error(`LIST ${full}: pagination non terminée — ensemble incomplet`);
  }

  describe() {
    return {
      provider: this.provider, bucket: this.cfg.bucket, prefix: this.cfg.prefix,
      endpoint: this.cfg.endpoint, region: this.cfg.region,
    };
  }

  uri(key: string) { return `s3://${this.cfg.bucket}/${this.scoped(key)}`; }
}

/** Les noms de variables attendus — un seul endroit, pour que la procédure de reprise les cite exactement. */
export const STORAGE_ENV = {
  endpoint: 'OBSERVATION_ARCHIVE_S3_ENDPOINT',
  region: 'OBSERVATION_ARCHIVE_S3_REGION',
  bucket: 'OBSERVATION_ARCHIVE_S3_BUCKET',
  accessKeyId: 'OBSERVATION_ARCHIVE_S3_ACCESS_KEY_ID',
  secretAccessKey: 'OBSERVATION_ARCHIVE_S3_SECRET_ACCESS_KEY',
  prefix: 'OBSERVATION_ARCHIVE_S3_PREFIX',
  forcePathStyle: 'OBSERVATION_ARCHIVE_S3_FORCE_PATH_STYLE',
} as const;

/**
 * Construit le stockage depuis l'environnement, ou explique PRÉCISÉMENT ce qui manque.
 *
 * Il ne retombe jamais silencieusement sur un stockage local : c'est exactement ainsi qu'une purge
 * s'exécuterait en croyant ses archives distantes. Une configuration absente doit BLOQUER.
 */
export function objectStoreFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStore {
  const missing = (Object.keys(STORAGE_ENV) as (keyof typeof STORAGE_ENV)[])
    .filter((k) => k !== 'prefix' && k !== 'forcePathStyle' && !env[STORAGE_ENV[k]]);
  if (missing.length) {
    throw new Error(
      `stockage objet non configuré — variables manquantes : ${missing.map((k) => STORAGE_ENV[k]).join(', ')}`);
  }
  return new S3ObjectStore({
    endpoint: env[STORAGE_ENV.endpoint]!,
    region: env[STORAGE_ENV.region]!,
    bucket: env[STORAGE_ENV.bucket]!,
    accessKeyId: env[STORAGE_ENV.accessKeyId]!,
    secretAccessKey: env[STORAGE_ENV.secretAccessKey]!,
    prefix: env[STORAGE_ENV.prefix] ?? 'production/observations',
    forcePathStyle: env[STORAGE_ENV.forcePathStyle] !== 'false',
  });
}

/** Le stockage est-il configuré ? Pour constater, sans déclencher l'erreur de construction. */
export function objectStoreConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return (Object.keys(STORAGE_ENV) as (keyof typeof STORAGE_ENV)[])
    .filter((k) => k !== 'prefix' && k !== 'forcePathStyle')
    .every((k) => Boolean(env[STORAGE_ENV[k]]));
}

/**
 * La clé d'un objet d'archive : le grain de partition imposé par la décision, date en tête.
 * La date d'abord parce que la rétention se raisonne par date : « tout ce qui précède ce jour » est alors
 * un préfixe, et non un balayage complet du bucket.
 */
export function archiveKey(day: string, runId: string, sourceKey: string, kind: 'archive' | 'manifest'): string {
  const ext = kind === 'archive' ? 'jsonl.gz' : 'manifest.json';
  return `${day}/${runId}/${sourceKey}.${ext}`;
}
