import { open, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';
import { verificationProject } from '../verification-project.js';
import { assertCurrentBundle } from '../runtime-server.js';
import { inventory } from './bootstrap.js';
import { writeReport, type BuildReport } from '../content/report.js';
import { bundleLimits } from '../content/preflight.js';
import { materialTypes, type Catalog } from '../../src/content/model.js';
import { validateSettings, settingsFingerprint, readIndependentIdentity, readPolicyDecision, verifyPolicyBoundNonDisclosure, type DeploymentSettings } from './access.js';
import { readAccessInspection, exactKeys, digest, canonical, sha256 } from './access-policy.js';
export type ProbeRow = { path: string; sha256: string; kind: 'catalog' | 'html' | 'nested-html' | 'image' | 'pdf' | 'font'; ownerExact: boolean; anonymousBlocked: boolean; otherBlocked: boolean };
export type HumanEvidence = { version: 1; checkedAt: string; settingsFingerprint: string; protectionFingerprint: string; ownerIdentityHash: string; otherIdentityHash: string; policyChecksHash: string; rows: ProbeRow[]; absentKinds: string[] };
export type DeviceAcceptance = { mobileConfirmedAt: string; pcConfirmedAt: string };
function fail(): never { throw Error('Invalid production human evidence'); }
export const hashValue = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const pathValue = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && !v.includes('\\') && !v.includes(':') && !v.includes('?') && !v.includes('#') && !v.includes('\0') && !v.startsWith('/') && v.split('/').every(s => !!s && s !== '.' && s !== '..');
const kinds: ProbeRow['kind'][] = ['catalog', 'html', 'nested-html', 'image', 'pdf', 'font'];
export function freshTime(value: unknown, now: number): boolean {
    if (typeof value !== 'string' || !Number.isFinite(now)) return false; const time = Date.parse(value);
    return Number.isFinite(time) && new Date(time).toISOString() === value && now - time >= 0 && now - time <= 86400000;
}
export function validateHumanEvidence(value: unknown): asserts value is HumanEvidence {
    exactKeys(value, ['version', 'checkedAt', 'settingsFingerprint', 'protectionFingerprint', 'ownerIdentityHash', 'otherIdentityHash', 'policyChecksHash', 'rows', 'absentKinds']);
    if (value.version !== 1 || typeof value.checkedAt !== 'string' || !Number.isFinite(Date.parse(value.checkedAt)) || ![value.settingsFingerprint, value.protectionFingerprint, value.ownerIdentityHash, value.otherIdentityHash, value.policyChecksHash].every(hashValue) || value.ownerIdentityHash === value.otherIdentityHash || !Array.isArray(value.rows) || !Array.isArray(value.absentKinds)) fail();
    const present: string[] = [], paths: string[] = [];
    for (const row of value.rows) { exactKeys(row, ['path', 'sha256', 'kind', 'ownerExact', 'anonymousBlocked', 'otherBlocked']); if (!pathValue(row.path) || !hashValue(row.sha256) || !kinds.includes(row.kind as ProbeRow['kind']) || row.ownerExact !== true || row.anonymousBlocked !== true || row.otherBlocked !== true) fail(); present.push(row.kind as string); paths.push(row.path); }
    const coverage = [...present, ...value.absentKinds];
    if (new Set(paths).size !== paths.length || coverage.length !== kinds.length || new Set(coverage).size !== kinds.length || coverage.some(k => !kinds.includes(k as ProbeRow['kind'])) || !present.includes('catalog') || !present.includes('html')) fail();
}
export function validateManifest(value: unknown): asserts value is BuildReport {
    exactKeys(value, ['createdAt', 'bundleHash', 'sources', 'inputs', 'outputs', 'issues']);
    if (typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) || !hashValue(value.bundleHash) || !Array.isArray(value.sources) || !value.sources.length || !Array.isArray(value.inputs) || !value.inputs.length || !Array.isArray(value.outputs) || !Array.isArray(value.issues)) fail();
    for (const source of value.sources) { exactKeys(source, ['courseId', 'commit', 'dirty', 'trackedPaths', 'explicitUntracked']); if (typeof source.courseId !== 'string' || !source.courseId || typeof source.commit !== 'string' || !/^[a-f0-9]{40}$/.test(source.commit) || typeof source.dirty !== 'boolean' || ![source.trackedPaths, source.explicitUntracked].every(a => Array.isArray(a) && a.every(pathValue))) fail(); }
    for (const input of value.inputs) { exactKeys(input, ['courseId', 'path', 'sha256']); if (typeof input.courseId !== 'string' || !input.courseId || !pathValue(input.path) || !hashValue(input.sha256)) fail(); }
    for (const output of value.outputs) { exactKeys(output, ['path', 'sha256', 'size']); if (!pathValue(output.path) || !hashValue(output.sha256) || !Number.isSafeInteger(output.size) || (output.size as number) <= 0) fail(); }
    for (const issue of value.issues) { exactKeys(issue, ['code', 'courseId', 'sourcePath', 'target', 'reason', 'severity']); if (Object.values(issue).some(v => typeof v !== 'string') || issue.severity !== 'warning') fail(); }
}
function validateCatalog(value: unknown): asserts value is Catalog {
    exactKeys(value, ['version', 'courses', 'groups', 'documents']);
    if (value.version !== 1 || ![value.courses, value.groups, value.documents].every(v => Array.isArray(v) && v.length <= bundleLimits.maxFiles)) fail();
    const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0 && !v.includes('\0');
    const courses = new Set<string>(), groups = new Map<string, string>(), groupPaths = new Set<string>(), documents = new Set<string>();
    for (const course of value.courses as unknown[]) {
        exactKeys(course, ['id', 'name', 'repo', 'semester']);
        if (!pathValue(course.id) || course.id.includes('/') || !text(course.name) || !text(course.repo) || course.semester !== '2026-2' || courses.has(course.id)) fail();
        courses.add(course.id);
    }
    for (const group of value.groups as unknown[]) {
        const required = ['id', 'courseId', 'title', 'sourcePath', 'kind', 'date', 'order'];
        exactKeys(group, [...required, 'description'], required);
        if (Object.hasOwn(group, 'description') && !text(group.description)) fail();
        if (!text(group.id) || !text(group.courseId) || !courses.has(group.courseId) || !text(group.title) || !pathValue(group.sourcePath) || !['date', 'experiment', 'supplement'].includes(group.kind as string) || (group.date !== null && !text(group.date)) || !Number.isSafeInteger(group.order) || (group.order as number) < 0 || groups.has(group.id)) fail();
        const key = group.courseId + '/' + group.sourcePath.normalize('NFC'); if (groupPaths.has(key)) fail();
        groups.set(group.id, group.courseId); groupPaths.add(key);
    }
    for (const document of value.documents as unknown[]) {
        exactKeys(document, ['id', 'courseId', 'groupId', 'title', 'type', 'sourcePath', 'url', 'listed']);
        if (!text(document.id) || documents.has(document.id) || !text(document.courseId) || !courses.has(document.courseId) || (document.groupId !== null && (!text(document.groupId) || groups.get(document.groupId) !== document.courseId)) || !text(document.title) || !(materialTypes as readonly string[]).includes(document.type as string) || !pathValue(document.sourcePath) || !text(document.url) || typeof document.listed !== 'boolean') fail();
        documents.add(document.id);
    }
}
async function representatives(dist: string, manifest: BuildReport) {
    const entry = manifest.outputs.find(f => f.path === 'catalog.json');
    if (!entry || entry.size > bundleLimits.maxFileBytes) fail();
    // Bound the read even if the file grows after inventory, and authenticate the
    // exact bytes used for classification rather than trusting parsed metadata.
    const file = await open(resolve(dist, 'catalog.json'), 'r'); let catalog: unknown;
    try {
        const bytes = Buffer.alloc(entry.size + 1); let length = 0;
        while (length < bytes.length) { const { bytesRead } = await file.read(bytes, length, bytes.length - length, length); if (!bytesRead) break; length += bytesRead; }
        if (length !== entry.size || sha256(bytes.subarray(0, length)) !== entry.sha256) fail();
        catalog = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length)));
    } finally { await file.close(); }
    validateCatalog(catalog);
    const paths = manifest.outputs.map(f => f.path).sort();
    const htmlByUrl = new Map(paths.filter(p => /^content\/.+\.html?$/i.test(p)).map(p => ['/' + p.split('/').map(encodeURIComponent).join('/'), p]));
    const listedByPath = new Map<string, boolean>();
    for (const document of catalog.documents) {
        // Never decode a catalog URL or use it to construct a filesystem path.
        const path = htmlByUrl.get(document.url); if (!path || listedByPath.has(path)) fail();
        const [, courseId, ...source] = path.split('/');
        if (courseId !== document.courseId || source.join('/') !== document.sourcePath.normalize('NFC')) fail();
        listedByPath.set(path, document.listed);
    }
    // App shell HTML is outside content/. Every material HTML must be classified;
    // an orphan is a provenance gap, never evidence that linked HTML is absent.
    if (listedByPath.size !== htmlByUrl.size) fail();
    const matches: Record<ProbeRow['kind'], (p: string) => boolean> = { catalog: p => p === 'catalog.json', html: p => listedByPath.get(p) === true, 'nested-html': p => listedByPath.get(p) === false, image: p => /\.(png|jpg|jpeg|gif|webp|svg|avif)$/i.test(p), pdf: p => /\.pdf$/i.test(p), font: p => /\.(woff2?|ttf|otf)$/i.test(p) };
    const selected: { path: string; kind: ProbeRow['kind'] }[] = [], absentKinds: string[] = [];
    for (const kind of kinds) { const path = paths.find(matches[kind]); if (path) selected.push({ path, kind }); else if (kind === 'catalog' || kind === 'html') fail(); else absentKinds.push(kind); }
    return { selected, absentKinds };
}
/** Production proof requires Access-specific terminal responses. A CDN cf-ray plus
 * generic origin "Access denied" is insufficient. Keep the legacy manual helper
 * unchanged, but filter every 403 before its trusted-flow and no-leak checks. */
