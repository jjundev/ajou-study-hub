import { spawn } from 'node:child_process';
import { appendFile } from 'node:fs/promises';

type Role = 'read' | 'deploy';
type Token = { role: Role; value: string };
type Rotation = {
  issue: (role: Role, expiresOn: string) => Promise<Token>;
  verify: (token: Token, expiresOn: string) => Promise<void>;
  save: (token: Token) => Promise<void>;
};

const day = 24 * 60 * 60 * 1000;
const hexId = /^[0-9a-f]{32}$/;
const roles = ['read', 'deploy'] as const;
const secretNames = {
  read: 'CLOUDFLARE_READ_TOKEN',
  deploy: 'CLOUDFLARE_API_TOKEN',
};
const repo = 'jjundev/ajou-study-hub';

export function rotationDue(expirations: (string | undefined)[], now: number): boolean {
  return expirations.some(expiry => !expiry || !(Date.parse(expiry) > now + 7 * day));
}

export async function rotateDeploymentTokens(
  services: Rotation, expirations: (string | undefined)[], now: number, force = false,
) {
  if (!force && !rotationDue(expirations, now)) return { rotated: false } as const;
  const expiresOn = new Date(Math.floor((now + 30 * day) / 1000) * 1000).toISOString();
  const tokens = [];
  for (const role of roles) tokens.push(await services.issue(role, expiresOn));
  for (const token of tokens) await services.verify(token, expiresOn);
  // Old and new tokens can coexist. If one write fails, the next check sees the older expiry.
  for (const token of tokens) await services.save(token);
  return { rotated: true, expiresOn } as const;
}

function fail(step: string): never {
  throw new Error(step);
}

function record(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('CF_ROTATION_INVALID_RESPONSE');
  return data as Record<string, unknown>;
}

