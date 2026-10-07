/* eslint import/extensions: ["error", "ignorePackages", { "ts": "never" }] */
import { dolphin } from './dolphin';
import { ppsspp } from './ppsspp';
import { ComponentAdapter } from './types';

export const components: readonly ComponentAdapter[] = Object.freeze([
  dolphin,
  ppsspp,
]);

export function getComponent(id: string): ComponentAdapter {
  const component = components.find((entry) => entry.manifest.id === id);
  if (!component) throw new Error('Unknown component');
  return component;
}

export { checkCompatibility, validateManifest } from './schema';
export type {
  ComponentAdapter,
  ComponentManifest,
  LaunchPlan,
  LaunchRequest,
} from './types';
