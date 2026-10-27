import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sparsePatterns, writeSparseOutputs } from '../../tools/ci/sparse-source.js';
import { courses } from '../../config/courses.js';
let root='';
afterEach(async()=>{if(root)await rm(root,{recursive:true,force:true});root='';});
test('patterns preserve type-agnostic exact roots and minimize descendants without broadening',()=>{
 expect(sparsePatterns({allowedRoots:['복습노트','복습노트/nested','강의노트/추가 강의','literal[1].pdf','.hidden'],extraFiles:['복습노트/figure.svg']})).toEqual(['/복습노트','/강의노트/추가 강의','/literal\\[1\\].pdf','/.hidden']);
});
test.each(['../escape','/absolute','a/./b','a//b','a/.git/file','a\\b','a\nb','a\rb','a\tb','a ','C:/root','!bad\u0000'])('rejects unsafe sparse input %j',path=>{
 expect(()=>sparsePatterns({allowedRoots:[path],extraFiles:[]})).toThrow('CI_SPARSE_SELECTION_INVALID');
});
test('extra files cannot independently authorize an outside root',()=>{
 expect(()=>sparsePatterns({allowedRoots:['allowed'],extraFiles:['elsewhere/private.pdf']})).toThrow('CI_SPARSE_SELECTION_INVALID');
});
test('trusted config alone supplies all five safe multiline action outputs',async()=>{
 root=await mkdtemp(join(tmpdir(),'hub-sparse-output-'));await mkdir(join(root,'outputs'));
 const output=join(root,'outputs','github');await writeSparseOutputs(output);
 const text=await readFile(output,'utf8');
 expect(text.match(/<<STUDY_HUB_SPARSE_END\n/g)).toHaveLength(5);
 for(const course of courses){const key=course.id.replaceAll('-','_');expect(text).toContain(key+'<<STUDY_HUB_SPARSE_END\n'+sparsePatterns(course).join('\n')+'\nSTUDY_HUB_SPARSE_END\n');}
 expect(text).not.toContain('/*');
});
