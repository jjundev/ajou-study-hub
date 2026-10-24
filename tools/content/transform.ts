import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { parse } from 'parse5';
import type { DocumentInfo } from '../../src/content/model.js';

export function storageNamespace(doc:DocumentInfo):string {
 const parent=posix.dirname(doc.sourcePath.replaceAll('\\','/')).normalize('NFC');
 const group=doc.groupId??`parent-${createHash('sha256').update(`${doc.courseId}:${parent}`).digest('hex')}`;
 return `study-hub:v1:${doc.courseId}:${group}:`;
}

/** Offset insertion preserves every original character, including malformed HTML. */
export function transformHtml(html:string, doc:DocumentInfo, bootstrap:string):string {
 const tree=parse(html,{sourceCodeLocationInfo:true});
 let firstScript:number|undefined;
 let headEnd:number|undefined;
 function visit(node:any):void {
  if(node.tagName==='script' && node.sourceCodeLocation) firstScript=Math.min(firstScript??Infinity,node.sourceCodeLocation.startOffset);
  if(node.tagName==='head' && node.sourceCodeLocation?.startTag)headEnd=node.sourceCodeLocation.startTag.endOffset;
  for(const child of node.childNodes??[])visit(child);
 }
 visit(tree);
 const offset=firstScript??headEnd??(/<!doctype[^>]*>/i.exec(html)?.[0].length??0);
 const metadata=JSON.stringify({document:doc,namespace:storageNamespace(doc)}).replaceAll('<','\\u003c').replaceAll('\u2028','\\u2028').replaceAll('\u2029','\\u2029');
 // Escape HTML's raw-text closing token without changing JavaScript semantics.
 const safeBootstrap=bootstrap.replace(/<\/script/gi,'<\\/script');
 const injection=`<script data-study-hub>window.__STUDY_HUB__=${metadata};\n${safeBootstrap}\n</script>`;
 return html.slice(0,offset)+injection+html.slice(offset);
}
