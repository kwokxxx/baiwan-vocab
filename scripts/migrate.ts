import { readFile } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
import { auth } from "../server/auth.ts";
import { db } from "../server/db.ts";
import { SEED_ENTRIES } from "../src/entries.ts";
import { CATALOG_VERSION } from "../src/libraryVersion.ts";
import { migrateCatalog, withBundledExamples } from "../src/catalog.ts";
import { phraseKey } from "../src/phraseKey.ts";

async function appendPhrases51133() {
  const additions = SEED_ENTRIES.filter((entry) =>
    entry.id.startsWith("phrase-51133-"),
  );
  const baseline = SEED_ENTRIES.filter(
    (entry) => !entry.id.startsWith("phrase-51133-"),
  );
  if (!additions.length)
    throw new Error("No 51133 additions have been compiled.");
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(5113308)");
    const existing = await client.query(
      "SELECT id, entry, position FROM shared_entries ORDER BY position, id FOR UPDATE",
    );
    const byId = new Map(existing.rows.map((row) => [row.id, row]));
    const byTerm = new Map(
      existing.rows.map((row) => [phraseKey(row.entry.term), row.id]),
    );
    if (!baseline.every((entry) => byId.has(entry.id)))
      throw new Error("Existing baseline IDs differ; append aborted.");
    const next = [];
    let position = Math.max(-1, ...existing.rows.map((row) => row.position));
    for (const entry of additions) {
      const key = phraseKey(entry.term);
      const saved = byId.get(entry.id);
      if (saved) {
        if (phraseKey(saved.entry.term) !== key)
          throw new Error(
            "An addition ID conflicts with existing text; append aborted.",
          );
        continue;
      }
      if (byTerm.has(key))
        throw new Error(`Phrase already has another ID: ${entry.term}`);
      if (!entry.example.trim() || !entry.translation.trim())
        throw new Error(`Missing bilingual example: ${entry.term}`);
      next.push({ id: entry.id, entry, position: ++position });
      byTerm.set(key, entry.id);
    }
    if (next.length) {
      await client.query(
        "INSERT INTO catalog_archives(catalog_version,entries) VALUES ($1,$2) ON CONFLICT DO NOTHING",
        [
          `${CATALOG_VERSION}:before-51133-v1`,
          JSON.stringify(existing.rows.map((row) => row.entry)),
        ],
      );
      const inserted = await client.query(
        "INSERT INTO shared_entries(id, entry, position) SELECT id, entry, position FROM jsonb_to_recordset($1::jsonb) AS x(id text, entry jsonb, position integer) ON CONFLICT(id) DO NOTHING",
        [JSON.stringify(next)],
      );
      if (inserted.rowCount !== next.length)
        throw new Error("Concurrent catalog change; append rolled back.");
    }
    await client.query("COMMIT");
    console.log(
      `Appended ${next.length} phrases. Existing ${existing.rows.length} entries and all learning records unchanged.`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function updateExamples() {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "SELECT id, entry FROM shared_entries WHERE id = ANY($1::text[]) ORDER BY position, id FOR UPDATE",
      [SEED_ENTRIES.map((entry) => entry.id)],
    );
    if (result.rows.length !== SEED_ENTRIES.length)
      throw new Error("Shared phrase IDs differ; example update aborted.");
    await client.query(
      "INSERT INTO catalog_archives(catalog_version,entries) VALUES ($1,$2) ON CONFLICT DO NOTHING",
      [
        `${CATALOG_VERSION}:before-examples-v1`,
        JSON.stringify(result.rows.map((row) => row.entry)),
      ],
    );
    let updated = 0;
    for (const row of result.rows) {
      const [entry] = withBundledExamples([row.entry]);
      if (entry === row.entry) continue;
      await client.query(
        "UPDATE shared_entries SET entry=$2, updated_at=now() WHERE id=$1",
        [row.id, entry],
      );
      updated++;
    }
    await client.query("COMMIT");
    console.log(
      `Examples ready: ${updated} shared entries updated; IDs, order and all learning records unchanged.`,
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  if (process.argv.includes("--append-51133")) {
    await appendPhrases51133();
  } else if (process.argv.includes("--examples-only")) {
    await updateExamples();
  } else {
    const migration = await getMigrations(auth.options);
    await migration.runMigrations();
    await db.query(
      await readFile(new URL("../server/schema.sql", import.meta.url), "utf8"),
    );
    if (process.argv.includes("--schema-only")) {
      console.log(
        "Database schema ready; library and learning records unchanged.",
      );
    } else {
      const client = await db.connect();
      try {
        await client.query("BEGIN");
        await client.query(
          "INSERT INTO catalog_archives(catalog_version,entries) SELECT $1, COALESCE(jsonb_agg(entry ORDER BY position),'[]'::jsonb) FROM shared_entries ON CONFLICT DO NOTHING",
          [CATALOG_VERSION],
        );
        const states = await client.query(
          "SELECT user_id, data FROM study_states FOR UPDATE",
        );
        for (const row of states.rows) {
          const next = migrateCatalog(row.data);
          if (next === row.data) continue;
          await client.query(
            "INSERT INTO study_state_archives(user_id,catalog_version,data) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            [row.user_id, CATALOG_VERSION, row.data],
          );
          await client.query(
            "UPDATE study_states SET data=$2,revision=revision+1,updated_at=now() WHERE user_id=$1",
            [row.user_id, next],
          );
        }
        await client.query(
          "DELETE FROM shared_entries WHERE NOT (id = ANY($1::text[]))",
          [SEED_ENTRIES.map((e) => e.id)],
        );
        for (const [position, entry] of SEED_ENTRIES.entries()) {
          await client.query(
            "INSERT INTO shared_entries (id, entry, position) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET entry = EXCLUDED.entry, position = EXCLUDED.position, updated_at = now()",
            [entry.id, entry, position],
          );
        }
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
      console.log(
        `Database ready. ${SEED_ENTRIES.length} shared vocabulary entries stored.`,
      );
    }
  }
} finally {
  await db.end();
}
