import { test, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { parseAppArguments, validateAppOutput } from '../../tools/app-build-safety.js';

test('rejects destination/config/root overrides and aliases before content writes or stale attestation', async () => {
  const project = await mkdtemp(resolve(tmpdir(), 'study-cli-'));
  try {
    const source = resolve(project, 'original');
    await mkdir(source); await mkdir(resolve(project, 'dist')); await mkdir(resolve(project, '.reports'));
    await writeFile(resolve(source, 'sentinel.txt'), 'original untouched');
    await writeFile(resolve(project, 'dist/stale.txt'), 'stale output');
    await writeFile(resolve(project, '.reports/app-build.json'), 'old report');
    const cli = resolve('tools/cli.ts');
    for (const override of [['--outDir', source], [`--outDir=${source}`], ['--config', source], ['-c', source], ['--root', source], [source], ['--emptyOutDir'], ['--publicDir', source], ['--mode', 'other']]) {
      const result = spawnSync(process.execPath, ['--import', pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href, cli, 'build', '--sources', 'missing-settings.json', ...override], { cwd: project, encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('Unsupported Vite argument');
    }
    expect(await readFile(resolve(source, 'sentinel.txt'), 'utf8')).toBe('original untouched');
    expect(await readFile(resolve(project, 'dist/stale.txt'), 'utf8')).toBe('stale output');
    expect(await readFile(resolve(project, '.reports/app-build.json'), 'utf8')).toBe('old report');
    await expect(readFile(resolve(project, '.reports/content-build.json'))).rejects.toThrow();
    await expect(readFile(resolve(project, '.local/fixture-sources.json'))).rejects.toThrow();
  } finally { await rm(project, { recursive: true, force: true }); }
}, 30000);

test('allowlists verified command-specific flags and consumes sources', () => {
  expect(parseAppArguments('build', ['--sources', 'input.json', '--base', '/'])).toEqual({ sources: 'input.json', explicitSources: true, viteArgs: ['--base', '/'] });
  expect(parseAppArguments('dev', ['--host', '127.0.0.1', '--port', '4173', '--strictPort']).viteArgs).toEqual(['--host', '127.0.0.1', '--port', '4173', '--strictPort']);
  for (const args of [['--base'], ['--port', '0'], ['--port', '70000'], ['--host'], ['--strictPort', 'false'], ['--sources'], ['--', '--outDir', 'x']]) expect(() => parseAppArguments('dev', args)).toThrow();
  expect(() => parseAppArguments('build', ['--host', 'localhost'])).toThrow();
});

test('fixed dist rejects source/settings overlap and symlinks while preserving sentinel data', async () => {
  const project = await mkdtemp(resolve(tmpdir(), 'study-output-'));
  try {
    const source = resolve(project, 'original'); await mkdir(source);
    await writeFile(resolve(source, 'sentinel.txt'), 'source');
    await expect(validateAppOutput([], undefined, project)).resolves.toBe(resolve(project, 'dist'));
    await expect(validateAppOutput([project], undefined, project)).rejects.toThrow(/overlap/);
    await expect(validateAppOutput([resolve(project, 'dist/source')], undefined, project)).rejects.toThrow(/overlap/);
    await expect(validateAppOutput([], resolve(project, 'dist/settings.json'), project)).rejects.toThrow(/settings/);
    await symlink(source, resolve(project, 'dist'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(validateAppOutput([source], undefined, project)).rejects.toThrow(/Symlink/);
    const cli = resolve('tools/cli.ts'), loader = pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href;
    const run = (args: string[]) => spawnSync(process.execPath, ['--import', loader, cli, ...args], { cwd: project, encoding: 'utf8' });
    const linked = run(['build', '--sources', 'missing-settings.json']);
    expect(linked.status).not.toBe(0); expect(linked.stderr).toContain('Symlink');
    expect(await readFile(resolve(source, 'sentinel.txt'), 'utf8')).toBe('source');
    await rm(resolve(project, 'dist'));
    const alias = resolve(project, 'alias');
    await symlink(project, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(validateAppOutput([], undefined, alias)).rejects.toThrow(/Symlink/);
    await rm(alias);
    await writeFile(resolve(project, 'settings.json'), JSON.stringify({ roots: { fixture: process.cwd() }, explicitUntracked: {} }));
    const overlap = spawnSync(process.execPath, ['--import', loader, cli, 'build', '--sources', resolve(project, 'settings.json')], { encoding: 'utf8' });
    expect(overlap.status).not.toBe(0); expect(overlap.stderr).toContain('overlap');
    await expect(readFile(resolve(project, '.reports/app-build.json'))).rejects.toThrow();
  } finally { await rm(project, { recursive: true, force: true }); }
});

test.each(['file','directory'] as const)('fixture settings reject a %s alias before touching external sentinels', async kind => {
  const project = await mkdtemp(resolve(tmpdir(),'study-fixture-settings-'));
  const sentinel=resolve(project,'original/settings.json');
  try {
    await mkdir(resolve(project,'original'),{recursive:true});await writeFile(sentinel,'ORIGINAL_SENTINEL');
    if(kind==='file') {
      await mkdir(resolve(project,'.local'));
      await symlink(sentinel,resolve(project,'.local/fixture-sources.json'),'file');
    } else {
      await writeFile(resolve(project,'original/fixture-sources.json'),'ORIGINAL_SENTINEL');
      await symlink(resolve(project,'original'),resolve(project,'.local'),process.platform==='win32'?'junction':'dir');
    }
    const result=spawnSync(process.execPath,['--import',pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href,resolve('tools/create-fixture.ts')],{cwd:project,encoding:'utf8'});
    expect(await readFile(kind==='file'?sentinel:resolve(project,'original/fixture-sources.json'),'utf8')).toBe('ORIGINAL_SENTINEL');
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/(?:Symlink|Noncanonical) fixture settings/);
  } finally { await rm(project,{recursive:true,force:true}); }
});
