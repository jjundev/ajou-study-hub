import { describe, it, expect } from 'vitest';
import { readFile, readdir, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { buildBootstrap, validateBootstrapOutput } from '../../tools/deploy/bootstrap.js';

describe('empty hosting bootstrap', () => {
  it('bootstrap_has_no_sources and hashes every clean compiled asset/control file', async () => {
    const directory = resolve('.generated/bootstrap-tests', randomUUID());
    await mkdir(directory, { recursive: true });
    await writeFile(resolve(directory, 'private-old.html'), 'PRIVATE_STALE');
    const result = await buildBootstrap(directory);
    const report = JSON.parse(await readFile(resolve('.reports/bootstrap', createHash('sha256').update(directory).digest('hex') + '.json'), 'utf8'));
    expect(report.sources).toEqual([]); expect(report.inputs).toEqual([]);
    expect(report.bundleHash).toBe(result.bundleHash);
    expect(report.outputs.some((f: {path:string}) => f.path === 'private-old.html')).toBe(false);
    expect(await readdir(directory)).not.toContain('private-old.html');
    expect(JSON.parse(await readFile(resolve(directory, 'catalog.json'), 'utf8'))).toEqual({version:1,courses:[],groups:[],documents:[]});
    for (const file of report.outputs) {
      const bytes = await readFile(resolve(directory, file.path));
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(file.sha256);
      expect(bytes.includes(Buffer.from('PRIVATE_STALE'))).toBe(false);
    }
    expect(report.outputs.filter((f: {path:string}) => f.path.startsWith('content/')).map((f:{path:string})=>f.path).sort()).toEqual(result.sentinelPaths.filter(p=>p.startsWith('content/')).sort());
    for (const file of ['_headers','_redirects','404.html','index.html','catalog.json']) expect(report.outputs.some((f:{path:string})=>f.path===file)).toBe(true);
  });
  it('rejects non-owned outputs, canonical/source overlap and symlink ancestors', async () => {
    for (const path of ['dist', '.generated', '.generated/content', '../outside']) await expect(validateBootstrapOutput(resolve(path))).rejects.toThrow();
    const base = resolve('.generated/bootstrap-tests', randomUUID());
    await mkdir(base, {recursive:true});
    await expect(validateBootstrapOutput(resolve(base,'nested'), [base])).rejects.toThrow(/overlap/);
    const link = resolve('.generated/bootstrap-tests', randomUUID());
    await symlink(base, link, 'junction');
    try { await expect(validateBootstrapOutput(resolve(link,'nested'))).rejects.toThrow(/Symlink/); }
    finally { await rm(link); }
  });
});
