import type { Dispatch, SetStateAction } from 'react';
import type {
  ControllersStatus,
  ControllerSummary,
} from '../../../shared/macos';
import { Caution, Hero, Segmented, Spinner } from '../controls';
import type { PageProps } from './types';

const kindNames: Record<ControllerSummary['kind'], string> = {
  ps5: 'PlayStation',
  ps4: 'PlayStation',
  xbox: 'Xbox',
  switchpro: 'Nintendo',
  other: 'Controller',
};

function describeController(pad: ControllerSummary): string {
  const parts = [kindNames[pad.kind]];
  if (pad.battery !== null)
    parts.push(
      pad.charging
        ? `Battery ${pad.battery}%, charging`
        : `Battery ${pad.battery}%`,
    );
  const features = [pad.haptics && 'haptics', pad.motion && 'motion'].filter(
    Boolean,
  );
  if (features.length) parts.push(`Supports ${features.join(' and ')}`);
  return parts.join(' · ');
}

const controlsText: Record<ControllersStatus['dolphinControls'], string> = {
  recommended: 'Using the recommended controls for your controller.',
  user: 'Using this library’s own controller settings.',
  'not-set': 'Set up automatically the next time you play in Console Mode.',
  'no-library': 'Choose an available library to manage its controls.',
};

export default function ControllersPage({
  emulatorBusy,
  consoleBusy,
  operate,
  setError,
  controllers,
  setControllers,
  refreshControllers,
}: PageProps & {
  setError: (message: string) => void;
  controllers: ControllersStatus | null;
  setControllers: Dispatch<SetStateAction<ControllersStatus | null>>;
  refreshControllers: () => Promise<void>;
}) {
  return (
    <>
      <Hero page="Controllers" tint="indigo" title="Controllers">
        Controllers connected to this Mac. Console Mode sets up supported
        controllers for your games automatically.
      </Hero>
      <section className="group" aria-label="Connected controllers">
        {!controllers && (
          <div className="row progress" role="status">
            <Spinner />
            <p>Looking for controllers…</p>
          </div>
        )}
        {controllers && controllers.controllers.length === 0 && (
          <div className="row">
            <div className="row-text">
              <h3>No controllers connected</h3>
              <p>
                Connect one with a USB cable, or pair it in System Settings ›
                Bluetooth.
              </p>
            </div>
          </div>
        )}
        {controllers?.steamInput && (
          <div className="row alert" role="alert">
            <Caution />
            <p>
              Steam is taking over your controller, so some emulators can’t see
              its analog sticks. Quit Steam before playing, or turn off Steam
              Input for PlayStation controllers in Steam’s Controller settings.
            </p>
          </div>
        )}
        {controllers?.controllers.map((pad, index) => (
          <div
            className="row"
            // eslint-disable-next-line react/no-array-index-key -- Identical models can be connected together.
            key={`${pad.name}-${index}`}
          >
            <div className="row-text">
              <h3>
                <span className="indicator on" aria-hidden="true" />
                <span className="title">{pad.name}</span>
              </h3>
              <p>{describeController(pad)}</p>
            </div>
          </div>
        ))}
      </section>
      <section className="group" aria-label="Console Mode controls">
        <div className="row">
          <div className="row-text">
            <h3 id="stick-response-label">Stick response</h3>
            <p>
              Precise makes small movements finer. A full push still reaches
              full speed. Applies to the next game.
            </p>
          </div>
          <Segmented
            label="Stick response"
            value={controllers?.stickResponse || 'standard'}
            options={[
              { value: 'standard', label: 'Standard' },
              { value: 'precise', label: 'Precise' },
            ]}
            disabled={!controllers}
            onChange={(next) => {
              setControllers((current) =>
                current ? { ...current, stickResponse: next } : current,
              );
              void window.mac.setStickResponse(next).then((result) => {
                if (!result.ok) setError(result.error);
                return refreshControllers();
              });
            }}
          />
        </div>
        <div className="row">
          <div className="row-text">
            <h3>Dolphin controls</h3>
            <p>
              {controllers
                ? controlsText[controllers.dolphinControls]
                : 'Checking…'}
            </p>
          </div>
          {controllers?.dolphinControls === 'user' && (
            <button
              type="button"
              disabled={
                emulatorBusy || consoleBusy || !controllers.recommendedAvailable
              }
              onClick={() => {
                void operate('resetting', () =>
                  window.mac.useRecommendedControls(),
                ).then(refreshControllers);
              }}
            >
              Use Recommended Controls…
            </button>
          )}
        </div>
      </section>
      <p className="footnote">
        In a game, hold Create and Options to return to Console Mode. If a game
        stops responding, keep holding for about 5 seconds.
      </p>
      <p className="footnote">
        Recommended controls are currently available for DualSense. Other
        controllers work with each emulator’s own settings.
      </p>
    </>
  );
}
