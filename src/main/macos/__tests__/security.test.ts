import {
  acceptsOneOf,
  acceptsEmptyArguments,
  isTrustedDocument,
} from '../security';

describe('macOS IPC document and argument boundary', () => {
  const expected =
    'file:///Applications/Emulation%20Workspace.app/Contents/Resources/app.asar/dist/renderer/index.html';
  it('accepts the exact document and in-document hash navigation', () => {
    expect(isTrustedDocument(expected, expected)).toBe(true);
    expect(isTrustedDocument(`${expected}#library`, expected)).toBe(true);
  });
  it.each([
    'https://example.com/index.html',
    'file:///tmp/index.html',
    `${expected}?arbitrary=1`,
    `${expected}/../evil.html`,
    'not a URL',
  ])('rejects another document %s', (candidate) => {
    expect(isTrustedDocument(candidate, expected)).toBe(false);
  });
  it('does not accept another development port or hostname', () => {
    expect(
      isTrustedDocument(
        'http://localhost:1213/index.html',
        'http://localhost:1212/index.html',
      ),
    ).toBe(false);
    expect(
      isTrustedDocument(
        'http://evil.localhost:1212/index.html',
        'http://localhost:1212/index.html',
      ),
    ).toBe(false);
  });
  it('rejects renderer attempts to supply paths or commands', () => {
    expect(acceptsEmptyArguments([])).toBe(true);
    expect(acceptsEmptyArguments(['/tmp/other'])).toBe(false);
    expect(acceptsEmptyArguments([{ command: 'touch /tmp/owned' }])).toBe(
      false,
    );
  });
});

describe('fixed-literal IPC argument', () => {
  const allowed = ['standard', 'precise'] as const;
  it('accepts exactly one allowed literal', () => {
    expect(acceptsOneOf(['precise'], allowed)).toBe(true);
  });
  it.each([
    [[]],
    [['precise', 'standard']],
    [['PRECISE']],
    [['precise ']],
    [[{ toString: () => 'precise' }]],
    // eslint-disable-next-line no-new-wrappers -- A boxed string must be rejected.
    [[new String('precise')]],
    [['__proto__']],
    [[null]],
  ])('rejects %p', (args) => {
    expect(acceptsOneOf(args as unknown[], allowed)).toBe(false);
  });
});
