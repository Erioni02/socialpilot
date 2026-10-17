// Local PostgreSQL without Docker or an installer: runs the embedded-postgres binaries as a normal process.
// Use this when you don't have a Supabase (or other hosted) database yet. Stop with Ctrl+C.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const port = Number(process.env.LOCAL_DB_PORT ?? 5432);
const dataDir = resolve(import.meta.dirname, "../.data/postgres");
const firstRun = !existsSync(dataDir);

const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "sp", password: "sp", port, persistent: true, onLog: () => {} });

if (firstRun) {
  console.log(`Initialising local database in ${dataDir} ...`);
  await pg.initialise();
}
await pg.start();
for (const name of ["socialpilot", "socialpilot_test"]) {
  try {
    await pg.createDatabase(name);
    console.log(`Created database ${name}`);
  } catch {
    /* already exists */
  }
}
console.log(`Local PostgreSQL ready on postgresql://sp:sp@localhost:${port}/socialpilot  (Ctrl+C to stop)`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
setInterval(() => {}, 1 << 30);
