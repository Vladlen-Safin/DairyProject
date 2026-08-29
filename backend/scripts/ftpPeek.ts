import fs from "node:fs/promises";
import path from "node:path";
import { withFtpClient } from "../src/ftp/ftpClient.js";
import "dotenv/config";

const CACHE_DIR = "./xml-cache";
const SMALL_FILES = [
  "filelist.xml",
  "book.xml",
  "groups.xml",
  "events.xml",
  "final_marks.xml",
  "Message_ОУ_ЭД.xml",
];
const LARGE_FILES = ["events1.xml", "events2.xml"];
const PEEK_BYTES = 3000; // сколько байт с начала большого файла показать

async function main() {
  await fs.mkdir(CACHE_DIR, { recursive: true });

  await withFtpClient(async (client) => {
    for (const name of SMALL_FILES) {
      const localPath = path.join(CACHE_DIR, name);
      try {
        await client.downloadTo(localPath, name);
        const content = await fs.readFile(localPath, "utf-8");
        console.log(`\n===== ${name} (полностью) =====`);
        console.log(content);
      } catch (err) {
        console.log(`\n===== ${name} =====`);
        console.log(`Не удалось скачать/прочитать: ${(err as Error).message}`);
      }
    }

    for (const name of LARGE_FILES) {
      const localPath = path.join(CACHE_DIR, name);
      await client.downloadTo(localPath, name);
      const fd = await fs.open(localPath, "r");
      const buf = Buffer.alloc(PEEK_BYTES);
      const { bytesRead } = await fd.read(buf, 0, PEEK_BYTES, 0);
      await fd.close();
      console.log(`\n===== ${name} (первые ${bytesRead} байт из общего размера) =====`);
      console.log(buf.toString("utf-8", 0, bytesRead));
    }
  });
}

main().catch((err) => {
  console.error("Ошибка:", err.message);
  process.exit(1);
});