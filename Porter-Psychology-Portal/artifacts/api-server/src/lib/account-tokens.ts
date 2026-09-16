import { createHash, randomBytes } from "node:crypto";
import type { RowDataPacket } from "mysql2/promise";
import { execute, one, type Executor } from "./mysql";

export type AccountTokenPurpose =
  "verify_email" | "reset_password" | "change_email";

export function hashAccountToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function createAccountToken(
  userId: number,
  purpose: AccountTokenPurpose,
  lifetimeMs: number,
  newEmail?: string,
  executor?: Executor,
) {
  const token = randomBytes(32).toString("hex");
  await execute(
    "DELETE FROM auth_tokens WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL",
    [userId, purpose],
    executor,
  );
  await execute(
    `INSERT INTO auth_tokens
       (user_id, token_hash, purpose, new_email, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      userId,
      hashAccountToken(token),
      purpose,
      newEmail ?? null,
      new Date(Date.now() + lifetimeMs).toISOString(),
    ],
    executor,
  );
  return token;
}

export function findAccountToken(
  token: string,
  purpose: AccountTokenPurpose,
  executor?: Executor,
) {
  return one<
    RowDataPacket & {
      id: number;
      user_id: number;
      new_email: string | null;
    }
  >(
    `SELECT id, user_id, new_email FROM auth_tokens
     WHERE token_hash = ? AND purpose = ? AND consumed_at IS NULL
       AND expires_at > UTC_TIMESTAMP(3)
     FOR UPDATE`,
    [hashAccountToken(token), purpose],
    executor,
  );
}
