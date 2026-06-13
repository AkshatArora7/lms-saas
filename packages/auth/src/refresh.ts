import { createHash, randomBytes } from "node:crypto";

/**
 * Opaque refresh tokens. The raw token is returned to the client exactly once;
 * only its SHA-256 hash is persisted, so a database leak cannot be replayed.
 *
 * Rotation model: every login opens a token `family`; each refresh revokes the
 * presented token and issues a successor in the same family. Presenting an
 * already-revoked token (theft/replay) is detected by the identity service,
 * which then revokes the entire family.
 */
export interface RefreshTokenMaterial {
  /** Returned to the caller once; never stored. */
  token: string;
  /** SHA-256 hex digest persisted in `refresh_token.token_hash`. */
  hash: string;
}

export function generateRefreshToken(): RefreshTokenMaterial {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashRefreshToken(token) };
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
