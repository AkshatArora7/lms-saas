import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

/**
 * Local password hashing using Node's built-in scrypt (no native deps).
 *
 * Stored format: `scrypt$N$r$p$<saltHex>$<hashHex>`. Parameters are embedded so
 * they can be tuned later without breaking existing hashes. Verification is
 * constant-time. SSO-only users never get a hash (auth flows through their IdP).
 */
const KEY_LEN = 64;
const SCRYPT_N = 16_384; // CPU/memory cost
const SCRYPT_R = 8;
const SCRYPT_P = 1;

interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

function deriveKey(
  password: string,
  salt: Buffer,
  keyLen: number,
  params: ScryptParams,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(
      password,
      salt,
      keyLen,
      { ...params, maxmem: 64 * 1024 * 1024 },
      (err, derived) => {
        if (err) reject(err);
        else resolve(derived);
      },
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await deriveKey(password, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return [
    "scrypt",
    SCRYPT_N,
    SCRYPT_R,
    SCRYPT_P,
    salt.toString("hex"),
    derived.toString("hex"),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const nStr = parts[1] ?? "";
  const rStr = parts[2] ?? "";
  const pStr = parts[3] ?? "";
  const saltHex = parts[4] ?? "";
  const hashHex = parts[5] ?? "";
  const expected = Buffer.from(hashHex, "hex");
  const derived = await deriveKey(
    password,
    Buffer.from(saltHex, "hex"),
    expected.length,
    { N: Number(nStr), r: Number(rStr), p: Number(pStr) },
  );
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
