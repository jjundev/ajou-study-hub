import { pathToFileURL } from 'node:url';
import { courses } from '../../config/courses.js';

export async function dispatchUpdate(sourceRepository:string,token:string,request:typeof fetch):Promise<void> {
  if (!courses.some(course=>course.repo===sourceRepository)) throw Error('Invalid source repository');
  if (typeof token!=='string'||!token.trim()) throw Error('Dispatch token required');
  try {
    const response=await request('https://api.github.com/repos/jjundev/ajou-study-hub/actions/workflows/study-hub-update.yml/dispatches',{
      method:'POST',redirect:'error',signal:AbortSignal.timeout(30_000),
      headers:{Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
      body:JSON.stringify({ref:'main',inputs:{source_repository:sourceRepository}}),
    });
    if(response.status!==204||response.redirected) throw Error('Rejected');
  } catch {throw Error('Study hub dispatch failed');}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const args=process.argv.slice(2);
  (async()=>{
    if(args.length!==1)throw Error('Expected source repository');
    await dispatchUpdate(args[0]!,process.env.GH_TOKEN??'',fetch);
  })().catch(()=>{process.stderr.write('Study hub dispatch failed.\n');process.exitCode=1;});
}