async function productionNonDisclosure(request: Parameters<typeof verifyPolicyBoundNonDisclosure>[0], url: string, authDomain: string, expected: Uint8Array): Promise<boolean> {
    return verifyPolicyBoundNonDisclosure({
        get: async (target, options) => {
            const response = await request.get(target, options);
            if (response.status() === 403 && !/\bCloudflare Access\b/i.test(Buffer.from(await response.body()).toString('utf8'))) fail();
            return response;
        }
    }, url, authDomain, expected);
}
/** Local human sessions are consumed only here; no credential or identity body is persisted. */
export async function verifyProduction(settings: DeploymentSettings, manifest: BuildReport, ownerStatePath: string, otherStatePath: string): Promise<HumanEvidence> {
    try {
        const root = await verificationProject(), dist = resolve(root, 'dist'), report = resolve(root, '.reports/production-access-evidence.json');
        await writeReport({ passed: false, status: 'running', checkedAt: new Date().toISOString() }, report, [dist], root);
        validateSettings(settings); validateManifest(manifest);
        if (typeof ownerStatePath !== 'string' || !ownerStatePath || typeof otherStatePath !== 'string' || !otherStatePath || resolve(ownerStatePath) === resolve(otherStatePath)) fail();
        // Snapshot caller-owned objects so mutation cannot replace the authorization inputs.
        settings = structuredClone(settings); manifest = structuredClone(manifest);
        await assertCurrentBundle(dist, manifest, root);
        if (canonical(await inventory(dist)) !== canonical(manifest.outputs)) fail();
        const { selected, absentKinds } = await representatives(dist, manifest), initial = await readAccessInspection(settings), snapshot = initial.snapshot;
        const rows: ProbeRow[] = []; let ownerIdentityHash = '', otherIdentityHash = '', policyChecksHash = '';
        // Browser children need runtime settings, not the Node process's API/App credentials.
        const credentialKeys = new Set(['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_READ_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'STUDY_HUB_READER_PRIVATE_KEY', 'STUDY_HUB_DISPATCH_PRIVATE_KEY', 'STUDY_HUB_LEDGER_PRIVATE_KEY']);
        const browserEnv = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined && !credentialKeys.has(entry[0].toUpperCase())));
        const browser = await chromium.launch({ env: browserEnv });
        try {
            const owner = await browser.newContext({ storageState: resolve(ownerStatePath) }), other = await browser.newContext({ storageState: resolve(otherStatePath) }), anonymous = await browser.newContext();
            const ownerIdentity = await readIndependentIdentity(owner.request, snapshot.authDomain, settings.accountId, snapshot.otpProviderId), otherIdentity = await readIndependentIdentity(other.request, snapshot.authDomain, settings.accountId, snapshot.otpProviderId);
            if (ownerIdentity.email !== settings.allowedEmail || otherIdentity.email === settings.allowedEmail || ownerIdentity.userId === otherIdentity.userId) fail();
            const checks = async () => digest([await readPolicyDecision(settings, ownerIdentity, 'success'), await readPolicyDecision(settings, otherIdentity, 'fail')]);
            ownerIdentityHash = digest(ownerIdentity); otherIdentityHash = digest(otherIdentity); policyChecksHash = await checks();
            for (const { path, kind } of selected) {
                const expected = await readFile(resolve(dist, path)), sha = sha256(expected);
                if (sha !== manifest.outputs.find(f => f.path === path)!.sha256) fail();
                for (const host of snapshot.hosts) {
                    const url = host + '/' + path.split('/').map(encodeURIComponent).join('/');
                    const good = await owner.request.get(url, { maxRedirects: 0 }); if (good.status() !== 200 || !Buffer.from(await good.body()).equals(expected)) fail();
                    if (!await productionNonDisclosure(anonymous.request, url, snapshot.authDomain, expected)) fail();
                    if (!await productionNonDisclosure(other.request, url, snapshot.authDomain, expected)) fail();
                }
                rows.push({ path, sha256: sha, kind, ownerExact: true, anonymousBlocked: true, otherBlocked: true });
            }
            const finalOwner = await readIndependentIdentity(owner.request, snapshot.authDomain, settings.accountId, snapshot.otpProviderId), finalOther = await readIndependentIdentity(other.request, snapshot.authDomain, settings.accountId, snapshot.otpProviderId);
            if (digest(finalOwner) !== ownerIdentityHash || digest(finalOther) !== otherIdentityHash || await checks() !== policyChecksHash) fail();
        } finally { await browser.close(); }
        const current = await readAccessInspection(settings);
        if (current.protectionFingerprint !== initial.protectionFingerprint || current.workerId !== initial.workerId || current.versionId !== initial.versionId || current.snapshot.fingerprint !== initial.snapshot.fingerprint) fail();
        await assertCurrentBundle(dist, manifest, root); if (canonical(await inventory(dist)) !== canonical(manifest.outputs)) fail();
        const evidence: HumanEvidence = { version: 1, checkedAt: new Date().toISOString(), settingsFingerprint: settingsFingerprint(settings), protectionFingerprint: initial.protectionFingerprint, ownerIdentityHash, otherIdentityHash, policyChecksHash, rows, absentKinds };
        validateHumanEvidence(evidence); await writeReport(evidence, report, [dist], root); return evidence;
    } catch { throw Error('Production Access verification failed; evidence remains invalid'); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) void (async () => {
    if (process.argv.length !== 2) fail(); const root = await verificationProject();
    await writeReport({ passed: false, status: 'running' }, resolve(root, '.reports/production-access-evidence.json'), [resolve(root, 'dist')], root);
    const settings: unknown = JSON.parse(await readFile(resolve(root, '.local/deployment.json'), 'utf8')); validateSettings(settings);
    const manifest: unknown = JSON.parse(await readFile(resolve(root, '.reports/app-build.json'), 'utf8')); validateManifest(manifest);
    await verifyProduction(settings, manifest, resolve(root, '.local/auth/owner.json'), resolve(root, '.local/auth/other.json'));
    console.log('Production human Access evidence verified locally');
})().catch(() => { console.error('Production Access verification failed; evidence remains invalid'); process.exitCode = 1; });
