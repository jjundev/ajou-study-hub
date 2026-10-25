import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { uploadBootstrapBundle } from '../../tools/deploy/bootstrap.js';

vi.mock('node:child_process', async importOriginal => ({...await importOriginal<typeof import('node:child_process')>(),spawn:vi.fn()}));
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});

it('bootstrap spawn fixes the target, credentials, config and cwd despite hostile inherited overrides and project dotenv',async()=>{
  const root=resolve('.generated/verification-tests',randomUUID());
  const directory=resolve(root,'.generated/bootstrap');
  const settings={accountId:'a'.repeat(32),workerName:'ajou-study-hub',allowedEmail:'owner@example.test',accessAppId:'11111111-1111-1111-1111-111111111111',productionUrl:'https://ajou-study-hub.example.workers.dev',previewUrls:[]};
  const hostile=['CLOUDFLARE_API_BASE_URL','CF_API_BASE_URL','WRANGLER_CI_OVERRIDE_NAME','WRANGLER_API_TOKEN','CLOUDFLARE_API_KEY','CLOUDFLARE_EMAIL','HTTPS_PROXY','HTTP_PROXY','ALL_PROXY','NODE_OPTIONS','WRANGLER_ENV','DOTENV_CONFIG_PATH'];
  await mkdir(directory,{recursive:true});
  await writeFile(resolve(root,'.env'),'CLOUDFLARE_API_BASE_URL=https://hostile.invalid\nWRANGLER_CI_OVERRIDE_NAME=unrelated-worker\n');
  await writeFile(resolve(root,'.env.local'),'CF_API_BASE_URL=https://hostile.invalid\n');
  for(const key of hostile)vi.stubEnv(key,'synthetic-hostile-override');
  vi.stubEnv('CLOUDFLARE_API_TOKEN','synthetic-token-only');vi.stubEnv('CLOUDFLARE_ACCOUNT_ID','wrong-account');
  let observed:any;
  vi.mocked(spawn).mockImplementation(((command:string,args:string[],options:any)=>{
    observed={command,args,options,config:JSON.parse(readFileSync(args[args.indexOf('--config')+1]!,'utf8')),cwdFiles:readdirSync(options.cwd)};
    const child=Object.assign(new EventEmitter(),{stdout:new PassThrough(),stderr:new PassThrough(),kill:vi.fn()});
    setTimeout(()=>{child.stdout.end(`  ${settings.productionUrl}\nCurrent Version ID: 12345678-1234-1234-1234-123456789abc\n`);child.emit('exit',0);},10);
    return child;
  }) as any);
  try {
    await uploadBootstrapBundle(root,directory,settings);
    expect(observed.options.env.CLOUDFLARE_API_TOKEN).toBe('synthetic-token-only');
    expect(observed.options.env.CLOUDFLARE_ACCOUNT_ID).toBe(settings.accountId);
    for(const key of hostile)expect(observed.options.env[key],key).toBeUndefined();
    expect(observed.options.cwd).not.toBe(root);
    expect(observed.args).toContain('--strict');expect(observed.args).toContain('--autoconfig=false');
    expect(observed.args.join(' ')).not.toContain('synthetic-token-only');
    expect(observed.command).toBe(process.execPath);
    expect(observed.args[0]).toBe(resolve(root,'node_modules/wrangler/bin/wrangler.js'));
    // The launch-time snapshot is captured inside the fake child while the owned
    // stage exists; production cleanup must not leave credentials or dotenv files.
    expect(observed.config).toEqual({name:settings.workerName,account_id:settings.accountId,compatibility_date:'2026-10-24',workers_dev:true,preview_urls:false,assets:{directory,html_handling:'none',not_found_handling:'404-page'}});
    expect(observed.cwdFiles).toEqual(['wrangler.json']);
    expect(await readFile(resolve(root,'.env'),'utf8')).toContain('unrelated-worker');
  } finally {await rm(root,{recursive:true,force:true});}
});
