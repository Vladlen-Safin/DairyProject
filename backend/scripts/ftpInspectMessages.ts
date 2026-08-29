import fs from "node:fs/promises";
import path from "node:path";
import { XMLParser } from "fast-xml-parser";
import { withFtpClient } from "../src/ftp/ftpClient.js";
import "dotenv/config";

const CACHE_DIR = "./xml-cache/messages";

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  removeNSPrefix: true, // убираем v8msg: - удобнее работать с чистыми именами тегов
});

async function main() {
  await fs.mkdir(CACHE_DIR, { recursive: true });

  const messageFiles = await withFtpClient(async (client) => {
    const list = await client.list();
    const names = list
      .filter((f) => !f.isDirectory && f.name.startsWith("Message_") && f.name.endsWith(".xml"))
      .map((f) => f.name);

    for (const name of names) {
      await client.downloadTo(path.join(CACHE_DIR, name), name);
    }
    return names;
  });

  if (messageFiles.length === 0) {
    console.log("Файлов Message_*.xml на FTP не найдено.");
    return;
  }

  console.log(`Найдено файлов Message_*.xml: ${messageFiles.length}\n`);

  for (const name of messageFiles) {
    const xml = await fs.readFile(path.join(CACHE_DIR, name), "utf-8");
    const doc = parser.parse(xml);
    const message = doc.Message;

    const header = message?.Header;
    const body = message?.Body;

    console.log(`===== ${name} =====`);
    console.log(`ExchangePlan: ${header?.ExchangePlan}`);
    console.log(`From -> To:   ${header?.From} -> ${header?.To}`);
    console.log(`MessageNo:    ${header?.MessageNo}  ReceivedNo: ${header?.ReceivedNo}`);

    if (!body) {
      console.log("Body пустой\n");
      continue;
    }

    console.log("Типы объектов в Body:");
    for (const key of Object.keys(body)) {
      const value = body[key];
      const count = Array.isArray(value) ? value.length : 1;
      console.log(`  - ${key}: ${count} шт.`);
    }
    console.log();
  }
}

main().catch((err) => {
  console.error("Ошибка:", err.message);
  process.exit(1);
});