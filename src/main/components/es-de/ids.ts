/* eslint import/prefer-default-export: "off" -- Single focused capability. */
import { createHmac } from 'crypto';

export interface GameIdentity {
  /** Library volume identity (e.g. APFS volume UUID or device id string). */
  volume: string;
  /** Filesystem file identity (inode) at catalog time. */
  file: bigint | number;
  /** Path relative to the library root, using '/' separators. */
  relativePath: string;
}

/**
 * Opaque, stable game IDs for the frontend. ES-DE keys playtime and favorites by
 * marker filename, so IDs must survive sessions; they must also reveal nothing
 * about the original filename, which never enters the frontend's shell command.
 * The secret is machine-local and never leaves main.
 */
export function stableGameID(secret: Uint8Array, game: GameIdentity): string {
  if (!(secret instanceof Uint8Array) || secret.length < 32)
    throw new Error('Game ID secret must be at least 32 bytes');
  if (
    typeof game.volume !== 'string' ||
    !game.volume ||
    game.volume.length > 256 ||
    typeof game.relativePath !== 'string' ||
    !game.relativePath ||
    game.relativePath.startsWith('/') ||
    game.relativePath.split('/').some((part) => part === '..' || !part) ||
    Buffer.byteLength(game.relativePath) > 4096
  )
    throw new Error('Invalid game identity');
  const file = BigInt(game.file);
  if (file < 0n) throw new Error('Invalid game identity');
  // Length-prefixed fields: no separator choice can make two identities collide.
  const fields = [
    game.volume,
    file.toString(),
    game.relativePath.normalize('NFC'),
  ];
  const mac = createHmac('sha256', secret);
  fields.forEach((field) => {
    const bytes = Buffer.from(field, 'utf8');
    const length = Buffer.alloc(4);
    length.writeUInt32BE(bytes.length);
    mac.update(Uint8Array.from(length));
    mac.update(Uint8Array.from(bytes));
  });
  return mac.digest('hex').slice(0, 32);
}
