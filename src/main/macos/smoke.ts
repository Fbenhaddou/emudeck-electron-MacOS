import { app, BrowserWindow, Menu, nativeTheme } from 'electron';
import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { MacStatus } from '../../shared/macos';
import { selectLibrary } from './library';

type Appearance = 'light' | 'dark';
interface Capture {
  filename: string;
  state: string;
  appearance: Appearance;
  synthetic: boolean;
  width: number;
  height: number;
  zoom: number;
  horizontalOverflow: boolean;
  keyboardFocus: boolean;
}
const variants = [
  { name: 'light', theme: 'light' as const, width: 1120, height: 760 },
  { name: 'dark', theme: 'dark' as const, width: 1120, height: 760 },
  { name: 'small', theme: 'light' as const, width: 760, height: 560 },
];

/** Isolated runtime/UI evidence only; rendering fixtures never execute an emulator. */
export default class SmokeHarness {
  private readonly errors: string[] = [];

  private readonly captures: Capture[] = [];

  private finished = false;

  private watchdog: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly directory: string) {
    const candidate = path.resolve(directory);
    if (
      !path.isAbsolute(directory) ||
      !candidate.startsWith(`${path.resolve(os.tmpdir())}${path.sep}`)
    )
      throw new Error(
        'Smoke output must be inside the system temporary directory.',
      );
  }

  observe(window: BrowserWindow): void {
    this.watchdog = setTimeout(
      () => this.fail('Application smoke watchdog expired.'),
      110000,
    );
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') this.fail(`Renderer: ${details.message}`);
    });
    window.webContents.on('preload-error', (_event, _preload, error) => {
      this.fail(`Preload: ${error.message}`);
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      this.fail(`Renderer exited: ${details.reason}`);
    });
    window.webContents.on('dom-ready', () => {
      void window.webContents
        .executeJavaScript(
          `
        window.addEventListener('error', event => console.error('Smoke page error:', event.message));
        window.addEventListener('unhandledrejection', event => console.error('Smoke unhandled rejection:', String(event.reason)));
      `,
        )
        .catch(() => this.fail('Could not attach page error observers.'));
    });
  }

  fail(message: string): void {
    if (this.finished) return;
    this.errors.push(message);
    void this.finish({}, false);
  }

  private async finish(
    report: Record<string, unknown>,
    success: boolean,
  ): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    if (this.watchdog) clearTimeout(this.watchdog);
    try {
      await fs.mkdir(this.directory, { recursive: true });
      await fs.writeFile(
        path.join(this.directory, 'report.json'),
        JSON.stringify(
          {
            ...report,
            ready: success,
            errors: this.errors.map((message) =>
              message.split(os.homedir()).join('<home>'),
            ),
            packaged: app.isPackaged,
            architecture: process.arch,
          },
          null,
          2,
        ),
      );
    } finally {
      app.exit(success ? 0 : 1);
    }
  }

  private async waitFor(
    window: BrowserWindow,
    expression: string,
    description: string,
    timeout = 4000,
  ): Promise<void> {
    const deadline = Date.now() + timeout;
    while (!this.finished && !window.isDestroyed() && Date.now() < deadline) {
      // eslint-disable-next-line no-await-in-loop -- Readiness is sequential and bounded.
      if (await window.webContents.executeJavaScript(`Boolean(${expression})`))
        return;
      // eslint-disable-next-line no-await-in-loop -- Give React a chance to commit between checks.
      await new Promise((resolve) => {
        setTimeout(resolve, 50);
      });
    }
    throw new Error(`Smoke timed out waiting for ${description}.`);
  }

  private async navigate(window: BrowserWindow, page: string): Promise<void> {
    await window.webContents.executeJavaScript(`
      Array.from(document.querySelectorAll('nav button')).find(button => button.textContent.trim() === ${JSON.stringify(page)}).click();
    `);
    await this.waitFor(
      window,
      `document.querySelector('nav button[aria-current]')?.textContent.trim() === ${JSON.stringify(page)}`,
      page,
    );
  }

  private async refresh(
    window: BrowserWindow,
    expression: string,
    description: string,
  ): Promise<void> {
    await window.webContents.executeJavaScript(
      `document.querySelector('button[aria-label="Refresh status"]').click()`,
    );
    await this.waitFor(window, expression, description);
  }

  private async image(
    window: BrowserWindow,
    filename: string,
    state: string,
    appearance: Appearance,
    width: number,
    height: number,
    synthetic = false,
    zoom = 1,
    keyboardFocus = false,
  ): Promise<void> {
    nativeTheme.themeSource = appearance;
    window.setSize(width, height);
    window.webContents.setZoomFactor(zoom);
    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
    await window.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    // :focus-visible only matches in the key window; another frontmost app must not fail the check.
    if (keyboardFocus) {
      window.focus();
      window.webContents.focus();
      await window.webContents.executeJavaScript(
        'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
      );
    }
    const layout = (await window.webContents.executeJavaScript(`({
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1 || Array.from(document.querySelectorAll('main, .sidebar')).some(element => element.scrollWidth > element.clientWidth + 1),
      keyboardFocus: Boolean(document.activeElement?.matches('button:focus-visible'))
    })`)) as { horizontalOverflow: boolean; keyboardFocus: boolean };
    if (layout.horizontalOverflow)
      throw new Error(`Horizontal overflow in ${filename}.`);
    if (keyboardFocus && !layout.keyboardFocus)
      throw new Error(`Visible keyboard focus missing in ${filename}.`);
    const screenshot = await window.webContents.capturePage();
    if (screenshot.isEmpty())
      throw new Error(`Screenshot was empty: ${filename}.`);
    await fs.writeFile(
      path.join(this.directory, filename),
      Uint8Array.from(screenshot.toPNG()),
    );
    this.captures.push({
      filename,
      state,
      appearance,
      synthetic,
      width,
      height,
      zoom,
      ...layout,
    });
  }

  private async appearances(
    window: BrowserWindow,
    prefix: string,
    state: string,
    synthetic = false,
  ): Promise<void> {
    // eslint-disable-next-line no-restricted-syntax -- One real window changes appearance sequentially.
    for (const variant of variants) {
      // eslint-disable-next-line no-await-in-loop -- Screenshot must follow this variant's appearance change.
      await this.image(
        window,
        `${prefix}-${variant.name}.png`,
        state,
        variant.theme,
        variant.width,
        variant.height,
        synthetic,
      );
    }
  }

  private async zoomAction(
    window: BrowserWindow,
    label: string,
  ): Promise<void> {
    window.setSize(760, 560);
    window.webContents.setZoomFactor(2);
    window.webContents.focus();
    await new Promise((resolve) => {
      setTimeout(resolve, 120);
    });
    for (let step = 0; step < 16 && !this.finished; step += 1) {
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      // eslint-disable-next-line no-await-in-loop -- Allow input dispatch and focus scrolling to finish.
      await new Promise((resolve) => {
        setTimeout(resolve, 20);
      });
      // eslint-disable-next-line no-await-in-loop -- Real keyboard navigation advances one focus target at a time.
      const visible = await window.webContents.executeJavaScript(`(() => {
        const target = document.activeElement;
        if (!target?.matches('button:focus-visible') || target.textContent.trim() !== ${JSON.stringify(label)}) return false;
        const bounds = target.getBoundingClientRect();
        const content = document.querySelector('main').getBoundingClientRect();
        return bounds.top >= content.top && bounds.bottom <= content.bottom + 1;
      })()`);
      if (visible) return;
    }
    throw new Error(
      `Main action ${label} was not keyboard-reachable at 200 percent zoom.`,
    );
  }

  private async menuRefresh(window: BrowserWindow): Promise<void> {
    const item =
      Menu.getApplicationMenu()?.getMenuItemById('mac-refresh-status');
    if (!item)
      throw new Error('Native Refresh Status menu command is missing.');
    await this.navigate(window, 'Emulators');
    await window.webContents.executeJavaScript(`
      document.querySelector('nav button[aria-current]').focus();
      window.__smokeMenuFocus = document.activeElement;
      window.__smokeRefreshCalls = 0;
      window.__smokeRefreshArguments = -1;
      window.__smokeUnsubscribeRefresh = window.mac.onRefreshStatus((...args) => {
        window.__smokeRefreshCalls += 1;
        window.__smokeRefreshArguments = args.length;
      });
      void 0;
    `);
    item.click(item, window, {} as Electron.KeyboardEvent);
    await this.waitFor(
      window,
      'window.__smokeRefreshCalls === 1',
      'native menu notification through the real preload',
    );
    await window.webContents.executeJavaScript(
      'window.__smokeUnsubscribeRefresh()',
    );
    item.click(item, window, {} as Electron.KeyboardEvent);
    await window.webContents.executeJavaScript(
      'new Promise(resolve => setTimeout(resolve, 60))',
    );
    const preserved = await window.webContents.executeJavaScript(`(() => {
      const result = window.__smokeRefreshCalls === 1 && window.__smokeRefreshArguments === 0 && document.activeElement === window.__smokeMenuFocus && document.querySelector('nav button[aria-current]')?.textContent.trim() === 'Emulators';
      delete window.__smokeMenuFocus;
      delete window.__smokeRefreshCalls;
      delete window.__smokeRefreshArguments;
      delete window.__smokeUnsubscribeRefresh;
      return result;
    })()`);
    if (!preserved)
      throw new Error(
        'Menu refresh changed page/focus, forwarded data, or retained an unsubscribed callback.',
      );
    await this.navigate(window, 'Library');
  }

  async capture(
    window: BrowserWindow,
    statePath: string,
    getStatus: () => Promise<MacStatus>,
  ): Promise<void> {
    const directory = await fs.realpath(this.directory);
    const userData = path.join(directory, 'user-data');
    if (
      !directory.startsWith(`${await fs.realpath(os.tmpdir())}${path.sep}`) ||
      (await fs.lstat(this.directory)).isSymbolicLink() ||
      (await fs.realpath(path.dirname(statePath))) !== userData ||
      path.basename(statePath) !== 'library.json' ||
      (await fs.realpath(app.getPath('userData'))) !== userData
    )
      throw new Error(
        'Smoke fixtures require the isolated smoke userData directory.',
      );
    await this.waitFor(
      window,
      `document.querySelector('[data-ready="true"]') && document.querySelector('#root')?.textContent?.trim() && window.mac && !window.electron && !window.require`,
      'real renderer/preload readiness',
      15000,
    );
    const status = (await window.webContents.executeJavaScript(
      'window.mac.getStatus()',
    )) as MacStatus;
    if (
      status.platform !== 'darwin' ||
      !status.appVersion ||
      !(status.memoryBytes > 0) ||
      status.libraryError ||
      status.library
    )
      throw new Error(
        'Initial preload status must be successful and isolated from any user library.',
      );
    const inspected = window.webContents as unknown as {
      getLastWebPreferences(): Record<string, unknown>;
    };
    const preferences = inspected.getLastWebPreferences();
    if (
      preferences.sandbox !== true ||
      preferences.contextIsolation !== true ||
      preferences.nodeIntegration !== false ||
      preferences.webSecurity !== true
    )
      throw new Error(
        'Actual web preferences do not satisfy the security boundary.',
      );
    const bridge = (await window.webContents.executeJavaScript(`({
      methods: Object.keys(window.mac).sort(),
      frozen: Object.isFrozen(window.mac),
      callbackTypeRejected: [null, undefined, 'callback', 1, {}, []].every(value => {
        try { window.mac.onRefreshStatus(value); return false; } catch { return true; }
      })
    })`)) as {
      methods: string[];
      frozen: boolean;
      callbackTypeRejected: boolean;
    };
    const expectedMethods = [
      'chooseLibrary',
      'getStatus',
      'installDolphin',
      'onRefreshStatus',
      'playGame',
      'recoverLibrarySettings',
      'resetDolphin',
      'revealLibrary',
    ];
    if (
      !bridge.frozen ||
      !bridge.callbackTypeRejected ||
      JSON.stringify(bridge.methods) !== JSON.stringify(expectedMethods)
    )
      throw new Error(
        'Actual preload bridge differs from its fixed API inventory.',
      );
    await this.menuRefresh(window);
    await this.appearances(window, 'window', 'First launch / Library');
    // eslint-disable-next-line no-restricted-syntax -- Navigate the same real renderer in sequence.
    for (const page of ['Emulators', 'This Mac', 'Development']) {
      // eslint-disable-next-line no-await-in-loop
      await this.navigate(window, page);
      // eslint-disable-next-line no-await-in-loop
      await this.appearances(
        window,
        `page-${page.toLowerCase().replace(/ /g, '-')}`,
        `${page} / no library`,
      );
    }

    const fixtureLibrary = path.join(
      userData,
      'fixtures',
      'Game Library — مكتبة الألعاب 日本語',
      'Homebrew and GameCube collection with a long folder name for layout review',
    );
    await fs.mkdir(fixtureLibrary, { recursive: true, mode: 0o700 });
    await selectLibrary(statePath, fixtureLibrary);
    await this.navigate(window, 'Library');
    await this.refresh(
      window,
      `document.querySelector('main')?.textContent.includes('Folder available')`,
      'selected fixture library',
    );
    if (!(await getStatus()).library?.available)
      throw new Error(
        'Selected fixture library was not available through the real status service.',
      );
    await this.appearances(
      window,
      'library-selected',
      'Library / long Unicode and spaces path',
    );
    await this.navigate(window, 'Emulators');
    await this.appearances(
      window,
      'emulators-library',
      'Emulators / library selected',
    );

    await fs.rename(fixtureLibrary, `${fixtureLibrary} disconnected`);
    await this.navigate(window, 'Library');
    await this.refresh(
      window,
      `document.querySelector('main')?.textContent.includes('Folder unavailable')`,
      'disconnected fixture library',
    );
    await this.appearances(
      window,
      'library-disconnected',
      'Library / disconnected fixture folder',
    );
    await fs.rename(`${fixtureLibrary} disconnected`, fixtureLibrary);

    window.webContents.setZoomFactor(2);
    await window.webContents.executeJavaScript(
      'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
    );
    const scrolled = await window.webContents.executeJavaScript(`(() => {
      document.querySelector('button[aria-label="Refresh status"]').focus();
      window.__smokeErrorFocus = document.activeElement;
      const main = document.querySelector('main');
      main.scrollTop = main.scrollHeight;
      return main.scrollTop > 0;
    })()`);
    if (!scrolled)
      throw new Error('Error reveal smoke requires overflowing main content.');
    await fs.writeFile(statePath, '{malformed smoke-only fixture');
    await this.refresh(
      window,
      `document.querySelector('[role="alert"]')?.textContent.includes('Library settings could not be read')`,
      'malformed library settings error',
    );
    await this.waitFor(
      window,
      `(() => {
        const alert = document.querySelector('[role="alert"]');
        if (!alert) return false;
        const bounds = alert.getBoundingClientRect();
        const viewport = document.querySelector('main').getBoundingClientRect();
        return bounds.top >= viewport.top - 1 && bounds.top < viewport.bottom && document.activeElement === window.__smokeErrorFocus;
      })()`,
      'new error revealed at 200 percent zoom without moving keyboard focus',
    );
    await window.webContents.executeJavaScript(
      'delete window.__smokeErrorFocus',
    );
    await this.appearances(
      window,
      'library-error',
      'Library / malformed isolated settings error',
    );
    await fs.unlink(statePath);
    await selectLibrary(statePath, fixtureLibrary);
    await this.refresh(
      window,
      `document.querySelector('main')?.textContent.includes('Folder available') && !document.querySelector('[role="alert"]')`,
      'recovered library settings',
    );

    // This empty app directory and fabricated receipt exercise installed UI only.
    // No executable exists; no install, play, reset or external command is invoked.
    const syntheticVersion = path.join(
      userData,
      'components',
      'dolphin',
      '2509',
    );
    const syntheticBundle = path.join(syntheticVersion, 'Dolphin.app');
    await fs.mkdir(syntheticBundle, { recursive: true, mode: 0o700 });
    await fs.writeFile(
      path.join(syntheticVersion, 'receipt.json'),
      JSON.stringify({
        version: '2509',
        bundlePath: syntheticBundle,
        verification: 'codesign-and-gatekeeper',
        smokeRenderingFixture: true,
      }),
    );
    await this.navigate(window, 'Emulators');
    await this.refresh(
      window,
      `document.querySelector('main')?.textContent.includes('Version 2509 installed')`,
      'synthetic installed rendering fixture',
    );
    await this.appearances(
      window,
      'emulators-installed',
      'Emulators / synthetic installed receipt',
      true,
    );
    await window.webContents.executeJavaScript(
      `document.querySelector('details.advanced').open = true`,
    );
    await this.appearances(
      window,
      'emulators-advanced',
      'Emulators / advanced settings / synthetic installed receipt',
      true,
    );

    // eslint-disable-next-line no-restricted-syntax -- Appearance and zoom mutate one window sequentially.
    for (const theme of ['light', 'dark'] as const) {
      // eslint-disable-next-line no-await-in-loop
      await this.zoomAction(window, 'Update Dolphin');
      // eslint-disable-next-line no-await-in-loop
      await this.image(
        window,
        `zoom-emulators-${theme}.png`,
        'Emulators / 200 percent zoom / synthetic installed receipt',
        theme,
        760,
        560,
        true,
        2,
        true,
      );
      // eslint-disable-next-line no-await-in-loop
      await this.navigate(window, 'Library');
      // eslint-disable-next-line no-await-in-loop
      await this.zoomAction(window, 'Change…');
      // eslint-disable-next-line no-await-in-loop
      await this.image(
        window,
        `zoom-library-${theme}.png`,
        'Library / 200 percent zoom / long path',
        theme,
        760,
        560,
        false,
        2,
        true,
      );
      window.webContents.setZoomFactor(1);
      window.webContents.focus();
      window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Tab' });
      window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Tab' });
      // eslint-disable-next-line no-await-in-loop
      await this.image(
        window,
        `keyboard-focus-${theme}.png`,
        'Library / real Tab keyboard focus',
        theme,
        760,
        560,
        false,
        1,
        true,
      );
      // eslint-disable-next-line no-restricted-syntax -- Every implemented page must fit at text zoom.
      for (const [page, prefix] of [
        ['This Mac', 'zoom-this-mac'],
        ['Development', 'zoom-development'],
      ]) {
        // eslint-disable-next-line no-await-in-loop
        await this.navigate(window, page);
        window.webContents.setZoomFactor(2);
        // eslint-disable-next-line no-await-in-loop -- Inspect the final facts, including actual display dimensions.
        await window.webContents
          .executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => {
          document.querySelector('.facts div:last-child')?.scrollIntoView({ block: 'end' });
          resolve();
        }))`);
        // eslint-disable-next-line no-await-in-loop
        await this.waitFor(
          window,
          `(() => {
          const value = document.querySelector('.facts div:last-child dd');
          const viewport = document.querySelector('main').getBoundingClientRect();
          if (!value) return false;
          const bounds = value.getBoundingClientRect();
          return bounds.left >= viewport.left - 1 && bounds.right <= viewport.right + 1 && bounds.top >= viewport.top - 1 && bounds.bottom <= viewport.bottom + 1;
        })()`,
          `${page} final facts visible at 200 percent zoom`,
        );
        // eslint-disable-next-line no-await-in-loop
        await this.image(
          window,
          `${prefix}-${theme}.png`,
          `${page} / 200 percent zoom / real status`,
          theme,
          760,
          560,
          false,
          2,
        );
      }
      // eslint-disable-next-line no-await-in-loop
      await this.navigate(window, 'Emulators');
    }
    await fs.rm(syntheticVersion, { recursive: true });
    await fs.unlink(statePath);
    await this.finish(
      {
        status,
        bridge,
        webPreferences: preferences,
        screenshots: this.captures.map((capture) => capture.filename),
        captures: this.captures,
        coverage: {
          screenshotCount: this.captures.length,
          realPreloadAndIPC: true,
          fixturesInsideIsolatedUserData: true,
          syntheticInstalledState: true,
          syntheticFixtureNote:
            'Empty Dolphin.app directory and fabricated receipt test renderer layout only; no download, signature verification, installation, game launch, save or controller support is proven.',
          nativeWindowChrome: false,
          voiceOver: false,
          zoomActionsKeyboardReachable: true,
          allPagesAtTextZoom: true,
          zoomFactValuesVisible: true,
          menuRefreshPreservesPageAndFocus: true,
          refreshSubscriptionCleanup: true,
          newErrorRevealedWithoutFocus: true,
        },
      },
      this.errors.length === 0,
    );
  }
}
