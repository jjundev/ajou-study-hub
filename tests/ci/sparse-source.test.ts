import { afterEach, expect, test } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
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
test.each([
 ['circuits-2', [
   '/workbook/pdf/ch11-문제.pdf', '/workbook/pdf/ch12-문제.pdf', '/workbook/pdf/ch13-문제.pdf',
   '/.claude/skills/ec2-problem-explain/assets/vendor/pretendard',
   '/.claude/skills/ec2-problem-explain/assets/vendor/katex',
 ]],
 ['data-structures', ['/자료구조_강의록_2026', '/실습', '/과제/과제2/HW2.pdf']],
 ['ml-basics', ['/강의노트', '/assets/vendor/pretendard', '/assets/vendor/katex']],
] as const)('selects the new approved source paths for %s', (id, paths) => {
 const course = courses.find(course => course.id === id)!;
 expect(sparsePatterns(course)).toEqual(expect.arrayContaining([...paths]));
});
test('Git checks out approved Korean paths with spaces and omits unrelated PDFs', async () => {
 root = await mkdtemp(join(tmpdir(), 'hub-sparse-git-'));
 const git = (...args: string[]) => execFileSync('git', args, {cwd: root});
 git('init', '-q');
 const approved = '강의노트/추가 강의/복습 자료.pdf';
 const excluded = '기타/미공개.pdf';
 await mkdir(join(root, '강의노트/추가 강의'), {recursive: true});
 await mkdir(join(root, '기타'), {recursive: true});
 await writeFile(join(root, approved), 'approved');
 await writeFile(join(root, excluded), 'excluded');
 git('add', '.');
 git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-qm', 'fixture');
 const course = courses.find(course => course.id === 'ml-basics')!;
 execFileSync('git', ['sparse-checkout', 'set', '--no-cone', '--stdin'], {
  cwd: root, input: sparsePatterns(course).join('\n') + '\n',
 });
 expect(await readFile(join(root, approved), 'utf8')).toBe('approved');
 await expect(readFile(join(root, excluded))).rejects.toMatchObject({code: 'ENOENT'});
 expect(git('show', 'HEAD:' + excluded).toString()).toBe('excluded');
});
test('trusted config alone supplies all five safe multiline action outputs',async()=>{
 root=await mkdtemp(join(tmpdir(),'hub-sparse-output-'));await mkdir(join(root,'outputs'));
 const output=join(root,'outputs','github');await writeSparseOutputs(output);
 const text=await readFile(output,'utf8');
 expect(text.match(/<<STUDY_HUB_SPARSE_END\n/g)).toHaveLength(5);
 for(const course of courses){const key=course.id.replaceAll('-','_');expect(text).toContain(key+'<<STUDY_HUB_SPARSE_END\n'+sparsePatterns(course).join('\n')+'\nSTUDY_HUB_SPARSE_END\n');}
 expect(text).not.toContain('/*');
});
