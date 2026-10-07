import type { PinnedArtifact } from '../dolphin/download';
import type { ProcessRunner } from '../dolphin/install';
import { pinnedApp, readImageLicense } from '../shared/pinned-app';
import type {
  AppHealth,
  InstalledApp,
  PinnedInstallOptions,
} from '../shared/pinned-app';

/**
 * ES-DE is installed from one reviewed, pinned release. Its bundle identifier is
 * the version string, so every update is a deliberate manifest change: new URL,
 * size, hash and designated requirement, reviewed together.
 */
export const ESDE_RELEASE = Object.freeze({
  version: '3.5.0',
  artifact: Object.freeze({
    url: 'https://gitlab.com/es-de/emulationstation-de/-/package_files/357717468/download',
    bytes: 79383926,
    sha256: '060bd289fa17f8f07bac2eb688698047f7be79b80495983f08580b5f1a046e1e',
  }) as PinnedArtifact,
  bundleIdentifier: '3.5.0',
  teamIdentifier: 'K56UAA4SXL',
});

const esde = pinnedApp({
  id: 'esde',
  displayName: 'ES-DE',
  version: ESDE_RELEASE.version,
  artifact: ESDE_RELEASE.artifact,
  bundleName: 'ES-DE.app',
  executable: 'ES-DE',
  bundleIdentifier: ESDE_RELEASE.bundleIdentifier,
  teamIdentifier: ESDE_RELEASE.teamIdentifier,
  license: 'image',
});

export type InstalledFrontend = InstalledApp;
export type FrontendHealth = AppHealth;
export type EsdeInstallOptions = PinnedInstallOptions & {
  acceptLicense: NonNullable<PinnedInstallOptions['acceptLicense']>;
};

export const readLicense = readImageLicense;
export const verifyFrontend = (bundle: string, run?: ProcessRunner) =>
  esde.verify(bundle, run);
export const { installedVersion } = esde;
export const frontendHealth = esde.health;
export const installedFrontend = (root: string, run?: ProcessRunner) =>
  esde.installed(root, run);
export const installFrontend = (root: string, options: EsdeInstallOptions) =>
  esde.install(root, options);
