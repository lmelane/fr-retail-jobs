import type { ObjectStore } from '../retention/objectStore.js';

export class MemoryStore implements ObjectStore {
  objects = new Map<string, Uint8Array>();
  async put(key: string, bytes: Uint8Array) { this.objects.set(key, bytes.slice()); return { etag: null }; }
  async get(key: string) { const bytes = this.objects.get(key); if (!bytes) throw new Error('Missing object'); return bytes.slice(); }
  describe() { return { provider: 'TEST', bucket: 'isolated-test', prefix: '', endpoint: 'memory:', region: 'test' }; }
  uri(key: string) { return `memory://isolated-test/${key}`; }
}
