export function isTrustedDocument(actual: string, expected: string): boolean {
  try {
    const actualURL = new URL(actual);
    const expectedURL = new URL(expected);
    actualURL.hash = '';
    expectedURL.hash = '';
    return actualURL.href === expectedURL.href;
  } catch {
    return false;
  }
}

export function acceptsEmptyArguments(args: unknown[]): boolean {
  return args.length === 0;
}
