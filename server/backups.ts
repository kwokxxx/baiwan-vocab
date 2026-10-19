import { createHash } from "node:crypto";
import { db } from "./db.ts";
import { parseBackup } from "../src/study.ts";

const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const reply = (value: unknown, status = 200) =>
  Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Authorization" },
  });
export async function handleBackup(request: Request) {
  const token =
    request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
  if (!/^bw1_[a-f0-9]{64}$/.test(token))
    return reply({ error: "请提供完整的云备份恢复码" }, 401);
  const limitKey = hash(
    (request.headers.get("x-real-ip") ?? "unknown") +
      new Date().toISOString().slice(0, 13),
  );
  const limit = await db.query(
    "INSERT INTO backup_rate_limits (bucket, attempts) VALUES ($1, 1) ON CONFLICT (bucket) DO UPDATE SET attempts = backup_rate_limits.attempts + 1 WHERE backup_rate_limits.attempts < 120 RETURNING attempts",
    [limitKey],
  );
  if (!limit.rowCount) return reply({ error: "备份请求较多，请稍后重试" }, 429);
  const key = hash(token);
  if (request.method === "GET") {
    const result = await db.query(
      'SELECT snapshot, revision, updated_at AS "updatedAt" FROM guest_backups WHERE key_hash=$1',
      [key],
    );
    return result.rowCount
      ? reply(result.rows[0])
      : reply({ error: "没有找到这个恢复码对应的备份" }, 404);
  }
  let snapshot, revision;
  try {
    const text = await request.text();
    if (Buffer.byteLength(text) > 3_000_000)
      return reply({ error: "备份超过 3MB，请先导出文件保存" }, 413);
    const body = JSON.parse(text);
    snapshot = parseBackup(body.snapshot);
    revision = body.revision;
    if (!snapshot.library || !Number.isSafeInteger(revision) || revision < 0)
      throw new Error();
  } catch {
    return reply({ error: "备份格式不正确，未写入云端" }, 400);
  }
  const writeLimit = await db.query(
    "INSERT INTO backup_rate_limits(bucket,attempts) VALUES($1,1) ON CONFLICT(bucket) DO UPDATE SET attempts=backup_rate_limits.attempts+1 WHERE backup_rate_limits.attempts<20 RETURNING attempts",
    [hash(`${limitKey}:write`)],
  );
  if (!writeLimit.rowCount)
    return reply(
      { error: "本小时上传较多，请稍后重试，或导出文件保存。" },
      429,
    );
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Bound anonymous storage without deleting anyone's existing backup.
    await client.query("SELECT pg_advisory_xact_lock(4985507)");
    const space = await client.query(
      "SELECT COALESCE(sum(pg_column_size(snapshot)),0)::bigint AS used FROM guest_backups WHERE key_hash<>$1",
      [key],
    );
    if (
      Number(space.rows[0].used) +
        Buffer.byteLength(JSON.stringify(snapshot)) * 1.2 >
      150_000_000
    ) {
      await client.query("ROLLBACK");
      return reply(
        { error: "云备份空间暂时不足，请先导出文件保存。本机记录不受影响。" },
        503,
      );
    }
    const result =
      revision === 0
        ? await client.query(
            'INSERT INTO guest_backups(key_hash,snapshot,revision) VALUES ($1,$2,1) ON CONFLICT DO NOTHING RETURNING revision, updated_at AS "updatedAt"',
            [key, snapshot],
          )
        : await client.query(
            'UPDATE guest_backups SET snapshot=$2, revision=revision+1, updated_at=now() WHERE key_hash=$1 AND revision=$3 RETURNING revision, updated_at AS "updatedAt"',
            [key, snapshot, revision],
          );
    await client.query("COMMIT");
    if (!result.rowCount)
      return reply(
        {
          error:
            "此恢复码已有更新的备份。请先读取云端备份，或创建新的备份码，避免覆盖其他设备的记录。",
        },
        409,
      );
    await client.query(
      "DELETE FROM backup_rate_limits WHERE created_at < now() - interval '2 days'",
    );
    return reply(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
