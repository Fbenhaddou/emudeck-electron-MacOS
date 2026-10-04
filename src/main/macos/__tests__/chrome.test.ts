import type { BrowserWindow } from 'electron';
import { setWindowZoom, stepZoom } from '../chrome';

function fixture(initial = 1) {
  let zoom = initial;
  const window = {
    webContents: {
      getZoomFactor: () => zoom,
      setZoomFactor: jest.fn((value: number) => {
        zoom = value;
      }),
    },
    setWindowButtonPosition: jest.fn(),
  };
  return { window, browser: window as unknown as BrowserWindow };
}

describe('window zoom chrome', () => {
  it('keeps the traffic lights centered on the 52pt toolbar at 100%', () => {
    const { window, browser } = fixture();
    setWindowZoom(browser, 1);
    expect(window.setWindowButtonPosition).toHaveBeenCalledWith({
      x: 20,
      y: 19,
    });
  });

  it('moves the traffic lights to the center of the scaled toolbar', () => {
    const { window, browser } = fixture();
    expect(setWindowZoom(browser, 2)).toBe(2);
    expect(window.webContents.setZoomFactor).toHaveBeenCalledWith(2);
    expect(window.setWindowButtonPosition).toHaveBeenCalledWith({
      x: 20,
      y: 45,
    });
  });

  it.each([
    [0.5, 1],
    [9, 3],
    [Number.NaN, 1],
  ])('clamps %p to %p', (requested, expected) => {
    const { browser } = fixture();
    expect(setWindowZoom(browser, requested)).toBe(expected);
  });

  it.each([
    [1, 1, 1.1],
    [2, 1, 2.5],
    [3, 1, 3],
    [2, -1, 1.75],
    [1, -1, 1],
    [1.3, 1, 1.5],
    [1.3, -1, 1.25],
  ])('steps from %p in direction %p to %p', (start, direction, expected) => {
    const { browser } = fixture(start);
    expect(stepZoom(browser, direction as 1 | -1)).toBe(expected);
  });
});
