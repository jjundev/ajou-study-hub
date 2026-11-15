import { createHash } from 'node:crypto';

export type TransformRequest = { path: string; key: string };
export type TransformEntry = { key: string; sha256: string; size: number };
export type TransformBuild = {
  appSha: string;
  restore?: (requests: readonly TransformRequest[]) => Promise<ReadonlyMap<string, Uint8Array>>;
};

export function documentTransformKey(input: {
  appSha: string;
  path: string;
  kind: 'html' | 'css';
  sourceHash: string;
  injectionHash?: string;
}): string {
  const { appSha, path, kind, sourceHash, injectionHash } = input;
  return createHash('sha256').update(JSON.stringify([
    1, appSha, path.normalize('NFC'), kind, sourceHash, injectionHash ?? null,
  ])).digest('hex');
}
