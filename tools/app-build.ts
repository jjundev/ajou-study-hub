import { createHash } from 'node:crypto';
import type { BuildReport } from './content/report.js';
import { applyHosting, inventory } from './deploy/bootstrap.js';

export async function finishAppBuild(directory: string, content: BuildReport): Promise<BuildReport> {
  await applyHosting(directory);
  const outputs = await inventory(directory);
  const bundleHash = createHash('sha256').update(outputs.map(file => `${file.path}\0${file.sha256}\n`).join('')).digest('hex');
  return { ...content, createdAt: new Date().toISOString(), outputs, bundleHash };
}
