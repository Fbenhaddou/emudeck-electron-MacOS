/** @jest-environment node */
const { preconditions } = require('../release-macos');

const identity = 'Developer ID Application: Jane Doe (ABCDE12345)';
const keychain = `  1) 0123 "${identity}"\n     1 valid identities found`;
const clean = { revision: 'a'.repeat(40), dirty: false };
const env = {
  EMULATION_SIGNING_IDENTITY: identity,
  EMULATION_NOTARY_PROFILE: 'emulation-workspace',
};

describe('release preconditions', () => {
  it('accepts an explicit Developer ID, a notary profile and a clean tree', () => {
    expect(preconditions(env, clean, keychain)).toEqual({
      identity,
      profile: 'emulation-workspace',
      team: 'ABCDE12345',
    });
  });

  it.each([
    [{}, 'Developer ID Application'],
    [
      {
        ...env,
        EMULATION_SIGNING_IDENTITY: 'Apple Development: Jane Doe (ABCDE12345)',
      },
      'Developer ID Application',
    ],
    [{ ...env, EMULATION_SIGNING_IDENTITY: '-' }, 'Developer ID Application'],
    [{ ...env, EMULATION_NOTARY_PROFILE: '' }, 'notarytool'],
    [{ ...env, EMULATION_NOTARY_PROFILE: 'x; rm -rf ~' }, 'notarytool'],
  ])('refuses incomplete or unsafe settings %#', (values, message) => {
    expect(preconditions(values, clean, keychain).error).toContain(message);
  });

  it('refuses an identity missing from the keychain and uncommitted source', () => {
    expect(
      preconditions(env, clean, '0 valid identities found').error,
    ).toContain('not a valid signing identity');
    expect(
      preconditions(env, { ...clean, dirty: true }, keychain).error,
    ).toContain('Commit or stash');
  });
});
