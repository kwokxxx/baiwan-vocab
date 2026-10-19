import { auth, appOrigin } from "./auth.ts";
import { db } from "./db.ts";
import { handleBackup } from "./backups.ts";
import { CATALOG_VERSION } from "../src/libraryVersion.ts";
import { SEED_ENTRIES } from "../src/entries.ts";
import { migrateCatalog } from "../src/catalog.ts";
import { mergeSessionSlots } from "../src/session.ts";
import { applyEntryDeletions, emptyData, parseBackup } from "../src/study.ts";

function json(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "Cache-Control": "private, no-store", Vary: "Cookie" },
  });
}
const allowedAuthPaths = new Set([
  "/sign-up/email",
  "/sign-in/email",
  "/sign-out",
  "/get-session",
  "/change-password",
]);
export async function handleRequest(request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  try {
    if (!["GET", "POST"].includes(request.method))
      return json({ error: "不支持此操作" }, 405);
    if (request.method === "POST") {
      // All mutations are same-origin JSON. Cookies alone never authorize cross-site writes.
      if (request.headers.get("origin") !== appOrigin)
        return json({ error: "请求来源无效" }, 403);
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        return json({ error: "需要 JSON 请求" }, 415);
      if (Number(request.headers.get("content-length") ?? 0) > 3_000_000)
        return json({ error: "数据过大，请先导出备份" }, 413);
    }
    if (path === "/api/backups") return await handleBackup(request);
    if (path.startsWith("/api/auth/")) {
      if (!allowedAuthPaths.has(path.slice("/api/auth".length)))
        return json({ error: "此账号功能尚未开放" }, 404);
      const response = await auth.handler(request);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    }
    if (path === "/api/health" && request.method === "GET") {
      try {
        await db.query("SELECT 1");
        return json({ server: "ok", database: "ok" });
      } catch {
        return json({ server: "ok", database: "unavailable" }, 503);
      }
    }
    if (path === "/api/library" && request.method === "GET") {
      const result = await db.query(
        "SELECT entry FROM shared_entries ORDER BY position, id",
      );
      const entries = result.rows.map((row) => row.entry);
      const matches =
        entries.length === SEED_ENTRIES.length &&
        entries.every((e, i) => e.id === SEED_ENTRIES[i].id);
      return json({
        catalogVersion: CATALOG_VERSION,
        entries: matches ? entries : SEED_ENTRIES,
      });
    }
    if (path !== "/api/study") return json({ error: "接口不存在" }, 404);
    const session = await auth.api.getSession({ headers: request.headers });
    if (!session) return json({ error: "请登录后同步" }, 401);
    const userId = session.user.id; // Never accept an account ID from the client.
    if (
      request.headers.get("x-shici-account") &&
      request.headers.get("x-shici-account") !== userId
    )
      return json({ error: "账号已切换，请重新登录" }, 401);
    // Rolling-deployment safety: archive and normalize an old account atomically
    // before a new client sees it or submits its first write.
    const migrationClient = await db.connect();
    try {
      await migrationClient.query("BEGIN");
      const previous = await migrationClient.query(
        "SELECT data FROM study_states WHERE user_id=$1 FOR UPDATE",
        [userId],
      );
      if (
        previous.rowCount &&
        previous.rows[0].data.catalogVersion !== CATALOG_VERSION
      ) {
        await migrationClient.query(
          "INSERT INTO study_state_archives(user_id,catalog_version,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
          [userId, CATALOG_VERSION, previous.rows[0].data],
        );
        await migrationClient.query(
          "UPDATE study_states SET data=$2,revision=revision+1,updated_at=now() WHERE user_id=$1",
          [userId, migrateCatalog(previous.rows[0].data)],
        );
      }
      await migrationClient.query("COMMIT");
    } catch (error) {
      await migrationClient.query("ROLLBACK");
      throw error;
    } finally {
      migrationClient.release();
    }
    if (request.method === "GET") {
      const result = await db.query(
        "SELECT revision, data FROM study_states WHERE user_id = $1",
        [userId],
      );
      return json({
        userId,
        ...(result.rows[0] ?? { revision: 0, data: emptyData() }),
      });
    }
    const text = await request.text();
    if (Buffer.byteLength(text) > 3_000_000)
      return json({ error: "数据过大，请先导出备份" }, 413);
    let body;
    try {
      body = JSON.parse(text);
      if (
        !body ||
        !Number.isSafeInteger(body.revision) ||
        body.revision < 0 ||
        !/^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(
          body.mutationId,
        )
      )
        throw new Error();
      body.data = parseBackup(body.data);
      if (
        body.data.catalogVersion !== CATALOG_VERSION ||
        request.headers.get("x-shici-protocol") !== "daily-v1"
      )
        return json(
          { error: "词库已更新，请更新应用后再同步；本地记录仍会保留。" },
          426,
        );
    } catch {
      return json({ error: "学习数据格式无效" }, 400);
    }
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO study_states (user_id, data) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        [userId, emptyData()],
      );
      const result = await client.query(
        "SELECT revision, data FROM study_states WHERE user_id = $1 FOR UPDATE",
        [userId],
      );
      const current = result.rows[0];
      const receipt = await client.query(
        "SELECT 1 FROM sync_receipts WHERE user_id = $1 AND mutation_id = $2",
        [userId, body.mutationId],
      );
      if (receipt.rowCount) {
        await client.query("COMMIT");
        return json({ userId, ...current });
      }
      if (current.revision !== body.revision) {
        await client.query("ROLLBACK");
        return json({ userId, ...current }, 409);
      }
      // An older offline client/backup may omit deletion metadata. Preserve it.
      // Only an explicit false from an up-to-date client is an undo operation.
      body.data = applyEntryDeletions({
        ...body.data,
        ...(current.data.sessionSlots || body.data.sessionSlots
          ? { sessionSlots: mergeSessionSlots(current.data, body.data) }
          : {}),
        deletedEntries: {
          ...current.data.deletedEntries,
          ...body.data.deletedEntries,
        },
      });
      const updated = await client.query(
        "UPDATE study_states SET revision = revision + 1, data = $2, updated_at = now() WHERE user_id = $1 RETURNING revision, data",
        [userId, body.data],
      );
      await client.query(
        "INSERT INTO sync_receipts (user_id, mutation_id) VALUES ($1, $2)",
        [userId, body.mutationId],
      );
      // Old receipts can expire: the revision check still prevents an old retry overwriting data.
      await client.query(
        "DELETE FROM sync_receipts WHERE user_id = $1 AND created_at < now() - interval '90 days'",
        [userId],
      );
      await client.query("COMMIT");
      return json({ userId, ...updated.rows[0] });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    // Do not put database URLs, passwords, request bodies or personal data in logs.
    console.error(
      "Cloud request failed",
      error instanceof Error ? error.name : "UnknownError",
    );
    return json({ error: "云端暂时不可用，本地记录仍会保留，请稍后重试" }, 503);
  }
}
