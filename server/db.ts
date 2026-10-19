import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString)
  throw new Error("DATABASE_URL is required on the server");
const connection = new URL(connectionString);
// Require certificate verification, including when the provider supplies sslmode=require.
connection.searchParams.set("sslmode", "verify-full");
export const db = new Pool({
  connectionString: connection.toString(),
  max: 3,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
  allowExitOnIdle: true,
});
