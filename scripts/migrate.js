import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import mysql from "mysql2/promise";
import { loadConfig } from "../src/config.js";

const SQL_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "sql",
);

export async function runMigrations(dbConfig) {
  if (!/^\w+$/.test(dbConfig.database)) {
    throw new Error(`Invalid database name: ${dbConfig.database}`);
  }

  const connection = await mysql.createConnection({
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    password: dbConfig.password,
    multipleStatements: true,
  });

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
    );
    await connection.query(`USE \`${dbConfig.database}\``);

    const files = (await fs.readdir(SQL_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();
    for (const file of files) {
      await connection.query(
        await fs.readFile(path.join(SQL_DIR, file), "utf8"),
      );
      console.log(`Applied ${file}`);
    }
  } finally {
    await connection.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMigrations(loadConfig().db)
    .then(() => console.log("Migrations done."))
    .catch((err) => {
      console.error("Migration failed:", err.message);
      process.exit(1);
    });
}
