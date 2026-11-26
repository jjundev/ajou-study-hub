import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { build } from 'esbuild';
import { workerVersionId } from './worker-target.js';

const exec = promisify(execFile);
export const staticAssets = { binding: 'ASSETS', html_handling: 'none', not_found_handling: '404-page' } as const;
export const workerCompatibilityDate = '2026-10-24';

export async function bundleProfiledWorker(project: string, entry: 'course-assets' | 'hub', outfile: string) {
  await build({ stdin: { contents: 'export { default } from "./' + entry + '.ts";', resolveDir: resolve(project, 'src/worker') },
    outfile, platform: 'browser', target: 'es2022', format: 'esm', bundle: true, logLevel: 'silent' });
}

export async function withProfiledWrangler<T>(project: string, account: string, token: string | undefined, configuration: object,
  entry: 'course-assets' | 'hub', operation: (directory: string, run: (args: string[]) => Promise<string>) => Promise<T>): Promise<T> {
  if (!token || !/^[a-f0-9]{32}$/.test(account)) throw Error('Cloudflare publish credentials required');
  const owned = resolve(await realpath(project), '.generated');
  await mkdir(owned, { recursive: true });
  if (await realpath(owned) !== owned) throw Error('Unsafe Wrangler staging directory');
  const directory = await mkdtemp(resolve(owned, 'profiled-publish-'));
  try {
    const config = resolve(directory, 'wrangler.json');
    await bundleProfiledWorker(project, entry, resolve(directory, 'worker.mjs'));
    await writeFile(config, JSON.stringify({ ...configuration, account_id: account, main: './worker.mjs' }), { flag: 'wx' });
    const env: NodeJS.ProcessEnv = {};
    for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'NODE_EXTRA_CA_CERTS']) {
      if (process.env[key]) env[key] = process.env[key];
    }
    Object.assign(env, { CLOUDFLARE_API_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account, WRANGLER_SEND_METRICS: 'false',
      WRANGLER_WRITE_LOGS: 'false', WRANGLER_LOG_SANITIZE: 'true', CI: 'true', NO_COLOR: '1', WRANGLER_LOAD_DEV_VARS_FROM_DOT_ENV: 'false' });
    const wrangler = resolve(project, 'node_modules/wrangler');
    if (JSON.parse(await readFile(resolve(wrangler, 'package.json'), 'utf8')).version !== '4.152.0') throw Error('Unexpected Wrangler version');
    return await operation(directory, async args => {
      try {
        const { stdout } = await exec(process.execPath, [resolve(wrangler, 'bin/wrangler.js'), ...args, '--config', config],
          { cwd: directory, env, timeout: 240_000, maxBuffer: 1024 * 1024 });
        return stdout;
      } catch {
        throw Error('Wrangler operation did not return a verified receipt');
      }
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

export function uploadedVersion(output: string, creating = false): string {
  const key = creating ? 'Current Version ID' : '(?:Worker )?Version ID';
  const values = [...output.replace(/\x1b\[[0-9;]*m/g, '').matchAll(new RegExp('^' + key + ':\\s*(\\S+)\\s*$', 'gm'))];
  const value = values[0]?.[1];
  if (values.length !== 1 || !value || !workerVersionId.test(value)) throw Error('Candidate Worker version could not be identified');
  return value;
}
