import { app } from 'electron';
import { lstatSync } from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { createConsole, registerConsoleHandlers } from './app/console';
import { createContext } from './app/context';
import {
  createControllers,
  registerControllerHandlers,
} from './app/controllers';
import registerDiagnosticsHandlers from './app/diagnostics';
import { createEmulators, registerEmulatorHandlers } from './app/emulators';
import registerFirmwareHandlers from './app/firmware';
import { libraryOverview, registerLibraryHandlers } from './app/library';
import { createSaves, registerSavesHandlers } from './app/saves';
import statusReader from './app/status';
import { startApplication } from './app/window';
import SmokeHarness from './smoke';

app.setName('Emulation Workspace');
// Attribution lives in the About panel, as in other Mac apps, not in window chrome.
app.setAboutPanelOptions({
  applicationName: 'Emulation Workspace',
  credits:
    'Development Preview. Built on EmuDeck. An independent project; not an official EmuDeck or RetroDECK product.',
});
app.setPath(
  'userData',
  path.join(app.getPath('appData'), 'Emulation Workspace'),
);
const smokeDirectory = process.env.EMULATION_SMOKE_DIR;
const interactiveTest = process.env.EMULATION_SMOKE_INTERACTIVE === '1';
if (smokeDirectory) {
  const temporaryRoot = path.resolve(os.tmpdir());
  const candidate = path.resolve(smokeDirectory);
  // The automated harness fabricates receipts, so it stays in the temporary
  // folder. Interactive testing installs real components and needs a profile
  // macOS will not purge: any existing, owner-only-writable real folder.
  const status = interactiveTest
    ? lstatSync(candidate, { throwIfNoEntry: false })
    : undefined;
  const permanentProfile = Boolean(
    status?.isDirectory() &&
    !status.isSymbolicLink() &&
    status.uid === process.getuid?.() &&
    // eslint-disable-next-line no-bitwise -- Permission bits.
    (status.mode & 0o022) === 0,
  );
  if (
    !path.isAbsolute(smokeDirectory) ||
    (!candidate.startsWith(`${temporaryRoot}${path.sep}`) && !permanentProfile)
  ) {
    throw new Error(
      'EMULATION_SMOKE_DIR must be inside the system temporary directory, or for interactive testing an existing folder you own that others cannot write.',
    );
  }
  app.setPath('userData', path.join(candidate, 'user-data'));
}

// Interactive native review keeps the same isolated test data and real bridge,
// but lets the reviewer control the window instead of running synthetic captures.
const smoke =
  smokeDirectory && !interactiveTest ? new SmokeHarness(smokeDirectory) : null;

const context = createContext({
  userData: app.getPath('userData'),
  rendererURL:
    process.env.NODE_ENV === 'development'
      ? `http://localhost:${process.env.PORT || 1212}/index.html`
      : pathToFileURL(path.join(__dirname, '../renderer/index.html')).href,
  // Packaged helpers ship in Resources/helpers; development uses the native build.
  helpers: app.isPackaged
    ? path.join(process.resourcesPath, 'helpers')
    : path.resolve(app.getAppPath(), '..', 'native'),
});
const emulators = createEmulators(context);
const saves = createSaves(context, emulators);
const consoleMode = createConsole(context, emulators, saves);
const controllers = createControllers(context);
const getStatus = statusReader(context, emulators, consoleMode);
const overview = libraryOverview(context, emulators);

registerEmulatorHandlers(context, emulators, saves);
registerSavesHandlers(context, emulators, saves);
registerConsoleHandlers(context, consoleMode, emulators);
registerControllerHandlers(context, controllers, saves);
registerLibraryHandlers(context, emulators, overview);
registerFirmwareHandlers(context, emulators);
registerDiagnosticsHandlers(context, {
  status: getStatus,
  overview,
  controllers: controllers.status,
});
context.handle('mac:status', getStatus);

startApplication(context, {
  smoke,
  getStatus,
  refreshBusy: () => emulators.manager.status(),
});
