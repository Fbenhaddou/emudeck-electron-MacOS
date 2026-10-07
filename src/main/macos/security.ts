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

/** Exactly one argument, and it is one of a fixed set of string literals. */
export function acceptsOneOf<T extends string>(
  args: unknown[],
  allowed: readonly T[],
): args is [T] {
  return (
    args.length === 1 &&
    typeof args[0] === 'string' &&
    (allowed as readonly string[]).includes(args[0])
  );
}
