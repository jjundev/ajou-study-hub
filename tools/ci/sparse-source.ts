import { appendFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { courses, type CourseConfig } from '../../config/courses.js';
export type SourceSelection=Pick<CourseConfig,'allowedRoots'|'extraFiles'>;
function fail():never{throw Error('CI_SPARSE_SELECTION_INVALID');}
export const selected=(path:string,roots:readonly string[])=>roots.some(root=>path===root||path.startsWith(root+'/'));
export function authorizedRoots(config:SourceSelection):string[]{
 const validate=(path:string)=>{
  if(typeof path!=='string'||!path||path.startsWith('/')||/^[a-z]:/i.test(path)||/[\\\x00-\x1f\x7f]/.test(path)||path.split('/').some(part=>!part||part==='.'||part==='..'||part.toLowerCase()==='.git'||/\s$/.test(part)))fail();
  return path;
 };
 if(!Array.isArray(config.allowedRoots)||!config.allowedRoots.length||!Array.isArray(config.extraFiles))fail();
 const roots=[...new Set(config.allowedRoots.map(validate))];
 for(const extra of config.extraFiles)if(!selected(validate(extra),roots))fail();
 return roots.filter(root=>!roots.some(other=>other!==root&&root.startsWith(other+'/')));
}
export function sparsePatterns(config:SourceSelection):string[]{
 // A root may be a file or directory. Anchored literal patterns preserve both cases.
 return authorizedRoots(config).map(root=>'/'+root.replace(/[!*?\[\]#]/g,'\\$&'));
}
export async function writeSparseOutputs(output:string):Promise<void>{
 const delimiter='STUDY_HUB_SPARSE_END';
 const lines=courses.map(course=>{
  const key=course.id.replaceAll('-','_'),patterns=sparsePatterns(course);
  if(!/^[a-z][a-z_0-9]*$/.test(key)||patterns.some(pattern=>pattern===delimiter))fail();
  return key+'<<'+delimiter+'\n'+patterns.join('\n')+'\n'+delimiter+'\n';
 });
 await appendFile(output,lines.join(''));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 (async()=>{if(process.argv.length!==2||!process.env.GITHUB_OUTPUT)fail();await writeSparseOutputs(process.env.GITHUB_OUTPUT);})().catch(()=>{process.stderr.write('CI_SPARSE_SELECTION_INVALID\n');process.exitCode=1;});
}
