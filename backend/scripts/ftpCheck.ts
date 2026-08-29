import { withFtpClient } from "../src/ftp/ftpClient.js";
import "dotenv/config";

async function main() {
  await withFtpClient(async (client) => {
    console.log("Подключение к FTP успешно");
    const list = await client.list();
    console.log("Содержимое папки:");
    for (const item of list) {
      console.log(` - ${item.name} (${item.size} байт, ${item.isDirectory ? "папка" : "файл"})`);
    }
  });
}

main().catch((err) => {
  console.error("Ошибка подключения к FTP:", err.message);
  process.exit(1);
});