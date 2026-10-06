import { parseControllers, primaryController } from '../controllers';

// Shape of `ioreg -r -c IOHIDDevice -d 1 -w 0` with the devices observed on the test Mac.
const sample = `+-o AppleHIDTransportHIDDevice  <class AppleHIDTransportHIDDevice>
      "PrimaryUsagePage" = 1
      "Product" = "Apple Internal Keyboard / Trackpad"
      "Transport" = "FIFO"
      "PrimaryUsage" = 6
+-o VirtualHIDDevice  <class IOHIDUserDevice>
      "PrimaryUsagePage" = 1
      "PrimaryUsage" = 5
      "Product" = "GamePad-1"
      "VendorID" = 1118
      "ProductID" = 654
+-o IOUSBHostHIDDevice  <class IOUSBHostHIDDevice>
      "Transport" = "USB"
      "Product" = "DualSense Wireless Controller"
      "PrimaryUsage" = 5
      "PrimaryUsagePage" = 1
      "VendorID" = 1356
      "ProductID" = 3302
`;

describe('controller detection', () => {
  it('finds game pads only and classifies them by USB identifiers', () => {
    expect(parseControllers(sample)).toEqual([
      {
        name: 'GamePad-1',
        vendorID: 0x45e,
        productID: 0x28e,
        transport: null,
        family: 'xbox',
      },
      {
        name: 'DualSense Wireless Controller',
        vendorID: 0x54c,
        productID: 0xce6,
        transport: 'USB',
        family: 'ps5',
      },
    ]);
  });

  it('prefers the physical DualSense over a virtual pad listed first', () => {
    expect(primaryController(parseControllers(sample))?.family).toBe('ps5');
  });

  it('ignores malformed or hostile values', () => {
    const hostile = `+-o X  <class X>
      "PrimaryUsagePage" = 1
      "PrimaryUsage" = 5
      "Product" = "a\\"; rm -rf ~ \\""
      "VendorID" = -1
`;
    expect(parseControllers(hostile)).toEqual([]);
    expect(parseControllers('')).toEqual([]);
    expect(primaryController([])).toBeNull();
  });
});
