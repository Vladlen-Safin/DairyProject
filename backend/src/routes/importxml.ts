// import type { Request, Response } from "express";
// import path from "node:path";
// import fs from "node:fs/promises";
// import { XMLBuilder } from "fast-xml-parser";
// import { config } from "../config.js";
// import { db } from "../db/index.js";
// import { readFileList } from "../xml/filelist.js";
// import { importEventsFile } from "../import/eventsFileImporter.js";
// import { upsertFileResult, findMessageResult, allResultsForMessage } from "../import/resultsLog.js";

// const NOT_FOUND_MESSAGE = "Не найден файл, либо номер сообщения в файле не соответствует выгрузке";

// export async function importXmlHandler(req: Request, res: Response) {
//   res.type("text/plain; charset=utf-8");

//   if (config.importApiToken) {
//     const provided = req.header("x-import-token");
//     if (provided !== config.importApiToken) {
//       res.status(401).send("UNAUTHORIZED");
//       return;
//     }
//   }

//   const filelistPath = path.join(config.xmlFolder, "filelist.xml");
//   const filelist = await readFileList(filelistPath);
//   const messageno = filelist.messageno;

//   const already = await findMessageResult(db, "filelist.xml", messageno);
//   if (already) {
//     res.send("ALREADY");
//     return;
//   }

//   let overallContinue = false;

//   for (const entry of filelist.files) {
//     let fileResult: { success: number; fail: number; errorLog: string[]; done: boolean } | false;

//     switch (entry.type) {
//       case "events":
//         fileResult = await importEventsFile(config.xmlFolder, entry.filename, messageno, config.importTimeBudgetMs);
//         break;
//       // TODO: следующим шагом - book / groups / final_marks по тому же шаблону,
//       // что и importEventsFile: свой streaming-парсер + свой batch-импортер.
//       case "book":
//       case "groups":
//       case "final_marks":
//         fileResult = { success: 0, fail: 0, errorLog: [], done: true };
//         break;
//       default:
//         fileResult = false;
//     }

//     if (fileResult === false) {
//       await upsertFileResult(db, entry.filename, messageno, [NOT_FOUND_MESSAGE], 0, 0);
//       continue;
//     }

//     await upsertFileResult(db, entry.filename, messageno, fileResult.errorLog, fileResult.success, fileResult.fail);

//     if (!fileResult.done) {
//       overallContinue = true;
//       break; // как и в оригинале - прерываем проход по файлам на первом незавершённом
//     }
//   }

//   if (overallContinue) {
//     res.send("CONTINUE");
//     return;
//   }

//   const results = await allResultsForMessage(db, messageno);
//   let returncode: "DONE" | "ERROR" | "NONE" = "DONE";
//   const errorEntries: { filename: string; text: string }[] = [];

//   for (const r of results) {
//     if (!r.errors) continue;
//     if (r.errors === NOT_FOUND_MESSAGE) {
//       returncode = "NONE";
//       errorEntries.push({ filename: r.file, text: r.errors });
//     } else {
//       returncode = "ERROR";
//       for (const line of r.errors.split("\r\n")) {
//         if (line) errorEntries.push({ filename: r.file, text: line });
//       }
//     }
//   }

//   await upsertFileResult(db, "filelist.xml", messageno, [], 0, 0);

//   const builder = new XMLBuilder({ format: true });
//   const resultXml = builder.build({
//     "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
//     result: {
//       "@_creation": new Date().toISOString(),
//       MessageNo: messageno,
//       errors: { error: errorEntries.map((e) => ({ filename: e.filename, text: e.text })) },
//     },
//   });
//   await fs.writeFile(path.join(config.xmlFolder, "result.xml"), resultXml, "utf-8");

//   res.send(returncode);
// }


import type { Request, Response } from "express";
import path from "node:path";
import fs from "node:fs/promises";
import { XMLBuilder } from "fast-xml-parser";
import { config } from "../config.js";
import { db } from "../db/index.js";
import { readFileList } from "../xml/filelist.js";
import { importEventsFile } from "../import/eventsFileImporter.js";
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
  res.type("text/plain; charset=utf-8");

  if (config.importApiToken) {
    const provided = req.header("x-import-token");
    if (provided !== config.importApiToken) {
      res.status(401).send("UNAUTHORIZED");
      return;
    }
  }

  // Шаг 1: скачиваем filelist.xml с FTP, узнаём messageno
  const filelistPath = await downloadFilelist();
  const filelist = await readFileList(filelistPath);
  const messageno = filelist.messageno;

  const already = await findMessageResult(db, "filelist.xml", messageno);
  if (already) {
    res.send("ALREADY");
    return;
  }

  // Шаг 2: если это новое сообщение - подтягиваем с FTP все файлы, которые в нём перечислены.
  // Если это продолжение (CONTINUE с прошлого запроса) - файлы уже в локальном кэше, не перекачиваем.
  const fresh = await isFreshMessage(messageno);
  if (fresh) {
    await downloadMessageFiles(filelist.files.map((f) => f.filename));
  }

  let overallContinue = false;

  for (const entry of filelist.files) {
    let fileResult: { success: number; fail: number; errorLog: string[]; done: boolean } | false;

    switch (entry.type) {
      case "events":
        fileResult = await importEventsFile(
          config.xmlLocalCacheDir,
          entry.filename,
          messageno,
          config.importTimeBudgetMs,
        );
        break;
      case "book":
      case "groups":
      case "final_marks":
        fileResult = { success: 0, fail: 0, errorLog: [], done: true };
        break;
      default:
        fileResult = false;
    }

    if (fileResult === false) {
      await upsertFileResult(db, entry.filename, messageno, [NOT_FOUND_MESSAGE], 0, 0);
      continue;
    }

    await upsertFileResult(db, entry.filename, messageno, fileResult.errorLog, fileResult.success, fileResult.fail);

    if (!fileResult.done) {
      overallContinue = true;
      break;
    }
  }

  if (overallContinue) {
    // Локальный кэш НЕ чистим - на следующей итерации (CONTINUE) файлы понадобятся снова.
    res.send("CONTINUE");
    return;
  }

  const results = await allResultsForMessage(db, messageno);
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

  await upsertFileResult(db, "filelist.xml", messageno, [], 0, 0);

  const builder = new XMLBuilder({ format: true });
  const resultXml = builder.build({
    "?xml": { "@_version": "1.0", "@_encoding": "UTF-8" },
    result: {
      "@_creation": new Date().toISOString(),
      MessageNo: messageno,
      errors: { error: errorEntries.map((e) => ({ filename: e.filename, text: e.text })) },
    },
  });
  await fs.writeFile(path.join(config.xmlLocalCacheDir, "result.xml"), resultXml, "utf-8");

  // Шаг 3: отдаём result.xml обратно на FTP, чтобы 1С могла его забрать
  await uploadResult();

  // Шаг 4: сообщение полностью обработано - локальный кэш файлов этого messageno больше не нужен
  await cleanupMessageFiles(filelist.files.map((f) => f.filename));

  res.send(returncode);
}