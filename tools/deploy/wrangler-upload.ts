import { spawn } from 'node:child_process';
import { lstat, readFile, readdir, realpath } from 'node:fs/promises';
import { dirname, resolve, basename } from 'node:path';
import { validateSettings, type DeploymentSettings } from './access.js';

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const version = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function fixedUploadConfig(settings: DeploymentSettings, directory: string) {
  return { name: settings.workerName, account_id: settings.accountId, compatibility_date: '2026-10-24', workers_dev: true, preview_urls: false,
    assets: { directory, html_handling: 'none', not_found_handling: '404-page' } };
}
/** Wrangler 4.152.0 deploy prints an exact trigger URL and Current Version ID. */
export function parseUploadReceipt(output: string, expectedUrl: string): { url: string; versionId: string } {
  const clean = output.replace(/\x1b\[[0-9;]*m/g, '');
  const ids = [...clean.matchAll(/^Current Version ID:\s*(\S+)\s*$/gm)];
  const urls = clean.split(/\r?\n/).map(s => s.trim()).filter(s => /^https?:\/\/\S+$/.test(s));
  if (ids.length !== 1 || !version.test(ids[0]![1]!) || urls.length !== 1 || urls[0] !== expectedUrl)
    throw Error('Upload receipt does not confirm the protected target/version');
  return { url: expectedUrl, versionId: ids[0]![1]! };
}
/** Both upload paths use a sealed config and a fresh owned cwd, never project dotenv or inherited Wrangler overrides. */
export async function runWranglerUpload(root: string, directory: string, configPath: string, settings: DeploymentSettings, token = process.env.CLOUDFLARE_API_TOKEN) {
  validateSettings(settings);
  if (!token || settings.previewUrls.length) throw Error('Fixed upload credentials and target required');
  const cwd = dirname(configPath), owned = resolve(root, '.generated');
  if (dirname(cwd) !== owned || !/^(private-release|bootstrap-upload)-[a-f0-9-]+$/.test(basename(cwd)) || configPath !== resolve(cwd, 'wrangler.json'))
    throw Error('Upload requires an isolated owned configuration');
  let cursor = configPath;
  while (true) {
    if ((await lstat(cursor)).isSymbolicLink() || await realpath(cursor) !== cursor) throw Error('Unsafe upload configuration path');
    const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
  }
  if ((await readdir(cwd)).some(name => !['assets', 'wrangler.json'].includes(name))) throw Error('Unexpected upload cwd content');
  if (!same(JSON.parse(await readFile(configPath, 'utf8')), fixedUploadConfig(settings, directory))) throw Error('Changed sealed upload configuration');
  const env: NodeJS.ProcessEnv = {};
  for (const name of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'NODE_EXTRA_CA_CERTS'])
    if (process.env[name]) env[name] = process.env[name];
  Object.assign(env, { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: settings.accountId, WRANGLER_SEND_METRICS: 'false', WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true', WRANGLER_LOG: 'log', CI: 'true', NO_COLOR: '1' });
  const output = await new Promise<string>((done, reject) => {
    const child = spawn(process.execPath, [resolve(root, 'node_modules/wrangler/bin/wrangler.js'), 'deploy', '--config', configPath, '--strict', '--autoconfig=false'], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    child.stdout.on('data', bytes => { stdout += bytes.toString(); if (stdout.length > 1024 * 1024) { child.kill(); reject(Error('Upload output limit')); } });
    child.stderr.resume();
    child.once('error', () => reject(Error('Wrangler upload could not start')));
    child.once('exit', code => code === 0 ? done(stdout) : reject(Error('Wrangler upload failed; inspect target before retrying')));
  });
  return parseUploadReceipt(output, settings.productionUrl);
}
