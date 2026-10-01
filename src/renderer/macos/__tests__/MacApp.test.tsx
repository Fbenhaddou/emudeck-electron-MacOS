/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import MacApp from '../MacApp';
import type { MacStatus } from '../../../shared/macos';

const status: MacStatus = {
  dolphin: { version: null, operation: 'idle' },
  appVersion: 'test',
  platform: 'darwin',
  architecture: 'arm64',
  osVersion: '14.0',
  memoryBytes: 16 * 1024 ** 3,
  displays: [],
  library: null,
  libraryError: null,
  capabilities: {
    controllers: 'untested',
    installation: 'planned',
    consoleMode: 'planned',
  },
};
beforeEach(() => {
  window.mac = {
    installDolphin: jest.fn().mockResolvedValue({ ok: true }),
    playGame: jest.fn().mockResolvedValue({ ok: true }),
    resetDolphin: jest.fn().mockResolvedValue({ ok: true }),
    getStatus: jest.fn().mockResolvedValue(status),
    chooseLibrary: jest
      .fn()
      .mockResolvedValue({ ok: false, cancelled: true, error: 'Cancelled' }),
    revealLibrary: jest.fn().mockResolvedValue({ ok: true }),
  };
});
it('loads status from the narrow API and leaves cancelled selection unchanged', async () => {
  render(<MacApp />);
  fireEvent.click(
    await screen.findByRole('button', { name: 'Choose Folder…' }),
  );
  await waitFor(() =>
    expect(window.mac.chooseLibrary).toHaveBeenCalledTimes(1),
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Choose Folder…' }),
    ).toBeEnabled(),
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByText('No folder selected')).toBeInTheDocument();
});
it('presents disconnected storage without offering Finder access', async () => {
  window.mac.getStatus = jest.fn().mockResolvedValue({
    ...status,
    library: { path: '/Volumes/Game Library', available: false },
  });
  render(<MacApp />);
  expect(await screen.findByText('Folder unavailable')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Show in Finder' })).toBeDisabled();
});
it('reports IPC failure and does not mark an error screen ready', async () => {
  window.mac.getStatus = jest.fn().mockRejectedValue(new Error('unavailable'));
  const { container } = render(<MacApp />);
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not read application status',
  );
  expect(container.querySelector('[data-ready="true"]')).toBeNull();
});
it('keeps future capabilities honestly labeled', async () => {
  render(<MacApp />);
  await screen.findByRole('button', { name: 'Choose Folder…' });
  fireEvent.click(screen.getByRole('button', { name: 'Development' }));
  expect(screen.getByText('Not tested')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /install/i })).toBeNull();
});
