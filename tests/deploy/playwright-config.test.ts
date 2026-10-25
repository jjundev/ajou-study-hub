import { expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
it('omits Vite only for an unambiguous hosting-only selection', () => {
  for(const [args, hasServer] of [
    [['test','tests/e2e/hosting.spec.ts'],false],
    [['test','tests/e2e/access.spec.ts'],false],
    [['test','tests/e2e/hosting.spec.ts','tests/e2e/reader.spec.ts'],true],
    [['test'],true],
    [['test','tests/e2e/hosting.spec.ts','--workers=1'],true],
    [['test','hosting|reader'],true],
  ] as [string[],boolean][]) {
    const code = `process.argv=['node','playwright',...${JSON.stringify(args)}]; const {default:config}=await import('./playwright.config.ts'); console.log(Boolean(config.webServer));`;
    const run = spawnSync(process.execPath,['--import',pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href,'--input-type=module','-e',code],{encoding:'utf8'});
    expect(run.status,run.stderr).toBe(0); expect(run.stdout.trim()).toBe(String(hasServer));
  }
},30000);
