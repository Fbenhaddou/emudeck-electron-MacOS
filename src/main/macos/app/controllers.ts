import { dialog } from 'electron';
import path from 'path';
import type { ActionResult, ControllersStatus } from '../../../shared/macos';
import { dolphin } from '../../components/dolphin';
import {
  adoptManagedInput,
  inputState,
  isInputFamily,
} from '../../components/dolphin/input';
import {
  detectControllers,
  listControllers,
  primaryController,
} from '../controllers';
import { prepareDolphinLibrary } from '../dolphin-library';
import { readStickResponse, writeStickResponse } from '../preferences';
import { readProcessExecutables } from '../processes';
import { acceptsOneOf } from '../security';
import { BUSY } from './context';
import type { AppContext } from './context';

const stickResponses = ['standard', 'precise'] as const;

/**
 * Steam Input can take over a PlayStation controller and expose a virtual Xbox
 * 360 pad instead; emulators with older SDL then miss the analog sticks
 * (observed with PPSSPP 1.20.4). Detected as Steam running plus that virtual pad.
 */
async function steamInputActive(
  detected: Awaited<ReturnType<typeof detectControllers>>,
): Promise<boolean> {
  const virtualPad = detected.some(
    (pad) =>
      pad.vendorID === 0x045e && pad.productID === 0x028e && !pad.transport,
  );
  if (!virtualPad) return false;
  try {
    return (await readProcessExecutables())
      .split('\n')
      .some((line) => /\/steam_osx$/.test(line.trim()));
  } catch {
    return false;
  }
}

/** The library's Dolphin input files and this app's ownership record. */
function dolphinInputPaths(library: string) {
  const { configuration, user } = dolphin.paths(library);
  return {
    configuration,
    ownership: path.join(path.dirname(user), '.emulation-workspace-input.json'),
  };
}

export function createControllers(context: AppContext) {
  const preferences = path.join(context.userData, 'controllers.json');
  async function status(): Promise<ControllersStatus> {
    const [controllers, stickResponse, detected] = await Promise.all([
      listControllers(path.join(context.helpers, 'console-guardian')),
      readStickResponse(preferences),
      detectControllers(),
    ]);
    let dolphinControls: ControllersStatus['dolphinControls'] = 'no-library';
    try {
      const library = await context.availableLibrary();
      const { configuration, ownership } = dolphinInputPaths(library);
      dolphinControls = await inputState(configuration, ownership);
    } catch {
      dolphinControls = 'no-library';
    }
    return {
      controllers,
      steamInput: await steamInputActive(detected),
      stickResponse,
      dolphinControls,
      recommendedAvailable: isInputFamily(
        primaryController(detected)?.family || 'none',
      ),
    };
  }
  return { preferences, status };
}

export function registerControllerHandlers(
  context: AppContext,
  controllers: ReturnType<typeof createControllers>,
): void {
  context.handle('mac:controllers', controllers.status);

  context.handle(
    'mac:set-stick-response',
    async (args): Promise<ActionResult> => {
      try {
        await writeStickResponse(
          controllers.preferences,
          args[0] as (typeof stickResponses)[number],
        );
        return { ok: true };
      } catch {
        return { ok: false, error: 'The setting could not be saved.' };
      }
    },
    (values) => acceptsOneOf(values, stickResponses),
  );

  context.handle(
    'mac:use-recommended-controls',
    async (): Promise<ActionResult> => {
      if (context.busy()) return { ok: false, error: BUSY };
      return context.exclusive(async () => {
        try {
          const family = primaryController(await detectControllers())?.family;
          if (!family || !isInputFamily(family))
            return {
              ok: false,
              error:
                'Connect a DualSense controller to use the recommended controls.',
            };
          const library = await context.availableLibrary();
          const choice = await dialog.showMessageBox(context.window()!, {
            type: 'question',
            message: 'Use the recommended Dolphin controls?',
            detail:
              'Your current Dolphin controller settings for this library will be kept in a backup file next to them. Games and saves are not affected.',
            buttons: ['Cancel', 'Use Recommended Controls'],
            defaultId: 1,
            cancelId: 0,
          });
          if (choice.response !== 1) return { ok: true };
          if ((await context.availableLibrary()) !== library)
            throw new Error('Library changed');
          await prepareDolphinLibrary(library);
          const { configuration, ownership } = dolphinInputPaths(library);
          await adoptManagedInput(
            configuration,
            ownership,
            family,
            await readStickResponse(controllers.preferences),
          );
          return { ok: true };
        } catch {
          return {
            ok: false,
            error:
              'The controls could not be changed. Your existing controller settings are unchanged.',
          };
        }
      });
    },
  );
}
