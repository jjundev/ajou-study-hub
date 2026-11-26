import { expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { courses } from '../../config/courses.js';
import { selectUpdateLane } from '../../tools/ci/update-lane.js';

test('selects only the notified course at the active migration stage', () => {
  const input = { event: 'workflow_dispatch' as const, mode: 'default' as const };
  const biology = courses.find(course => course.id === 'life-science')!;
  expect(selectUpdateLane({ ...input, profile: 'pilot', sourceRepository: biology.repo }))
    .toEqual({ kind: 'course', courseId: 'life-science', verifyOnly: false });
  for (const course of courses) {
    expect(selectUpdateLane({ ...input, profile: 'all', sourceRepository: course.repo, mode: 'verify' }))
      .toEqual({ kind: 'course', courseId: course.id, verifyOnly: true });
    if (course.id !== biology.id) expect(selectUpdateLane({ ...input, profile: 'pilot', sourceRepository: course.repo }))
      .toEqual({ kind: 'hub', sourceMode: 'legacy-bundle', verifyOnly: false });
  }
  expect(selectUpdateLane({ ...input, profile: 'all' })).toEqual({ kind: 'hub', sourceMode: 'ui-only', verifyOnly: false });
  expect(selectUpdateLane({ ...input, profile: 'legacy' })).toEqual({ kind: 'legacy', verifyOnly: false });
  expect(() => selectUpdateLane({ ...input, profile: 'all', sourceRepository: 'jjundev/untrusted' })).toThrow();
});

test('course workflow scopes concurrency, checkout and publishing credentials', async () => {
  const workflow = parse(await readFile('.github/workflows/study-hub-course-worker.yml', 'utf8'));
  const job = workflow.jobs.course;
  expect(job.concurrency.group).toContain('inputs.course_id');
  expect(job.steps.find((step: any) => step.id === 'reader').with.repositories).toBe('${{ steps.selection.outputs.repository_name }}');
  const revoke = job.steps.findIndex((step: any) => step.id === 'revoke-reader');
  expect(revoke).toBeLessThan(job.steps.findIndex((step: any) => step.id === 'verify-course'));
  const writes = job.steps.filter((step: any) => JSON.stringify(step.env ?? {}).includes('secrets.CLOUDFLARE_API_TOKEN'));
  expect(writes.map((step: any) => step.id)).toEqual(['publish-course']);
  expect(writes[0].if).toContain('!inputs.verify_only');
});
