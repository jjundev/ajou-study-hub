import { createHash } from 'node:crypto';
import { lstat, readFile, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { courses } from '../config/courses.js';
import { inspectSources, verifySnapshot, type SourceSettings } from './content/source.js';
import type { BuildReport } from './content/report.js';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const record=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
/** Settings are local project files, with every ancestor checked before reading. */
export async function readSourceSettings(project:string,path:string){
 const root=await realpath(project),target=resolve(root,path),rel=relative(root,target);
 if(!rel||isAbsolute(rel)||rel==='..'||rel.startsWith('..\\')||rel.startsWith('../'))throw Error('Unsafe source settings path');
 let cursor=target;
 while(cursor!==root){if((await lstat(cursor)).isSymbolicLink())throw Error('Symlink source settings');cursor=dirname(cursor);}
 if(await realpath(target)!==target)throw Error('Noncanonical source settings path');
 const bytes=await readFile(target),parsed:unknown=JSON.parse(bytes.toString('utf8'));
 if(!record(parsed)||Object.keys(parsed).sort().join(',')!=='explicitUntracked,roots'||!record(parsed.roots)||!record(parsed.explicitUntracked))throw Error('Invalid source settings');
 const roots=parsed.roots,explicit=parsed.explicitUntracked;
 if(Object.keys(roots).sort().join(',')!==courses.map(c=>c.id).sort().join(',')||!Object.values(roots).every(v=>typeof v==='string'&&v.trim())||!Object.entries(explicit).every(([key,value])=>courses.some(c=>c.id===key)&&Array.isArray(value)&&value.every(p=>typeof p==='string')))throw Error('Invalid source settings');
 const settings:SourceSettings={roots:Object.fromEntries(Object.entries(roots).map(([key,value])=>[key,resolve(root,value as string)])),explicitUntracked:explicit as Record<string,string[]>};
 return {settings,settingsPath:target,settingsSha256:hash(bytes)};
}
/** Batch Git capture plus the same allowed-root/realpath reader used by builds. */
export async function inspectBoundSources(project:string,path:string){
 const identity=await readSourceSettings(project,path);
 const snapshot=await inspectSources(courses,identity.settings,{batchTracking:true});
 const binding={version:1,...identity,configs:courses,catalogInputs:snapshot.catalogInputs,repoRoots:snapshot.repoRoots};
 return {snapshot,binding};
}
export type SourceBinding=Awaited<ReturnType<typeof inspectBoundSources>>['binding'];
/** Both checkpoints take fresh Git batches; no per-file Git subprocesses. */
export async function assertCurrentSources(project:string,binding:SourceBinding,manifest:BuildReport):Promise<void>{
 if(!binding||binding.version!==1||typeof binding.settingsPath!=='string')throw Error('Source settings identity missing; reverify required');
 const current=await inspectBoundSources(project,binding.settingsPath);
 if(!same(current.binding,binding)||!same(current.snapshot.provenance,manifest.sources))throw Error('Source settings/selection/provenance changed; reverify required');
 for(const input of manifest.inputs){if(hash(await current.snapshot.readFile(input.courseId,input.path))!==input.sha256)throw Error('Source input changed; reverify required');}
 await verifySnapshot(current.snapshot);
 const after=await inspectBoundSources(project,binding.settingsPath);
 if(!same(after.binding,binding)||!same(after.snapshot.provenance,manifest.sources))throw Error('Source tracking/settings changed during release; reverify required');
}
