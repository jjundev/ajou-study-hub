import { describe, expect, it } from 'vitest';
import { transformHtml, storageNamespace } from '../../tools/content/transform.js';
import type { DocumentInfo } from '../../src/content/model.js';
const doc: DocumentInfo = {id:'doc',courseId:'course',groupId:'group',title:'</script>',type:'note',sourcePath:'notes/a.html',url:'/content/a',listed:true};
describe('document bootstrap', () => {
 it('inserts before scripts without serializing the original HTML', () => {
 const original = '<!DOCTYPE html><html><head><!-- keep --><script>window.original=true</script></head></html>';
 const result = transformHtml(original, doc, 'window.ready=true;');
 expect(result.indexOf('window.ready')).toBeLessThan(result.indexOf('window.original'));
 expect(result).toContain('<!-- keep -->');
 expect(result).not.toContain('"title":"</script>"');
 expect(result.replace(/<script data-study-hub>[\s\S]*?<\/script>/, '')).toBe(original);
 });
 it('uses groups or stable parent identities', () => {
 expect(storageNamespace(doc)).toBe('study-hub:v1:course:group:');
 expect(storageNamespace({...doc,groupId:null})).toBe(storageNamespace({...doc,groupId:null,sourcePath:'notes/b.html'}));
 expect(storageNamespace({...doc,groupId:null,sourcePath:'other/b.html'})).not.toBe(storageNamespace({...doc,groupId:null}));
 });
});
