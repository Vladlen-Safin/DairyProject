import { importLog, importStep, importError, withImportDiagnostics, setImportMessage } from "../import/diagnostics.js";
import type { Request, Response } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { XMLBuilder } from "fast-xml-parser";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { readFileList } from "../xml/filelist.js";
import { importEventsFile } from "../import/eventsFileImporter.js";
import { importBookFile } from "../import/bookImporter.js";
import { importGroupsFile } from "../import/groupsImporter.js";
import { importFinalMarksFile } from "../import/finalMarksImporter.js";
import { upsertFileResult, findMessageResult, allResultsForMessage } from "../import/resultsLog.js";
import {
  downloadFilelist,
  downloadMessageFiles,
  isFreshMessage,
  uploadResult,
  cleanupMessageFiles,
} from "../ftp/syncFromFtp.js";

const NOT_FOUND_MESSAGE = "Не найден файл, либо номер сообщения в файле не соответствует выгрузке";

export async function importXmlHandler(req: Request, res: Response) {
  return withImportDiagnostics(async () => {
    const started = Date.now();
    importLog("request", { status: "START", cacheDir: path.resolve(config.xmlLocalCacheDir) });
    res.type("text/plain; charset=utf-8");
    try {
      await handleImport(req, res);
    } catch (error) {
      importLog("request", { status: "ERROR", ...importError(error) });
      if (!res.headersSent) res.status(500).send("ERROR");
    } finally {
      importLog("request.finished", { httpStatus: res.statusCode, elapsedMs: Date.now() - started });
    }
  });
}

async function handleImport(req: Request, res: Response) {
  if (config.importApiToken) {
    const provided = req.header("x-import-token");
    if (provided !== config.importApiToken) {
      importLog("response", { code: "UNAUTHORIZED" });
      res.status(401).send("UNAUTHORIZED");
      return;
    }
  }

  // Шаг 1: скачиваем filelist.xml с FTP, узнаём messageno
  const filelistPath = await importStep("filelist.download", () => downloadFilelist());
  const filelist = await importStep("filelist.read", () => readFileList(filelistPath));
  const messageno = filelist.messageno;
  setImportMessage(messageno);
  importLog("filelist.loaded", { files: filelist.files });

  const already = await importStep("message.checkCompleted", () => findMessageResult(db, "filelist.xml", messageno));
  if (already) {
    importLog("response", { code: "ALREADY", reason: "Message already completed; result.xml will not be regenerated" });
    res.send("ALREADY");
    return;
  }

  // Шаг 2: если это новое сообщение - подтягиваем с FTP все файлы, которые в нём перечислены.
  // Если это продолжение (CONTINUE с прошлого запроса) - файлы уже в локальном кэше, не перекачиваем.
  const fresh = await importStep("message.checkFresh", () => isFreshMessage(messageno));
  importLog("message.cache", { fresh, reuseCache: !fresh });
  if (fresh) {
    await downloadMessageFiles(filelist.files.map((f) => f.filename));
  }

  let overallContinue = false;

  for (const entry of filelist.files) {
    // book / groups / final_marks импортируются за один проход. Если по этому файлу
    // в рамках сообщения уже есть запись результата (например, из-за CONTINUE по
    // events на прошлой итерации) - повторно не обрабатываем, чтобы не задваивать
    // счётчики и лог ошибок. events так не пропускаем - у него свой чекпоинт.
    if (entry.type !== "events" && (await importStep("file.checkCompleted", () => findMessageResult(db, entry.filename, messageno), { filename: entry.filename }))) {
      importLog("file.skipped", { filename: entry.filename, reason: "Already imported" });
      continue;
    }

    const fileResult = await importStep("file.import", async () => {
      switch (entry.type) {
        case "events":
          return importEventsFile(config.xmlLocalCacheDir, entry.filename, messageno, config.importTimeBudgetMs);
        case "book":
          return importBookFile(config.xmlLocalCacheDir, entry.filename, messageno);
        case "groups":
          return importGroupsFile(config.xmlLocalCacheDir, entry.filename, messageno);
        case "final_marks":
          return importFinalMarksFile(config.xmlLocalCacheDir, entry.filename, messageno);
        default:
          return false;
      }
    }, { filename: entry.filename, type: entry.type });

    if (fileResult === false) {
      importLog("file.rejected", { filename: entry.filename, reason: "Missing file, mismatched MessageNo or unsupported type" });
      await importStep("file.saveResult", () => upsertFileResult(db, entry.filename, messageno, [NOT_FOUND_MESSAGE], 0, 0), { filename: entry.filename });
      continue;
    }

    const completed = fileResult;
    importLog("file.summary", { filename: entry.filename, success: completed.success, fail: completed.fail, errors: completed.errorLog.length, done: completed.done });
    await importStep("file.saveResult", () => upsertFileResult(db, entry.filename, messageno, completed.errorLog, completed.success, completed.fail), { filename: entry.filename });

    if (!fileResult.done) {
      overallContinue = true;
      break;
    }
  }

  if (overallContinue) {
    // Локальный кэш НЕ чистим - на следующей итерации (CONTINUE) файлы понадобятся снова.
    importLog("response", { code: "CONTINUE", reason: "Time budget reached; repeat request to finish import and generate result.xml" });
    res.send("CONTINUE");
    return;
  }

  const results = await importStep("result.load", () => allResultsForMessage(db, messageno));
  let returncode: "DONE" | "ERROR" | "NONE" = "DONE";
  const errorEntries: { filename: string; text: string }[] = [];

  for (const r of results) {
    if (!r.errors) continue;
    if (r.errors === NOT_FOUND_MESSAGE) {
      returncode = "NONE";
      errorEntries.push({ filename: r.file, text: r.errors });
    } else {
      returncode = "ERROR";
      for (const line of r.errors.split("\r\n")) {
        if (line) errorEntries.push({ filename: r.file, text: line });
      }
    }
  }


  // The result object uses the `@_` prefix for XML attributes.  XMLBuilder
  // ignores that convention unless attribute processing is explicitly enabled;
  // without this option it serializes `@_version` and `@_encoding` as invalid
  // XML elements instead of the XML declaration attributes.
  const builder = new XMLBuilder({ format: true, ignoreAttributes: false });
  const resultXml = await importStep("result.build", () => builder.build({
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
    result: {
      "@_creation": new Date().toISOString(),
      MessageNo: messageno,
      errors: { error: errorEntries.map((e) => ({ filename: e.filename, text: e.text })) },
    },
  }), { errorCount: errorEntries.length, returncode });
  const resultPath = path.resolve(config.xmlLocalCacheDir, "result.xml");
  await importStep("result.write", () => fs.writeFile(resultPath, resultXml, "utf-8"), { path: resultPath, bytes: Buffer.byteLength(resultXml) });

  // Шаг 3: отдаём result.xml обратно на FTP, чтобы 1С могла его забрать
  await importStep("result.upload", () => uploadResult());

  await importStep("message.markCompleted", () => upsertFileResult(db, "filelist.xml", messageno, [], 0, 0));

  // Шаг 4: сообщение полностью обработано - локальный кэш файлов этого messageno больше не нужен
  await importStep("cache.cleanup", () => cleanupMessageFiles(filelist.files.map((f) => f.filename)));

  importLog("response", { code: returncode });
  res.send(returncode);
}
