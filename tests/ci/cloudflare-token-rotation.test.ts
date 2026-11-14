import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { describe, expect, it, vi } from 'vitest';
import { rotateDeploymentTokens, rotationDue } from '../../tools/ci/cloudflare-token-rotation.js';

const day = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-11-14T10:00:00Z');
const expiry = (days: number) => new Date(now + days * day).toISOString();

describe('Cloudflare deployment token rotation', () => {
  it('rotates both tokens if either enters the seven-day renewal window', () => {
    expect(rotationDue([expiry(22), expiry(8)], now)).toBe(false);
    expect(rotationDue([expiry(22), expiry(7)], now)).toBe(true);
    expect(rotationDue([undefined, expiry(22)], now)).toBe(true);
  });

  function services() {
    const issue = vi.fn(async (role: 'read' | 'deploy') => ({role, value: 'new-' + role}));
    const verify = vi.fn(async () => {});
    const save = vi.fn(async () => {});
    return { issue, verify, save };
  }

  it('leaves healthy credentials alone until renewal or a forced run', async () => {
    const dependencies = services();
    expect(await rotateDeploymentTokens(dependencies, [expiry(22), expiry(8)], now)).toEqual({ rotated: false });
    expect(dependencies.issue).not.toHaveBeenCalled();
    expect(dependencies.save).not.toHaveBeenCalled();
    expect((await rotateDeploymentTokens(dependencies, [expiry(22), expiry(8)], now, true)).rotated).toBe(true);
  });

  it('issues and verifies the pair before storing either credential, returning no secrets', async () => {
    const dependencies = services();
    const result = await rotateDeploymentTokens(dependencies, [expiry(3), expiry(4)], now);
    expect(result).toEqual({rotated: true, expiresOn: expiry(30)});
    expect(dependencies.issue.mock.calls).toEqual([['read', expiry(30)], ['deploy', expiry(30)]]);
    expect(dependencies.verify).toHaveBeenCalledWith({role: 'read', value: 'new-read'}, expiry(30));
    expect(dependencies.verify).toHaveBeenCalledWith({role: 'deploy', value: 'new-deploy'}, expiry(30));
    expect(dependencies.save.mock.invocationCallOrder[0]).toBeGreaterThan(dependencies.verify.mock.invocationCallOrder[1]!);
  });

  it('preserves the current credentials if either replacement fails validation', async () => {
    const dependencies = services();
    dependencies.verify.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('verification failed'));
    await expect(rotateDeploymentTokens(dependencies, [expiry(3), expiry(4)], now)).rejects.toThrow('verification failed');
    expect(dependencies.save).not.toHaveBeenCalled();
  });

  it('schedules rotation on trusted main with a dedicated environment and no deployment credentials in the dispatch step', async () => {
    const workflow = parse(await readFile('.github/workflows/cloudflare-token-rotation.yml', 'utf8'));
    expect(workflow.on.schedule).toHaveLength(1);
    expect(workflow.jobs.rotate.if).toContain("github.ref == 'refs/heads/main'");
    expect(workflow.jobs.rotate.environment).toBe('cloudflare-token-rotation');
    const steps = workflow.jobs.rotate.steps;
    const rotation = steps.find((step: {id?: string}) => step.id === 'rotation');
    expect(rotation.env.CLOUDFLARE_ROTATION_TOKEN).toContain('secrets.');
    const dispatch = steps.at(-1);
    expect(dispatch.if).toContain('steps.rotation.outputs.rotated');
    expect(JSON.stringify(dispatch.env)).not.toContain('secrets.');
  });
});
