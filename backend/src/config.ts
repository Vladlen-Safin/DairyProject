// import "dotenv/config";

// function required(name: string): string {
//   const value = process.env[name];
//   if (!value) throw new Error(`Не задана переменная окружения ${name}`);
//   return value;
// }

// export const config = {
//   databaseUrl: required("DATABASE_URL"),
//   dbPoolSize: Number(process.env.DB_POOL_SIZE ?? 10),
//   xmlFolder: required("XML_FOLDER"),
//   port: Number(process.env.PORT ?? 3000),
//   importTimeBudgetMs: Number(process.env.IMPORT_TIME_BUDGET_MS ?? 20000),
//   importApiToken: process.env.IMPORT_API_TOKEN || null,
// };

import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Не задана переменная окружения ${name}`);
  return value;
}

export const config = {
  databaseUrl: required("DATABASE_URL"),
  dbPoolSize: Number(process.env.DB_POOL_SIZE ?? 10),
  xmlLocalCacheDir: process.env.XML_LOCAL_CACHE_DIR ?? "./xml-cache",
  port: Number(process.env.PORT ?? 3000),
  importTimeBudgetMs: Number(process.env.IMPORT_TIME_BUDGET_MS ?? 20000),
  importApiToken: process.env.IMPORT_API_TOKEN || null,

  ftp: {
    host: required("FTP_HOST"),
    port: Number(process.env.FTP_PORT ?? 21),
    user: required("FTP_USER"),
    password: required("FTP_PASSWORD"),
    secure: process.env.FTP_SECURE === "true",
    remoteDir: process.env.FTP_REMOTE_DIR ?? "/",
  },
};