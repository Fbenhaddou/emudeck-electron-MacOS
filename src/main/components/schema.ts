/* eslint import/extensions: ["error", "ignorePackages", { "ts": "never" }] */
import path from 'path';
import {
  ComponentManifest,
  FolderGameSpec,
  HostCapabilities,
  TrustPolicy,
} from './types';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Expected object');
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): void {
  if (
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error('Unknown or missing manifest fields');
}

function string(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.length ||
    [...value].some((character) => character.charCodeAt(0) < 32)
  )
    throw new Error('Invalid text');
  return value;
}

function strings(
  value: unknown,
  pattern: RegExp,
  allowEmpty = false,
): readonly string[] {
  if (
    !Array.isArray(value) ||
    (!value.length && !allowEmpty) ||
    value.some((item) => typeof item !== 'string' || !pattern.test(item)) ||
    new Set(value).size !== value.length
  )
    throw new Error('Invalid list');
  return Object.freeze([...value]);
}

// One to four plain segments: no absolute paths, no '.', '..' or hidden names.
const MARKER =
  /^[A-Za-z0-9_][A-Za-z0-9_.-]*(\/[A-Za-z0-9_][A-Za-z0-9_.-]*){0,3}$/;

function folderGame(input: unknown): FolderGameSpec {
  const value = record(input);
  exactKeys(value, ['markers', 'launchTarget', 'companionSuffixes']);
  const markers = strings(value.markers, MARKER);
  if (markers.length > 8) throw new Error('Too many folder game markers');
  const launchTarget = string(value.launchTarget);
  if (!markers.includes(launchTarget))
    throw new Error('Launch target must be a marker');
  return Object.freeze({
    markers,
    launchTarget,
    companionSuffixes: strings(
      value.companionSuffixes,
      /^-[A-Za-z0-9]+$/,
      true,
    ),
  });
}

export function validateManifest(
  input: unknown,
  policy: TrustPolicy,
): ComponentManifest {
  const value = record(input);
  const hasFolderGame = value.folderGame !== undefined;
  exactKeys(value, [
    ...(hasFolderGame ? ['folderGame'] : []),
    'schemaVersion',
    'id',
    'name',
    'systems',
    'platform',
    'architecture',
    'minimumOS',
    'homepage',
    'releasePage',
    'license',
    'bundleName',
    'executable',
    'romExtensions',
    'capabilities',
  ]);
  if (value.schemaVersion !== 1 || value.platform !== 'darwin')
    throw new Error('Unsupported schema or platform');
  if (!['arm64', 'x64', 'universal'].includes(string(value.architecture)))
    throw new Error('Unsupported architecture');
  if (!/^\d+\.\d+(\.\d+)?$/.test(string(value.minimumOS)))
    throw new Error('Invalid OS version');
  if (
    value.id !== policy.id ||
    value.bundleName !== policy.bundleName ||
    value.executable !== policy.executable
  )
    throw new Error('Untrusted component identity or executable');
  if (!/^[a-z][a-z0-9-]*$/.test(string(value.id)))
    throw new Error('Invalid identity');
  const executable = string(value.executable);
  if (
    path.posix.isAbsolute(executable) ||
    executable
      .split('/')
      .some((part) => !part || part === '.' || part === '..') ||
    executable.includes('\\')
  )
    throw new Error('Invalid executable path');
  const bundleName = string(value.bundleName);
  if (!/^[A-Za-z0-9 -]+\.app$/.test(bundleName))
    throw new Error('Invalid bundle name');
  const urls = ['homepage', 'releasePage'].map((key) => {
    const raw = string(value[key]);
    const url = new URL(raw);
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      url.hash ||
      !policy.urls.includes(raw)
    )
      throw new Error('Untrusted URL');
    return raw;
  });
  const capabilities = record(value.capabilities);
  exactKeys(capabilities, [
    'installation',
    'configuration',
    'launch',
    'frontend',
  ]);
  if (
    capabilities.installation !== 'planned' ||
    capabilities.configuration !== 'planned' ||
    capabilities.launch !== 'plan-only' ||
    capabilities.frontend !== 'planned'
  )
    throw new Error('Unsupported capability');
  return Object.freeze({
    schemaVersion: 1,
    id: string(value.id),
    name: string(value.name),
    systems: strings(value.systems, /^[a-z][a-z0-9-]*$/),
    platform: 'darwin',
    architecture: value.architecture as ComponentManifest['architecture'],
    minimumOS: string(value.minimumOS),
    homepage: urls[0],
    releasePage: urls[1],
    license: string(value.license),
    bundleName,
    executable,
    romExtensions: strings(value.romExtensions, /^\.[a-z0-9]+$/, hasFolderGame),
    ...(hasFolderGame ? { folderGame: folderGame(value.folderGame) } : {}),
    capabilities: Object.freeze({
      installation: 'planned',
      configuration: 'planned',
      launch: 'plan-only',
      frontend: 'planned',
    }),
  });
}

export function checkCompatibility(
  manifest: ComponentManifest,
  host: HostCapabilities,
): { compatible: boolean; reason?: string } {
  if (host.platform !== manifest.platform)
    return { compatible: false, reason: 'Requires macOS' };
  if (
    !['arm64', 'x64'].includes(host.architecture) ||
    (manifest.architecture !== 'universal' &&
      manifest.architecture !== host.architecture)
  )
    return {
      compatible: false,
      reason: 'No native artifact for this architecture',
    };
  if (!/^\d+\.\d+(\.\d+)?$/.test(host.osVersion))
    return { compatible: false, reason: 'Cannot verify macOS version' };
  const current = host.osVersion.split('.').map(Number);
  const minimum = manifest.minimumOS.split('.').map(Number);
  const different = [0, 1, 2].find(
    (index) => (current[index] || 0) !== (minimum[index] || 0),
  );
  if (
    different !== undefined &&
    (current[different] || 0) < (minimum[different] || 0)
  )
    return {
      compatible: false,
      reason: `Requires macOS ${manifest.minimumOS} or later`,
    };
  return { compatible: true };
}

/** Lexical validation only. The executor must separately verify realpaths and volume identity. */
export function absolutePath(value: string): string {
  if (
    !value ||
    [...value].some((character) => character.charCodeAt(0) < 32) ||
    !path.posix.isAbsolute(value) ||
    value.split('/').some((part) => part === '..' || part === '.') ||
    value.includes('\\')
  )
    throw new Error('Expected an absolute path without traversal');
  return path.posix.normalize(value);
}
