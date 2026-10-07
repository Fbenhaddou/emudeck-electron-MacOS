import { execFile } from 'child_process';

export type ControllerFamily = 'ps5' | 'ps4' | 'xbox' | 'switchpro' | 'other';

export interface DetectedController {
  name: string;
  vendorID: number;
  productID: number;
  /** USB, Bluetooth, …; null for virtual devices created by other software. */
  transport: string | null;
  family: ControllerFamily;
}

// USB vendor/product identifiers, not names: names vary by driver and firmware.
const families: Array<[number, number[], ControllerFamily]> = [
  [0x054c, [0x0ce6, 0x0df2], 'ps5'],
  [0x054c, [0x05c4, 0x09cc], 'ps4'],
  [0x057e, [0x2009], 'switchpro'],
];

function familyOf(vendorID: number, productID: number): ControllerFamily {
  const match = families.find(
    ([vendor, products]) => vendor === vendorID && products.includes(productID),
  );
  if (match) return match[2];
  if (vendorID === 0x045e) return 'xbox';
  return 'other';
}

/** Parses `ioreg -r -c IOHIDDevice -d 1 -w 0` text; keeps game pads and joysticks only. */
export function parseControllers(text: string): DetectedController[] {
  if (typeof text !== 'string' || text.length > 8 * 1024 * 1024) return [];
  return text
    .split(/^\+-o /m)
    .slice(1)
    .map((block) => {
      const value = (key: string) =>
        new RegExp(`^\\s*"${key}" = (.+)$`, 'm').exec(block)?.[1]?.trim();
      const text = (key: string) => {
        const raw = value(key);
        return raw && /^"[^"\n]{1,128}"$/.test(raw) ? raw.slice(1, -1) : null;
      };
      const number = (key: string) => {
        const raw = value(key);
        return raw && /^\d{1,10}$/.test(raw) ? Number(raw) : null;
      };
      return {
        page: number('PrimaryUsagePage'),
        usage: number('PrimaryUsage'),
        name: text('Product'),
        vendorID: number('VendorID') ?? 0,
        productID: number('ProductID') ?? 0,
        transport: text('Transport'),
      };
    })
    .filter(
      (device): device is typeof device & { name: string } =>
        device.page === 1 &&
        (device.usage === 4 || device.usage === 5) &&
        Boolean(device.name),
    )
    .map((device) => ({
      name: device.name,
      vendorID: device.vendorID,
      productID: device.productID,
      transport: device.transport,
      family: familyOf(device.vendorID, device.productID),
    }));
}

export function detectControllers(): Promise<DetectedController[]> {
  return new Promise((resolve) => {
    execFile(
      '/usr/sbin/ioreg',
      ['-r', '-c', 'IOHIDDevice', '-d', '1', '-w', '0'],
      { timeout: 5000, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout) => resolve(error ? [] : parseControllers(stdout)),
    );
  });
}

/** A physical controller of a known family, before virtual or unknown pads. */
export function primaryController(
  controllers: readonly DetectedController[],
): DetectedController | null {
  const physical = controllers.filter((pad) => pad.transport !== null);
  return (
    physical.find((pad) => pad.family !== 'other') ||
    physical[0] ||
    controllers.find((pad) => pad.family !== 'other') ||
    null
  );
}

export interface ControllerInfo {
  name: string;
  kind: ControllerFamily;
  /** 0-100, or null when the controller reports no battery. */
  battery: number | null;
  charging: boolean;
  haptics: boolean;
  motion: boolean;
}

function kindOf(category: string): ControllerFamily {
  if (category === 'DualSense') return 'ps5';
  if (category === 'DualShock 4') return 'ps4';
  if (/xbox/i.test(category)) return 'xbox';
  if (/switch pro/i.test(category)) return 'switchpro';
  return 'other';
}

/** Validates the GameController inventory printed by `console-guardian --list`. */
export function parseControllerList(json: string): ControllerInfo[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  return data.slice(0, 16).flatMap((entry): ControllerInfo[] => {
    if (!entry || typeof entry !== 'object') return [];
    const item = entry as Record<string, unknown>;
    if (typeof item.name !== 'string' || typeof item.category !== 'string')
      return [];
    const battery =
      typeof item.battery === 'number' &&
      Number.isInteger(item.battery) &&
      item.battery >= 0 &&
      item.battery <= 100
        ? item.battery
        : null;
    return [
      {
        name: item.name.slice(0, 128),
        kind: kindOf(item.category),
        battery,
        charging: item.charging === true,
        haptics: item.haptics === true,
        motion: item.motion === true,
      },
    ];
  });
}

export function listControllers(helper: string): Promise<ControllerInfo[]> {
  return new Promise((resolve) => {
    execFile(
      helper,
      ['--list'],
      { timeout: 5000, maxBuffer: 64 * 1024 },
      (error, stdout) => resolve(error ? [] : parseControllerList(stdout)),
    );
  });
}
