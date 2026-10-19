import { readFile } from "node:fs/promises";
import { getMigrations } from "better-auth/db/migration";
import { auth } from "../server/auth.ts";
import { db } from "../server/db.ts";
import { SEED_ENTRIES } from "../src/entries.ts";
import { CATALOG_VERSION } from "../src/libraryVersion.ts";
import { migrateCatalog, withBundledExamples } from "../src/catalog.ts";

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
  if (process.argv.includes("--examples-only")) {
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
