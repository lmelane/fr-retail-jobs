/** Private S3-compatible archives. The official SDK owns signing and HTTP transport. */
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

export interface ObjectStore {
  put(key: string, body: Uint8Array, contentType?: string): Promise<{ etag: string | null }>;
  get(key: string): Promise<Uint8Array>;
  describe(): { provider: string; bucket: string; prefix: string; endpoint: string; region: string };
  uri(key: string): string;
}
export type S3Config = {
  endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string;
  prefix: string; forcePathStyle?: boolean;
};
const MAX_OBJECT_BYTES = 32_000_000;
const OPERATION_TIMEOUT_MS = 30_000;

/** No delete operation: retention only removes local bytes after verified remote reads. */
export class S3ObjectStore implements ObjectStore {
  private client: S3Client;
  constructor(private readonly cfg: S3Config, private readonly provider = 'S3_COMPATIBLE') {
    const endpoint = new URL(cfg.endpoint);
    if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname)))) {
      throw new Error('Archive endpoint must use HTTPS, or loopback HTTP for an isolated test');
    }
    if (!cfg.bucket.trim() || !cfg.region.trim() || !cfg.prefix.trim() || cfg.prefix.split('/').some(part => part === '.' || part === '..')) {
      throw new Error('Archive bucket, region and explicit environment prefix are required');
    }
    this.client = new S3Client({ endpoint: cfg.endpoint, region: cfg.region, forcePathStyle: cfg.forcePathStyle ?? true,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey }, maxAttempts: 3,
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: { connectionTimeout: 5_000, requestTimeout: OPERATION_TIMEOUT_MS },
    });
  }
  private scoped(key: string) {
    if (!key || key.startsWith('/') || key.split('/').some(part => part === '.' || part === '..')) throw new Error('Invalid archive object key');
    return `${this.cfg.prefix.replace(/^\/+|\/+$/g, '')}/${key}`;
  }
  private failure(operation: string, error: unknown): Error {
    const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
    return new Error(`Archive ${operation} failed (HTTP ${status ?? 'unavailable'})`);
  }
  async put(key: string, body: Uint8Array, contentType = 'application/octet-stream') {
    if (body.byteLength > MAX_OBJECT_BYTES) throw new Error('Archive object exceeds the bounded size');
    try {
      const result = await this.client.send(new PutObjectCommand({ Bucket: this.cfg.bucket, Key: this.scoped(key),
        Body: body, ContentType: contentType, ContentLength: body.byteLength }), { abortSignal: AbortSignal.timeout(OPERATION_TIMEOUT_MS) });
      return { etag: result.ETag ?? null };
    } catch (error) { throw this.failure('PUT', error); }
  }
  async get(key: string): Promise<Uint8Array> {
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: this.scoped(key) }),
        { abortSignal: AbortSignal.timeout(OPERATION_TIMEOUT_MS) });
      if (!result.Body) throw new Error('Archive response has no body');
      const stream = result.Body as AsyncIterable<Uint8Array> & { destroy?: () => void };
      if ((result.ContentLength ?? 0) > MAX_OBJECT_BYTES) { stream.destroy?.(); throw new Error('Archive object exceeds the bounded size'); }
      let size = 0;
      const chunks: Buffer[] = [];
      try {
        for await (const part of stream) {
          size += part.byteLength;
          if (size > MAX_OBJECT_BYTES) throw new Error('Archive object exceeds the bounded size');
          chunks.push(Buffer.from(part));
        }
      } finally { stream.destroy?.(); }
      return Buffer.concat(chunks);
    } catch (error) { throw this.failure('GET', error); }
  }
  describe() { return { provider: this.provider, bucket: this.cfg.bucket, prefix: this.cfg.prefix,
    endpoint: this.cfg.endpoint, region: this.cfg.region }; }
  uri(key: string) { return `s3://${this.cfg.bucket}/${this.scoped(key)}`; }
}

export const STORAGE_ENV = {
  endpoint: 'OBSERVATION_ARCHIVE_S3_ENDPOINT', region: 'OBSERVATION_ARCHIVE_S3_REGION',
  bucket: 'OBSERVATION_ARCHIVE_S3_BUCKET', accessKeyId: 'OBSERVATION_ARCHIVE_S3_ACCESS_KEY_ID',
  secretAccessKey: 'OBSERVATION_ARCHIVE_S3_SECRET_ACCESS_KEY', prefix: 'OBSERVATION_ARCHIVE_S3_PREFIX',
  forcePathStyle: 'OBSERVATION_ARCHIVE_S3_FORCE_PATH_STYLE',
} as const;
export function objectStoreConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Object.entries(STORAGE_ENV).every(([key, value]) => key === 'forcePathStyle' || Boolean(env[value]?.trim()));
}
export function objectStoreFromEnv(env: NodeJS.ProcessEnv = process.env): ObjectStore {
  if (!objectStoreConfigured(env)) throw new Error('Archive storage requires endpoint, region, bucket, credentials and an explicit environment prefix');
  if (env[STORAGE_ENV.forcePathStyle] && !['true', 'false'].includes(env[STORAGE_ENV.forcePathStyle]!)) throw new Error('Archive path style must be true or false');
  return new S3ObjectStore({ endpoint: env[STORAGE_ENV.endpoint]!, region: env[STORAGE_ENV.region]!, bucket: env[STORAGE_ENV.bucket]!,
    accessKeyId: env[STORAGE_ENV.accessKeyId]!, secretAccessKey: env[STORAGE_ENV.secretAccessKey]!, prefix: env[STORAGE_ENV.prefix]!,
    forcePathStyle: env[STORAGE_ENV.forcePathStyle] !== 'false' });
}
