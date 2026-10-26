import { readFile } from 'node:fs/promises';
import { bindSources, resolveRevisions, type Revision } from './sources.js';
async function main(){
 const [command,...args]=process.argv.slice(2);
 if(command==='resolve'&&args.length===0){
  const result=await resolveRevisions(fetch,process.env.GH_TOKEN??process.env.GITHUB_TOKEN??'');
  process.stdout.write(JSON.stringify(result)+'\n');return;
 }
 if(command==='bind'&&args.length===2){
  const revisions:unknown=JSON.parse(await readFile(args[1]!,'utf8'));
  const result=await bindSources(process.cwd(),args[0]!,revisions as Revision[]);
  process.stdout.write(JSON.stringify(result)+'\n');return;
 }
 throw Error('Expected resolve or bind <appSha> <revisionsJsonPath>');
}
main().catch(()=>{process.stderr.write('CI source operation failed; check pinned revisions and source ownership.\n');process.exitCode=1;});
