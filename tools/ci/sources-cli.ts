import { readFile } from 'node:fs/promises';
import { bindSources, resolveRevisions, formatSourceOperationDiagnostic, SourceBindError, type Revision } from './sources.js';
async function main(){
 const [command,...args]=process.argv.slice(2);
 if(command==='resolve'&&args.length===0){
  const result=await resolveRevisions(fetch,process.env.GH_TOKEN??process.env.GITHUB_TOKEN??'');
  process.stdout.write(JSON.stringify(result)+'\n');return;
 }
 if(command==='bind'&&args.length===2){
  let revisions:unknown;
  try{revisions=JSON.parse(await readFile(args[1]!,'utf8'));}
  catch{throw new SourceBindError('CI_BIND_INPUT_FAILED','Cannot read source revisions');}
  const result=await bindSources(process.cwd(),args[0]!,revisions as Revision[]);
  process.stdout.write(JSON.stringify(result)+'\n');return;
 }
 throw new SourceBindError('CI_SOURCE_COMMAND_INVALID','Expected resolve or bind <appSha> <revisionsJsonPath>');
}
main().catch(error=>{process.stderr.write(formatSourceOperationDiagnostic(error));process.exitCode=1;});
