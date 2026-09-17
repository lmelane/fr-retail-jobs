import { closeSync, constants, fchmodSync, fstatSync, openSync, readSync, writeFileSync } from 'node:fs';

/** Explicit private outputs never follow a symlink or expose new bytes through an old file mode. */
export function writePrivateFile(path: string, data: string | Uint8Array): void {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
  try { fchmodSync(fd, 0o600); writeFileSync(fd, data); }
  finally { closeSync(fd); }
}

/** Bound input reads even if a file grows while it is being read. */
export function readInputFile(path: string, maxBytes: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isFile()) throw new Error('Input must be a regular file');
    const bytes = Buffer.alloc(maxBytes + 1); let used = 0;
    while (used < bytes.length) {
      const count = readSync(fd, bytes, used, bytes.length - used, null);
      if (!count) break;
      used += count;
    }
    if (!used || used > maxBytes) throw new Error('Input is empty or exceeds its size limit');
    return bytes.subarray(0, used);
  } finally { closeSync(fd); }
}

export function readInputJson(path: string, maxBytes: number): unknown {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(readInputFile(path, maxBytes)));
}