async function cloudflare(token: string, path: string, step: string, body?: object, allowInactive = false) {
  try {
    const response = await fetch('https://api.cloudflare.com/client/v4' + path, {
      method: body ? 'POST' : 'GET',
      headers: { Authorization: 'Bearer ' + token, ...(body && { 'Content-Type': 'application/json' }) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (allowInactive && [401, 403].includes(response.status)) return undefined;
    const data = record(await response.json());
    if (allowInactive && Array.isArray(data.errors) && data.errors.some(entry => record(entry).code === 1000) &&
        (response.status === 400 || response.ok)) return undefined;
    if (!response.ok || data.success !== true || !('result' in data) ||
        (Array.isArray(data.errors) && data.errors.length)) fail(step + '_HTTP_' + response.status);
    return data.result;
  } catch (error) {
    const suffix = error instanceof Error && new RegExp('^' + step + '_HTTP_[1-5][0-9]{2}$').test(error.message)
      ? error.message : step;
    fail(suffix);
  }
}

async function verifyToken(token: string, path: string): Promise<string | undefined> {
  const result = await cloudflare(token, path, 'CF_ROTATION_TOKEN_VERIFY', undefined, true);
  if (result === undefined) return undefined;
  const status = record(result);
  return status.status === 'active' && typeof status.expires_on === 'string' ? status.expires_on : undefined;
}

function saveSecret(token: Token, ghToken: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const error = new Error('CF_ROTATION_SECRET_WRITE_' + token.role.toUpperCase());
    const child = spawn('gh', ['secret', 'set', secretNames[token.role], '-R', repo], {
      env: { PATH: process.env.PATH, GH_TOKEN: ghToken, GH_PROMPT_DISABLED: '1' },
      stdio: ['pipe', 'ignore', 'ignore'],
      timeout: 30_000,
    });
    child.on('error', () => reject(error));
    child.stdin.on('error', () => reject(error));
    child.on('close', code => code === 0 ? resolve() : reject(error));
    child.stdin.end(token.value);
  });
}

async function run() {
  const env = process.env;
  const account = env.CLOUDFLARE_ROTATION_ACCOUNT_ID;
  const issuer = env.CLOUDFLARE_ROTATION_TOKEN;
  const gitHub = env.GH_TOKEN;
  if (!account || !hexId.test(account) || !issuer || !gitHub || !env.GITHUB_OUTPUT)
    fail('CF_ROTATION_CONFIGURATION');
  const base = '/accounts/' + account;
  const verifyPath = base + '/tokens/verify';
  function verifyExpiry(token: string) {
    // The initial credentials predate account-owned rotation.
    return verifyToken(token, token.startsWith('cfut_') ? '/user/tokens/verify' : verifyPath);
  }
  const issuerExpiry = await verifyToken(issuer, verifyPath);
  const now = Date.now();
  if (!issuerExpiry || !(Date.parse(issuerExpiry) > now)) fail('CF_ROTATION_ISSUER_INACTIVE');
  if (Date.parse(issuerExpiry) <= now + 30 * day)
    console.log('::warning::The Cloudflare token issuer expires within 30 days. Replace CLOUDFLARE_ROTATION_TOKEN.');
  const current = await Promise.all(roles.map(role => {
    const token = env[secretNames[role]];
    return token ? verifyExpiry(token) : undefined;
  }));

  type Policy = { effect: 'allow'; resources: object; permission_groups: { id: string }[] };
  const accountScope = 'com.cloudflare.api.account';
  const zoneScope = accountScope + '.zone';
  const accountResource = accountScope + '.' + account;
  const groupIds = await (async () => {
    if (env.FORCE_ROTATION !== 'true' && !rotationDue(current, now)) return undefined;
    const entries = await cloudflare(issuer, base + '/tokens/permission_groups', 'CF_ROTATION_PERMISSION_GROUPS');
    if (!Array.isArray(entries)) return fail('CF_ROTATION_PERMISSION_GROUPS_INVALID');
    return (names: string[], scope: string) => names.map(name => {
      const matches = entries.map(record).filter(entry => entry.name === name && Array.isArray(entry.scopes) &&
        entry.scopes.includes(scope) && entry.is_selectable !== false);
      const id = matches[0]?.id;
      if (matches.length !== 1 || typeof id !== 'string' || !hexId.test(id))
        return fail('CF_ROTATION_MISSING_PERMISSION_' + name.toUpperCase().replaceAll(/[^A-Z0-9]+/g, '_'));
      return { id };
    });
  })();

  const result = await rotateDeploymentTokens({
    async issue(role, expiresOn) {
      if (!groupIds) return fail('CF_ROTATION_PERMISSION_GROUPS_INVALID');
      const policies: Policy[] = [{
        effect: 'allow',
        resources: { [accountResource]: '*' },
        permission_groups: groupIds(
          role === 'read' ? ['Workers Scripts Read', 'Account Settings Read'] : ['Workers Scripts Write'],
          accountScope,
        ),
      }];
      if (role === 'read') policies.push({
        effect: 'allow',
        resources: { [accountResource]: { [zoneScope + '.*']: '*' } },
        permission_groups: groupIds(['Zone Read', 'Workers Routes Read'], zoneScope),
      });
      const timestamp = new Date(now).toISOString().replaceAll(/[^0-9]/g, '').slice(0, 14);
      const issued = record(await cloudflare(issuer, base + '/tokens', 'CF_ROTATION_ISSUE_' + role.toUpperCase(), {
        name: 'ajou-study-hub-public-' + role + '-' + timestamp,
        expires_on: expiresOn,
        policies,
      }));
      if (typeof issued.value !== 'string' || !/^[a-zA-Z0-9_-]{20,512}$/.test(issued.value))
        return fail('CF_ROTATION_INVALID_NEW_TOKEN');
      return { role, value: issued.value };
    },
    async verify(token, expiresOn) {
      if (Date.parse(await verifyToken(token.value, verifyPath) ?? '') !== Date.parse(expiresOn))
        fail('CF_ROTATION_INVALID_NEW_TOKEN_EXPIRY');
      await cloudflare(token.value, base + '/workers/scripts/ajou-study-hub/deployments', 'CF_ROTATION_WORKER_PROBE');
      if (token.role === 'read') {
        await cloudflare(token.value, '/zones?account.id=' + account + '&per_page=5', 'CF_ROTATION_ZONES_PROBE');
      }
    },
    save: token => saveSecret(token, gitHub),
  }, current, now, env.FORCE_ROTATION === 'true');
  await appendFile(env.GITHUB_OUTPUT, 'rotated=' + result.rotated + '\n');
  const summary = result.rotated ? 'Both deployment tokens rotated. New expiry ' + result.expiresOn :
    'Both deployment tokens are valid beyond the seven-day renewal window.';
  if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, summary + '\n');
  console.log(summary);
}

if (import.meta.main) {
  await run().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : '';
    console.error(/^CF_ROTATION_[A-Z0-9_]+$/.test(message) ? message : 'CF_ROTATION_FAILED');
    process.exitCode = 1;
  });
}
