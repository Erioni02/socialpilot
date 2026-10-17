// Local PostgreSQL without Docker or an installer: runs the embedded-postgres binaries as a normal process.
// Use this when you don't have a Supabase (or other hosted) database yet. Stop with Ctrl+C.
import EmbeddedPostgres from "embedded-postgres";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const port = Number(process.env.LOCAL_DB_PORT ?? 5432);
const dataDir = resolve(import.meta.dirname, "../.data/postgres");
const firstRun = !existsSync(dataDir);

const pg = new EmbeddedPostgres({ databaseDir: dataDir, user: "sp", password: "sp", port, persistent: true,
  // Force UTF-8: on Windows initdb otherwise picks the system code page (e.g. WIN1252) and rejects emoji/arrows.
  initdbFlags: ["--encoding=UTF8", "--locale=C"],
  onLog: () => {}
});

if (firstRun) {
  console.log(`Initialising local database in ${dataDir} ...`);
  await pg.initialise();
}
await pg.start();
const client = pg.getPgClient();
await client.connect();
const { rows } = await client.query("SHOW server_encoding");
await client.end();
if (rows[0].server_encoding !== "UTF8") {
  console.error(`The local database in ${dataDir} uses ${rows[0].server_encoding}, not UTF8. Stop this script, delete that folder, and run it again.`);
  await pg.stop();
  process.exit(1);
}
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
