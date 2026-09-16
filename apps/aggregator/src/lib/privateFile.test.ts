import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, statSync, symlinkSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readInputFile, readInputJson, writePrivateFile } from './privateFile.js';
const dirs: string[] = [];
const directory = () => { const dir=mkdtempSync(join(tmpdir(),'catwalks-private-file-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir,{recursive:true,force:true}); });
it('restricts an existing output before writing the new bytes and refuses symlinks', () => {
  const dir=directory(),path=join(dir,'out.json');writeFileSync(path,'previous',{mode:0o644});
  writePrivateFile(path,'private');expect(statSync(path).mode & 0o777).toBe(0o600);
  const link=join(dir,'link');symlinkSync(path,link);
  expect(() => writePrivateFile(link,'overwrite')).toThrow();expect(readFileSync(path,'utf8')).toBe('private');
  expect(() => readInputFile(link,100)).toThrow();
});
it('bounds input size and rejects malformed UTF-8 rather than rewriting a dossier', () => {
  const path=join(directory(),'input');writeFileSync(path,'12345');expect(() => readInputFile(path,4)).toThrow('size limit');
  expect(readInputFile(path,5).toString()).toBe('12345');
  writeFileSync(path,Buffer.from([0x22,0xff,0x22]));expect(() => readInputJson(path,100)).toThrow();
});
