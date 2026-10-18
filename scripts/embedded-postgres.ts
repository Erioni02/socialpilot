/**
 * Local PostgreSQL for development without Docker.
 * Runs a real PostgreSQL 17 server (binaries from the embedded-postgres package) with data in ./.data/pg.
 * Usage: pnpm db:start   (keep it running in its own terminal)
 */
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import path from "node:path";

const port = Number(process.env.EMBEDDED_PG_PORT ?? 5433);
const dataDir = path.resolve(process.cwd(), ".data/pg");
const fresh = !existsSync(path.join(dataDir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "socialpilot",
  password: "socialpilot",
  port,
  persistent: true,
  // UTF-8 regardless of the host's locale (Windows defaults to WIN1252).
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {},
});

if (fresh) await pg.initialise();
await pg.start();
for (const db of ["socialpilot", "socialpilot_test"]) {
  try {
    await pg.createDatabase(db);
    console.log(`Created database ${db}`);
  } catch {
    /* already exists */
  }
}
console.log(`PostgreSQL ready on postgresql://socialpilot:socialpilot@localhost:${port}/socialpilot`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
