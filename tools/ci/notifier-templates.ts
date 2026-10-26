import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { courses } from '../../config/courses.js';

async function checkPath(path:string,directory:boolean){
  try {
    const stat=await lstat(path);
    if(stat.isSymbolicLink()||(directory?!stat.isDirectory():!stat.isFile())) throw Error('Unsafe notifier output path');
  } catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw Error('Unsafe notifier output path');}
}

export async function generateNotifiers(project:string):Promise<Record<string,string>> {
  const root=await realpath(project);
  let directory=root;
  for(const segment of ['.generated','source-notifiers']){
    directory=join(directory,segment);
    await checkPath(directory,true);
    await mkdir(directory,{recursive:true});
  }
  const template=await readFile(new URL('../../config/ci/notify-study-hub.yml.template',import.meta.url),'utf8');
  const files:Record<string,string>={};
  for(const course of courses){
    const path=join(directory,course.id+'.yml');
    await checkPath(path,false);
    await writeFile(path,template.replaceAll('__SOURCE_REPOSITORY__',course.repo),'utf8');
    files[course.id]=path;
  }
  return files;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  (async()=>{
    if(process.argv.length!==2)throw Error('Unexpected notifier arguments');
    await generateNotifiers(process.cwd());
  })().catch(()=>{process.stderr.write('Notifier generation failed; check output directory.\n');process.exitCode=1;});
}
