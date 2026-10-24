import { lstat, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

/** Only these verified flags may reach our fixed Vite configuration. */
export function parseAppArguments(command: string, args: string[]) {
  let sources = '.local/fixture-sources.json', explicitSources = false;
  const viteArgs: string[] = [];
  const values: Record<string, (value: string) => boolean> = {
    '--base': value => value.startsWith('/') && !value.startsWith('//'),
    ...(command === 'dev' ? {
      '--host': (value: string) => ['127.0.0.1', 'localhost'].includes(value),
      '--port': (value: string) => /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535,
    } : {}),
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--sources') {
      const value = args[++i];
      if (!value || value.startsWith('-') || explicitSources) throw Error('Invalid --sources argument');
      sources = value; explicitSources = true;
    } else if (command !== 'content:build' && Object.hasOwn(values, arg)) {
      const value = args[++i];
      if (!value || !values[arg]!(value)) throw Error(`Invalid Vite argument: ${arg}`);
      viteArgs.push(arg, value);
    } else if (command === 'dev' && arg === '--strictPort') viteArgs.push(arg);
    else throw Error(`Unsupported Vite argument: ${arg}`);
  }
  return { sources, explicitSources, viteArgs };
}
const contains = (root: string, path: string) => {
  const r = relative(root, path);
  return r === '' || (!isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep));
};
async function canonical(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(await canonical(parent), relative(parent, path));
  }
}
/** No deletion/copying may follow a junction, or overlap an original/settings path. */
export async function validateAppOutput(sourceRoots: string[], settingsPath?: string, projectDir = process.cwd()): Promise<string> {
  const output = resolve(projectDir, 'dist');
  let cursor = output;
  while (true) {
    try {
      const stat = await lstat(cursor);
      if (stat.isSymbolicLink()) throw Error(`Symlink app output or ancestor: ${cursor}`);
      if (!stat.isDirectory()) throw Error(`App output ancestor is not a directory: ${cursor}`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  const actualOutput = await canonical(output);
  if (actualOutput !== resolve(await realpath(projectDir), 'dist')) throw Error('App output is not owned dist');
  for (const root of sourceRoots) {
    const source = await canonical(resolve(root));
    if (contains(source, actualOutput) || contains(actualOutput, source)) throw Error('App output/source overlap');
  }
  if (settingsPath && contains(actualOutput, await canonical(resolve(settingsPath)))) throw Error('App output contains source settings');
  return output;
}
