import { hashPassword } from "better-auth/crypto";
import { db } from "../../server/db.ts";

// Administrator-only CLI helper. It is never imported by an HTTP route.
export async function resetAccountPassword(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized))
    throw new Error("邮箱格式无效");
  if (password.length < 10 || password.length > 128)
    throw new Error("新密码需要 10–128 个字符");
  const hash = await hashPassword(password);
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const user = await client.query(
      'SELECT id FROM "user" WHERE email = $1 FOR UPDATE',
      [normalized],
    );
    if (user.rowCount !== 1)
      throw new Error("没有找到这个账号，未修改任何记录");
    const id = user.rows[0].id;
    const updated = await client.query(
      'UPDATE account SET password = $2, "updatedAt" = now() WHERE "userId" = $1 AND "providerId" = $3',
      [id, hash, "credential"],
    );
    if (updated.rowCount !== 1)
      throw new Error("账号没有邮箱密码凭据，未修改任何记录");
    await client.query('DELETE FROM session WHERE "userId" = $1', [id]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
