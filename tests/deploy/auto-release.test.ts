import { expect, it, vi, afterEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fixture, settings } from './release-fixture.js';
import { releasePrivate } from '../../tools/deploy/release.js';
const mocks=vi.hoisted(()=>({root:'',inspect:vi.fn(),upload:vi.fn()}));
vi.mock('../../tools/verification-project.js',()=>({verificationProject:async(root?:string)=>root??mocks.root}));
vi.mock('../../tools/deploy/access-policy.js',async original=>({...await original<object>(),readAccessInspection:mocks.inspect}));
vi.mock('../../tools/deploy/wrangler-upload.js',async original=>({...await original<object>(),runWranglerUpload:mocks.upload}));
import { releaseAutomatic } from '../../tools/deploy/auto-release.js';
async function automatic(){
 const f=await fixture();mocks.root=f.root;
 const inspection={snapshot:Object.fromEntries(Object.entries(f.snapshot).filter(([k])=>!['allowedEmail','productionUrl','previewUrls'].includes(k))),workerId:'stable-worker-id',protectionFingerprint:'a'.repeat(64),versionId:'11111111-1111-1111-1111-111111111111'};
 const baseline={version:1 as const,contract:'initial-human-current-policy-v1' as const,approvedAt:'2020-01-01T00:00:00.000Z',settingsFingerprint:(await import('../../tools/deploy/access.js')).settingsFingerprint(settings),protectionFingerprint:inspection.protectionFingerprint,workerId:inspection.workerId,humanEvidenceHash:'b'.repeat(64)};
 await f.put('.reports/automation-baseline.json',baseline);
 mocks.inspect.mockResolvedValue(inspection);mocks.upload.mockResolvedValue({url:settings.productionUrl,versionId:inspection.versionId});
 vi.stubGlobal('fetch',vi.fn(async(url:string)=>url.startsWith('https://team.cloudflareaccess.com')?new Response('Cloudflare Access Send login code <input type="email">',{headers:{'cf-ray':'fixture'}}):new Response(null,{status:302,headers:{location:'https://team.cloudflareaccess.com/cdn-cgi/access/login/ajou-study-hub.example.workers.dev'}})));
 return {...f,baseline,inspection};
}
afterEach(()=>{vi.unstubAllGlobals();vi.clearAllMocks();});
it.each(['source','proof','bundle'])('changed_source_or_proof_blocks_upload: %s',async kind=>{
 const f=await automatic();let reads=0;mocks.inspect.mockImplementation(async()=>{if(++reads===2)await f.put(kind==='source'?'source/'+f.sourcePath:kind==='bundle'?'dist/index.html':'.reports/verification.json','changed');return f.inspection;});
 await expect(releaseAutomatic(settings,f.baseline)).rejects.toThrow();expect(mocks.upload).not.toHaveBeenCalled();
});
it('changed_access_blocks_upload',async()=>{const f=await automatic();mocks.inspect.mockResolvedValue({...f.inspection,protectionFingerprint:'c'.repeat(64)});await expect(releaseAutomatic(settings,f.baseline)).rejects.toThrow();expect(mocks.upload).not.toHaveBeenCalled();});
it('manual_24h_guard_preserved',async()=>{const f=await automatic();const evidence=JSON.parse(await readFile(resolve(f.root,'.reports/access-evidence.json'),'utf8'));await f.put('.reports/access-evidence.json',{...evidence,checkedAt:'2020-01-01T00:00:00.000Z'});await expect(releasePrivate(f.options,f)).rejects.toThrow();expect(f.upload).not.toHaveBeenCalled();});
it('upload_unknown_is_failure_no_retry',async()=>{const f=await automatic();mocks.upload.mockRejectedValue(Error('provider private detail'));await expect(releaseAutomatic(settings,f.baseline)).rejects.toThrow();expect(mocks.upload).toHaveBeenCalledTimes(1);expect(JSON.parse(await readFile(resolve(f.root,'.reports/automatic-release.json'),'utf8')).status).toBe('upload-started-outcome-unknown');});
it('postcheck_denial_required',async()=>{const f=await automatic();mocks.upload.mockImplementation(async()=>{vi.stubGlobal('fetch',vi.fn(async()=>new Response('private material')));return {url:settings.productionUrl,versionId:f.inspection.versionId};});await expect(releaseAutomatic(settings,f.baseline)).rejects.toThrow();expect(mocks.upload).toHaveBeenCalledTimes(1);});
it('requires actual active version to match upload receipt',async()=>{const f=await automatic();mocks.upload.mockResolvedValue({url:settings.productionUrl,versionId:'22222222-2222-2222-2222-222222222222'});await expect(releaseAutomatic(settings,f.baseline)).rejects.toThrow();});
it('publishes sealed verified bytes with old approved baseline and safe receipt',async()=>{const f=await automatic();expect(await releaseAutomatic(settings,f.baseline)).toEqual({url:settings.productionUrl,versionId:f.inspection.versionId,bundleHash:f.manifest.bundleHash});const receipt=await readFile(resolve(f.root,'.reports/automatic-release.json'),'utf8');expect(JSON.parse(receipt).status).toBe('published-protection-verified');expect(receipt).not.toContain('owner@example');});


