/* eslint import/prefer-default-export: "off" -- One shared error type. */
/**
 * A launch refused for a reason the person can fix, already written in plain
 * language. Its message is shown as-is; any other error gets a generic message.
 */
export class LaunchRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LaunchRefusal';
  }
}
