import { Hero } from '../controls';

export default function DevelopmentPage() {
  return (
    <>
      <Hero page="Development" tint="orange" title="Development Status">
        This preview establishes the macOS foundation. It is not ready to manage
        a game collection.
      </Hero>
      <dl className="group facts">
        <div>
          <dt>Library selection</dt>
          <dd>Available</dd>
        </div>
        <div>
          <dt>Emulators · Dolphin and PPSSPP</dt>
          <dd>Preview</dd>
        </div>
        <div>
          <dt>Console Mode · ES-DE</dt>
          <dd>Preview</dd>
        </div>
        <div>
          <dt>DualSense over USB</dt>
          <dd>Tested</dd>
        </div>
        <div>
          <dt>Bluetooth and other controllers</dt>
          <dd>Not tested</dd>
        </div>
        <div>
          <dt>Signed distribution</dt>
          <dd>Not yet available</dd>
        </div>
      </dl>
      <p className="footnote">
        Independent development project. Not an official EmuDeck or RetroDECK
        product.
      </p>
    </>
  );
}
