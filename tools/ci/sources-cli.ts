import { readFile } from 'node:fs/promises';
import { bindSources, resolveRevisions, formatSourceOperationDiagnostic, SourceBindError, type Revision } from './sources.js';
import { isCourseId, type CourseId } from '../../config/course-workers.js';
import { bindCourseSource, resolveCourseRevision } from './course-source.js';
async function main(){
 const [command,...args]=process.argv.slice(2);
 let courseId: CourseId | undefined;
 if (args.at(-2) === '--course') {
  const value = args.pop();
  args.pop();
  if (!value || !isCourseId(value)) throw new SourceBindError('CI_SOURCE_COMMAND_INVALID', 'Invalid course');
  courseId = value;
 }
 if(command==='resolve'&&args.length===0){
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? '';
  const result = courseId ? [await resolveCourseRevision(courseId, fetch, token)] : await resolveRevisions(fetch, token);
  process.stdout.write(JSON.stringify(result)+'\n');return;
 }
 if(command==='bind'&&args.length===2){
  let revisions:unknown;
  try{revisions=JSON.parse(await readFile(args[1]!,'utf8'));}
  catch{throw new SourceBindError('CI_BIND_INPUT_FAILED','Cannot read source revisions');}
  if (courseId && (!Array.isArray(revisions) || revisions.length !== 1 || revisions[0]?.courseId !== courseId)) throw new SourceBindError('CI_BIND_REVISIONS_INVALID', 'Wrong course selection');
  const result=courseId ? await bindCourseSource(process.cwd(),args[0]!, (revisions as Revision[])[0]!) : await bindSources(process.cwd(),args[0]!,revisions as Revision[]);
  process.stdout.write(JSON.stringify(result)+'\n');return;
 }
 throw new SourceBindError('CI_SOURCE_COMMAND_INVALID','Expected resolve or bind <appSha> <revisionsJsonPath>');
}
main().catch(error=>{process.stderr.write(formatSourceOperationDiagnostic(error));process.exitCode=1;});
