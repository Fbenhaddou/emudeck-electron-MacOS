import fs from 'fs/promises';
import type {
  ControllersStatus,
  LibraryOverview,
  MacStatus,
} from '../../shared/macos';

/** Structured, path-free event: a name plus states and outcomes only. */
export type DiagnosticEvent = { event: string } & Record<string, unknown>;

const maxEvents = 200;
const events: { at: string; entry: DiagnosticEvent }[] = [];

/**
 * Records an event in the in-memory log (never written to disk on its own) and
 * mirrors it to stderr for development runs.
 */
export function diagnosticEvent(
  entry: DiagnosticEvent,
  write: (line: string) => void = (line) => {
    process.stderr.write(line);
  },
  now: Date = new Date(),
): void {
  events.push({ at: now.toISOString(), entry });
  if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
  write(`${JSON.stringify(entry)}\n`);
}

export function recentEvents(): { at: string; entry: DiagnosticEvent }[] {
  return events.map((item) => ({ at: item.at, entry: { ...item.entry } }));
}

export function clearEvents(): void {
  events.length = 0;
}

export interface ScrubContext {
  /** Exact values replaced with a placeholder, longest first. */
  secrets: { value: string; placeholder: string }[];
}

// Paths may contain spaces, so redaction runs to the end of the quoted segment or line.
const absolutePath =
  /\/(?:Users|Volumes|private|var|tmp|Applications|Library|System|opt|home)\b[^"'\n]*/g;
const pathTail = /(<(?:home|library|app-data)>)\/[^"'\n]*/g;
const email = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const longHex = /\b[0-9a-f]{32,}\b/gi;

/** Removes personal values from one string. */
export function scrubText(text: string, context: ScrubContext): string {
  // Emails first, so an account name inside one cannot leave its domain behind.
  let result = text.replace(email, '<email>');
  [...context.secrets]
    .filter((secret) => secret.value.length >= 2)
    .sort((a, b) => b.value.length - a.value.length)
    .forEach((secret) => {
      // Paths match anywhere; names match only as whole words ("ab" ≠ "tab").
      const escaped = secret.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pattern = secret.value.includes('/')
        ? new RegExp(escaped, 'g')
        : new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'giu');
      result = result.replace(pattern, () => secret.placeholder);
    });
  return result
    .replace(pathTail, '$1/…')
    .replace(absolutePath, '<path>')
    .replace(longHex, '<id>')
    .slice(0, 500);
}

/** Deep copy with every string scrubbed; bounded depth and size. */
export function scrubValue(
  value: unknown,
  context: ScrubContext,
  depth = 0,
): unknown {
  if (depth > 8) return '<omitted>';
  if (typeof value === 'string') return scrubText(value, context);
  if (value === null || typeof value === 'number' || typeof value === 'boolean')
    return value;
  if (Array.isArray(value))
    return value
      .slice(0, maxEvents)
      .map((item) => scrubValue(item, context, depth + 1));
  if (typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 64)
        .map(([key, item]) => [
          scrubText(key, context),
          scrubValue(item, context, depth + 1),
        ]),
    );
  return '<omitted>';
}

export interface DiagnosticsInput {
  status: MacStatus;
  overview: LibraryOverview;
  controllers: ControllersStatus | null;
  events: { at: string; entry: DiagnosticEvent }[];
  context: ScrubContext;
  now: Date;
}

/**
 * Builds the report from an explicit allowlist of fields. Library paths,
 * file names, controller names and account names are never copied; every
 * remaining string is scrubbed again as a second line of defence.
 */
export function buildDiagnostics(input: DiagnosticsInput) {
  const { status, overview, controllers } = input;
  const report = {
    format: 'emulation-workspace-diagnostics',
    formatVersion: 1,
    created: input.now.toISOString(),
    app: {
      version: status.appVersion,
      platform: status.platform,
      architecture: status.architecture,
      osVersion: status.osVersion,
      memoryGiB: Math.round(status.memoryBytes / 1024 ** 3),
      displays: status.displays.map((display) => ({
        width: display.width,
        height: display.height,
        scaleFactor: display.scaleFactor,
        refreshRate: display.refreshRate,
        hdr: display.hdr,
      })),
    },
    library: {
      selected: Boolean(status.library),
      available: Boolean(status.library?.available),
      settingsError: Boolean(status.libraryError),
    },
    emulators: [
      {
        id: 'dolphin',
        version: status.dolphin.version,
        operation: status.dolphin.operation,
      },
      ...status.emulators.map((emulator) => ({
        id: emulator.id,
        version: emulator.version,
        health: emulator.health,
        operation: emulator.operation,
      })),
    ],
    console: {
      frontendState: status.console.frontendState,
      frontendVersion: status.console.frontend,
      state: status.console.state,
      lastError: status.console.lastError,
    },
    systems: overview.systems.map((system) => ({
      id: system.id,
      installed: system.installed,
      games: system.games,
    })),
    firmware: overview.firmware.map((item) => ({
      id: item.id,
      required: item.required,
      state: item.state,
      detail: item.detail,
    })),
    controllers: controllers && {
      connected: controllers.controllers.map((pad) => ({
        kind: pad.kind,
        battery: pad.battery,
        charging: pad.charging,
        haptics: pad.haptics,
        motion: pad.motion,
      })),
      steamInput: controllers.steamInput,
      stickResponse: controllers.stickResponse,
      dolphinControls: controllers.dolphinControls,
    },
    events: input.events,
  };
  return scrubValue(report, input.context) as typeof report;
}

/** Writes owner-only; the save panel already confirmed any replacement. */
export async function writeDiagnostics(
  file: string,
  report: unknown,
): Promise<void> {
  await fs.writeFile(file, `${JSON.stringify(report, null, 2)}\n`, {
    mode: 0o600,
  });
}
