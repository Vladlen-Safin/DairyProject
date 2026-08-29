import fs from "node:fs";
import path from "node:path";
import { db } from "../db/index.js";
import { readChunkedXml } from "../xml/chunkedXmlReader.js";
import { loadHelperCaches } from "./helperTables.js";
import { importEventsBatch } from "./eventsImporter.js";
import { getCheckpoint, saveCheckpoint, clearCheckpoint } from "./checkpoint.js";
import type { RawEvent } from "../xml/eventsTypes.js";

const BATCH_SIZE = 500;

export interface FileImportResult {
  success: number;
  fail: number;
  errorLog: string[];
  done: boolean;
}

export async function importEventsFile(
  xmlFolder: string,
  filename: string,
  messageno: string,
  timeBudgetMs: number,
): Promise<FileImportResult | false> {
  const filePath = path.join(xmlFolder, filename);
  if (!fs.existsSync(filePath)) return false;

  const fileMessageNo = await peekMessageNo(filePath);
  if (fileMessageNo !== messageno) return false;

  const checkpoint = await getCheckpoint(db, messageno, filename);
  const alreadyProcessed = checkpoint?.processed_count ?? 0;

  const caches = await loadHelperCaches(db);
  const errorLog: string[] = [];
  let success = 0;
  let fail = 0;
  let seen = 0;
  let batch: RawEvent[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    const stats = await importEventsBatch(db, caches, batch, errorLog);
    success += stats.success;
    fail += stats.fail;
    batch = [];
  };

  const startedAt = Date.now();
  const signal = { aborted: false };
  const stream = fs.createReadStream(filePath, { encoding: "utf-8" });

  await readChunkedXml(stream, {
    collectPath: ["file", "events", "event"],
    signal,
    onItem: async (item) => {
      seen++;
      // Пропускаем то, что уже обработали на предыдущих итерациях (аналог "откусывания головы" из PHP)
      if (seen > alreadyProcessed) {
        batch.push(item as unknown as RawEvent);
        if (batch.length >= BATCH_SIZE) await flush();
      }
      if (!signal.aborted && Date.now() - startedAt >= timeBudgetMs) {
        signal.aborted = true;
      }
    },
  });

  await flush();

  if (signal.aborted) {
    await saveCheckpoint(db, messageno, filename, seen);
    return { success, fail, errorLog, done: false };
  }

  await clearCheckpoint(db, messageno, filename);
  return { success, fail, errorLog, done: true };
}

async function peekMessageNo(filePath: string): Promise<string> {
  // MessageNo лежит в начале файла - достаточно прочитать небольшой первый кусок,
  // не читая весь (потенциально многомегабайтный) файл целиком.
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(2048);
    const bytesRead = fs.readSync(fd, buf, 0, 2048, 0);
    const head = buf.toString("utf-8", 0, bytesRead);
    return head.match(/<MessageNo>([^<]*)<\/MessageNo>/)?.[1]?.trim() ?? "";
  } finally {
    fs.closeSync(fd);
  }
}