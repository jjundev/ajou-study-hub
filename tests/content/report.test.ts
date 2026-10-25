import { afterEach, expect, it, vi } from 'vitest';
import { mkdir, readFile, writeFile, rename, rm, symlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { writeReport } from '../../tools/content/report.js';

vi.mock('node:fs/promises', async importOriginal => {
  const actual=await importOriginal<typeof import('node:fs/promises')>();
  return {...actual,rename:vi.fn(actual.rename)};
});
const roots:string[]=[];
afterEach(async()=>{vi.mocked(rename).mockReset();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});});
async function fixture(){
 const root=resolve('.generated/verification-tests',randomUUID());roots.push(root);
 await mkdir(resolve(root,'.reports'),{recursive:true});
 const path=resolve(root,'.reports/verification.json');await writeFile(path,JSON.stringify({deploymentEligible:true}));
 const actual=await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
 return {root,path,actual};
}
const denied=(code:string)=>Object.assign(new Error('Synthetic transient rename lock'),{code});
it.runIf(process.platform==='win32').each(['EPERM','EACCES','EBUSY'])('publishes invalidation after a transient Windows %s rename lock',async code=>{
 const f=await fixture();let attempts=0;
 vi.mocked(rename).mockImplementation(async(from,to)=>{if(++attempts<3)throw denied(code);await f.actual.rename(from,to);});
 await expect(writeReport({deploymentEligible:false,status:'running'},f.path,[resolve(f.root,'dist')],f.root)).resolves.toBeUndefined();
 expect(JSON.parse(await readFile(f.path,'utf8'))).toEqual({deploymentEligible:false,status:'running'});
 expect(attempts).toBe(3);
});
it.runIf(process.platform==='win32')('rechecks a replaced destination after rename lock and preserves the external sentinel',async()=>{
 const f=await fixture(),sentinel=resolve(f.root,'original.txt');await writeFile(sentinel,'ORIGINAL_SENTINEL');
 let attempts=0;
 vi.mocked(rename).mockImplementation(async()=>{attempts++;await rm(f.path);await symlink(sentinel,f.path,'file');throw denied('EPERM');});
 await expect(writeReport({deploymentEligible:false},f.path,[],f.root)).rejects.toThrow(/Symlink/);
 expect(attempts).toBe(1);expect(await readFile(sentinel,'utf8')).toBe('ORIGINAL_SENTINEL');
});
it.runIf(process.platform==='win32')('bounds persistent rename failure without claiming invalidation or replacing the old proof',async()=>{
 const f=await fixture();vi.mocked(rename).mockRejectedValue(denied('EPERM'));
 await expect(writeReport({deploymentEligible:false},f.path,[],f.root)).rejects.toMatchObject({code:'EPERM'});
 expect(vi.mocked(rename).mock.calls.length).toBeGreaterThan(1);expect(vi.mocked(rename).mock.calls.length).toBeLessThanOrEqual(5);
 expect(JSON.parse(await readFile(f.path,'utf8'))).toEqual({deploymentEligible:true});
});
it('does not retry an unrelated publication error',async()=>{
 const f=await fixture();vi.mocked(rename).mockRejectedValue(denied('ENOSPC'));
 await expect(writeReport({deploymentEligible:false},f.path,[],f.root)).rejects.toMatchObject({code:'ENOSPC'});
 expect(rename).toHaveBeenCalledTimes(1);expect(JSON.parse(await readFile(f.path,'utf8'))).toEqual({deploymentEligible:true});
});