it.each(['protection','baseline','settings'])('blocks changed %s during staging',async kind=>{
 const f=await automatic();let calls=0;
 mocks.inspect.mockImplementation(async()=>{
  if(++calls===2){if(kind==='protection')return {...f.inspection,protectionFingerprint:'c'.repeat(64)};
   await f.put(kind==='baseline'?'.reports/automation-baseline.json':'.local/deployment.json',kind==='baseline'?{...f.baseline,approvedAt:'2021-01-01T00:00:00.000Z'}:{...settings,allowedEmail:'changed@example.test'});}
  return f.inspection;
 });
 await expect(releaseAutomatic(settings,f.baseline)).rejects.toThrow();expect(mocks.upload).not.toHaveBeenCalled();
});
it.each(['offsite','loop','generic-denial','material','oversize'])('rejects untrusted anonymous probe %s without upload',async kind=>{
 const f=await automatic();
 vi.stubGlobal('fetch',vi.fn(async()=>kind==='offsite'?new Response(null,{status:302,headers:{location:'https://evil.test/login'}}):kind==='loop'?new Response(null,{status:302,headers:{location:settings.productionUrl}}):kind==='generic-denial'?new Response('Access denied',{status:403,headers:{'cf-ray':'fixture'}}):kind==='oversize'?new Response('x'.repeat(1024*1024+1)):new Response('synthetic html')));
 await expect(releaseAutomatic(settings,f.baseline)).rejects.toThrow();expect(mocks.upload).not.toHaveBeenCalled();
});
it('anonymous probes send no API credentials or cookies and use manual bounded redirects',async()=>{
 const f=await automatic();await releaseAutomatic(settings,f.baseline);
 for(const [url,options] of vi.mocked(fetch).mock.calls){expect(String(url)).toMatch(/^https:\/\/(ajou-study-hub.example.workers.dev|team.cloudflareaccess.com)\//);expect(options).toMatchObject({credentials:'omit',redirect:'manual'});expect(options?.headers).toBeUndefined();expect(options?.signal).toBeInstanceOf(AbortSignal);}
});


it('stale runtime proof blocks automatic upload even with approved baseline',async()=>{const f=await automatic();await f.put('.reports/verification.json',{...f.proof,createdAt:'2020-01-01T00:00:00.000Z'});await expect(releaseAutomatic(settings,f.baseline)).rejects.toThrow();expect(mocks.upload).not.toHaveBeenCalled();});
it('post-upload protection drift fails and retains pending receipt',async()=>{const f=await automatic();mocks.upload.mockImplementation(async()=>{mocks.inspect.mockResolvedValue({...f.inspection,protectionFingerprint:'d'.repeat(64)});return {url:settings.productionUrl,versionId:f.inspection.versionId};});await expect(releaseAutomatic(settings,f.baseline)).rejects.toThrow();expect(JSON.parse(await readFile(resolve(f.root,'.reports/automatic-release.json'),'utf8')).status).toBe('uploaded-postcheck-pending');});
it('automatic CLI rejects all target and path overrides before loading canonical private files',async()=>{
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const result=await promisify(execFile)(process.execPath,['--import','tsx','tools/deploy/auto-release.ts','--settings','arbitrary-private-path'],{timeout:30000}).then(value=>({...value,code:0}),error=>({stdout:error.stdout,stderr:error.stderr,code:error.code}));
 expect(result.code).toBe(1);expect(result.stdout).toBe('');expect(result.stderr).toBe('Automatic publication failed; inspect safe local receipt and current target before retrying\n');
});
