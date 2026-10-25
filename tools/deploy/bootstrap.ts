import { build } from 'vite';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { validateSettings, assertFreeSubscriptions } from './access.js';
import { checkBundle, bundleLimits } from '../content/preflight.js';
import { writeReport, type BuildReport } from '../content/report.js';
const project = fileURLToPath(new URL('../../', import.meta.url));
const sha = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const contains = (root: string, path: string) => { const r = relative(root,path); return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith('..'+sep)); };
async function canonical(path: string): Promise<string> {
  try { return await realpath(path); } catch (e) { if((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; const parent=dirname(path); if(parent===path) throw e; return resolve(await canonical(parent),relative(parent,path)); }
}
/** Bootstrap writes only to reserved generated paths; never a caller-selected dist/source. */
export async function validateBootstrapOutput(output: string, sourceRoots: string[] = []): Promise<string> {
  const root = await realpath(project), target = resolve(output);
  const normal = resolve(root,'.generated/bootstrap'), tests = resolve(root,'.generated/bootstrap-tests');
  if(target !== normal && !(target !== tests && contains(tests,target)) && !target.startsWith(normal+'.stage-') && !target.startsWith(normal+'.previous-')) throw Error('Unsafe bootstrap output: expected reserved owned directory');
  let cursor=target;
  while(true) {
    try { const stat=await lstat(cursor); if(stat.isSymbolicLink()) throw Error('Symlink bootstrap output ancestor'); if(!stat.isDirectory()) throw Error('Bootstrap output ancestor is not a directory'); }
    catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e; }
    const parent=dirname(cursor); if(parent===cursor) break; cursor=parent;
  }
  if(await canonical(target)!==target) throw Error('Noncanonical bootstrap output');
  // Read only settings, never any real material. Protect source roots even if a local config overlaps a reserved path.
  let configured: string[] = [];
  try { const settings=JSON.parse(await readFile(resolve(root,'.local/sources.json'),'utf8')); if(settings.roots && typeof settings.roots==='object') configured=Object.values(settings.roots).filter((r):r is string=>typeof r==='string'); }
  catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e; }
  for(const source of [...sourceRoots,...configured]) { const actual=await canonical(resolve(root,source)); if(contains(actual,target)||contains(target,actual)) throw Error('Bootstrap output/source overlap'); }
  return target;
}
export async function applyHosting(directory: string): Promise<void> {
  for(const name of ['_headers','_redirects','404.html']) await copyFile(resolve(project,'config/hosting',name),resolve(directory,name));
}
export async function inventory(directory: string): Promise<BuildReport['outputs']> {
  const outputs: BuildReport['outputs']=[];
  async function visit(dir:string) {
    for(const entry of await readdir(dir,{withFileTypes:true})) {
      const path=resolve(dir,entry.name); if(entry.isSymbolicLink()) throw Error('Symlink in bundle');
      if(entry.isDirectory()) await visit(path);
      else if(entry.isFile()) { const bytes=await readFile(path); outputs.push({path:relative(directory,path).replaceAll('\\','/'),size:bytes.length,sha256:sha(bytes)}); }
    }
  }
  await visit(directory); outputs.sort((a,b)=>a.path.localeCompare(b.path));
  if(checkBundle(outputs,bundleLimits).length) throw Error('Bundle exceeds hosting limits');
  return outputs;
}
export async function buildBootstrap(outputDir: string): Promise<{directory:string;sentinelPaths:string[];bundleHash:string}> {
  const directory=await validateBootstrapOutput(outputDir), stage=directory+'.stage-'+randomUUID(), backup=directory+'.previous-'+randomUUID();
  await validateBootstrapOutput(stage); await validateBootstrapOutput(backup);
  const sentinels: Record<string,string|Buffer> = {
    'catalog.json':JSON.stringify({version:1,courses:[],groups:[],documents:[]})+'\n',
    'content/test/한글 공백.html':'<!doctype html><html lang="ko"><meta charset="utf-8"><title>합성 자료</title><h1>SYNTHETIC_HTML</h1><img src=".assets/x.png"><a href="sentinel.pdf">PDF</a></html>',
    'content/test/.pack/nested.html':'<!doctype html><meta charset="utf-8"><h1>SYNTHETIC_PACK</h1>',
    'content/test/.assets/x.png':Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=','base64'),
    'content/test/sentinel.pdf':'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n',
    'content/test/.assets/sentinel.woff2':Buffer.from('wOF2SYNTHETIC_FONT_MIME_SENTINEL'),
  };
  try {
    await build({configFile:false,root:project,publicDir:false,logLevel:'warn',build:{outDir:stage,emptyOutDir:true}});
    for(const [path,bytes] of Object.entries(sentinels)) { await mkdir(dirname(resolve(stage,path)),{recursive:true}); await writeFile(resolve(stage,path),bytes); }
    await applyHosting(stage);
    const outputs=await inventory(stage), bundleHash=sha(outputs.map(f=>`${f.path}\0${f.sha256}\n`).join(''));
    await validateBootstrapOutput(directory); await validateBootstrapOutput(stage); await validateBootstrapOutput(backup);
    let previous=false;
    try { await rename(directory,backup); previous=true; } catch(e) { if((e as NodeJS.ErrnoException).code!=='ENOENT') throw e; }
    try { await rename(stage,directory); } catch(e) { if(previous) await rename(backup,directory); throw e; }
    if(previous) { await validateBootstrapOutput(backup); await rm(backup,{recursive:true,force:true}); }
    const report:BuildReport={createdAt:new Date().toISOString(),sources:[],inputs:[],outputs,issues:[],bundleHash};
    const reportPath=directory===resolve(project,'.generated/bootstrap')?resolve(project,'.reports/bootstrap-build.json'):resolve(project,'.reports/bootstrap',sha(directory)+'.json');
    await writeReport(report,reportPath,[directory],project);
    return {directory,sentinelPaths:Object.keys(sentinels),bundleHash};
  } finally { await validateBootstrapOutput(stage); await rm(stage,{recursive:true,force:true}); }
}
/** Upload can only consume a freshly generated, empty canonical bootstrap; no CLI overrides. */
export async function assertBootstrapBundle(directory:string,report:BuildReport):Promise<void>{
  await validateBootstrapOutput(directory);
  const outputs=await inventory(directory);
  if(!Array.isArray(report.sources)||report.sources.length||!Array.isArray(report.inputs)||report.inputs.length||JSON.stringify(outputs)!==JSON.stringify(report.outputs)||sha(outputs.map(f=>`${f.path}\0${f.sha256}\n`).join(''))!==report.bundleHash)throw Error('Bootstrap manifest mismatch');
  const catalog=JSON.parse(await readFile(resolve(directory,'catalog.json'),'utf8'));
  if(JSON.stringify(catalog)!==JSON.stringify({version:1,courses:[],groups:[],documents:[]}))throw Error('Bootstrap catalog is not empty');
}
export async function uploadBootstrap():Promise<void>{
  await writeReport({passed:false,status:'bootstrap-upload-started',checkedAt:new Date().toISOString()},resolve(project,'.reports/access-evidence.json'),[resolve(project,'dist')],project);
  try {
    const raw=JSON.parse(await readFile(resolve(project,'.local/deployment.json'),'utf8'));
    // Worker creation precedes Access application creation. A pending app id is allowed
    // only for this empty uploader, never for private release/protection verification.
    const settings={...raw,accessAppId:raw.accessAppId||'00000000-0000-0000-0000-000000000000'};
    validateSettings(settings);
    if(settings.previewUrls.length) throw Error('Bootstrap requires disabled previews');
    const token=process.env.CLOUDFLARE_API_TOKEN;if(!token)throw Error('No API token');
    const request=fetch;
    async function get(path:string){const response=await request('https://api.cloudflare.com/client/v4'+path,{headers:{Authorization:`Bearer ${token}`},redirect:'error'});if(!response.ok)throw Error('API unavailable');const value=await response.json();if(!value||value.success!==true||!('result'in value)||(value.errors?.length)||value.result_info?.total_pages>1||value.result_info?.cursor||value.result_info?.cursors?.after)throw Error('API invalid');return value.result;}
    const account=await get('/accounts/'+settings.accountId);if(account.id!==settings.accountId)throw Error('Account mismatch');
    const subscriptions=await get('/accounts/'+settings.accountId+'/subscriptions');
    assertFreeSubscriptions(subscriptions);
    const subdomain=await get('/accounts/'+settings.accountId+'/workers/subdomain');
    if(settings.productionUrl!==`https://${settings.workerName}.${subdomain.subdomain}.workers.dev`)throw Error('Target host mismatch');
    const result=await buildBootstrap(resolve(project,'.generated/bootstrap'));
    const report=JSON.parse(await readFile(resolve(project,'.reports/bootstrap-build.json'),'utf8')) as BuildReport;
    await assertBootstrapBundle(result.directory,report);
    const outputs=await inventory(result.directory);
    if(report.sources.length||report.inputs.length||JSON.stringify(outputs)!==JSON.stringify(report.outputs)||report.bundleHash!==result.bundleHash||sha(outputs.map(f=>`${f.path}\0${f.sha256}\n`).join(''))!==result.bundleHash)throw Error('Bootstrap changed');
    const config=resolve(project,'.reports/bootstrap-upload.json');
    // No user-supplied Wrangler configuration, entry point, route or asset directory.
    await writeReport({name:settings.workerName,account_id:settings.accountId,compatibility_date:'2026-10-24',workers_dev:true,preview_urls:false,assets:{directory:result.directory,html_handling:'none',not_found_handling:'404-page'}},config,[result.directory],project);
    await new Promise<void>((done,reject)=>{const child=spawn(process.execPath,[resolve(project,'node_modules/wrangler/bin/wrangler.js'),'deploy','--config',config],{cwd:project,env:{...process.env,CLOUDFLARE_ACCOUNT_ID:settings.accountId},stdio:'ignore'});child.once('error',reject);child.once('exit',code=>code===0?done():reject(Error('Upload failed')));});
  }catch{throw Error('Empty bootstrap upload failed; no private upload is authorized');}
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) void (async()=>{
  if(process.argv.length!==3||!['build','upload'].includes(process.argv[2]!)) throw Error('Expected bootstrap build or upload with no overrides');
  if(process.argv[2]==='build') console.log(JSON.stringify(await buildBootstrap(resolve(project,'.generated/bootstrap')),null,2));
  else {await uploadBootstrap();console.log('Empty bootstrap uploaded; Access verification remains required');}
})().catch(()=>{console.error('Bootstrap operation failed');process.exitCode=1;});
