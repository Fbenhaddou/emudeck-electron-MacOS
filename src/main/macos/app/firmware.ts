import { dialog } from 'electron';
import type { ActionResult } from '../../../shared/macos';
import { FirmwareError, importFirmware } from '../firmware';
import { acceptsOneOf } from '../security';
import { BUSY } from './context';
import type { AppContext } from './context';
import type { Emulators } from './emulators';

export default function registerFirmwareHandlers(
  context: AppContext,
  { systems }: Emulators,
): void {
  const requirements = systems.flatMap(
    (emulator) => emulator.adapter.firmware || [],
  );
  const firmwareIDs = requirements.map((requirement) => requirement.id);

  context.handle(
    'mac:add-firmware',
    async (args): Promise<ActionResult> => {
      const requirement = requirements.find(
        (candidate) => candidate.id === args[0],
      )!;
      if (context.busy()) return { ok: false, error: BUSY };
      return context.exclusive(async () => {
        try {
          const library = await context.availableLibrary();
          const choice = await dialog.showOpenDialog(context.window()!, {
            title: `Choose Your ${requirement.title} Dump`,
            message: `Choose a ${requirement.title} file dumped from your own console. It is checked against known good dumps and copied into your library; the original stays where it is.`,
            buttonLabel: 'Add',
            properties: ['openFile'],
          });
          if (choice.canceled) return { ok: true };
          if (
            choice.filePaths.length !== 1 ||
            (await context.availableLibrary()) !== library
          )
            throw new Error('Library changed');
          await importFirmware(library, requirement, choice.filePaths[0]);
          return { ok: true };
        } catch (error) {
          return {
            ok: false,
            error:
              error instanceof FirmwareError
                ? error.message
                : 'The file could not be added. Check that your library drive is connected. Nothing was changed.',
          };
        }
      });
    },
    (values) => acceptsOneOf(values, firmwareIDs),
  );
}
