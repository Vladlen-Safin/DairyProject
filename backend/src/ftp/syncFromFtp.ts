import fs from "node:fs/promises";
import path from "node:path";
import { withFtpClient } from "./ftpClient.js";
import { config } from "../config.js";
import { db } from "../db/index.js";

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

/**
 * Скачивает filelist.xml с FTP в локальный кэш. Файл маленький - качаем на каждый
 * вызов /importxml, чтобы всегда видеть актуальный MessageNo от 1С.
 */
export async function downloadFilelist(): Promise<string> {
  await ensureDir(config.xmlLocalCacheDir);
  const localPath = path.join(config.xmlLocalCacheDir, "filelist.xml");
  await withFtpClient((client) => client.downloadTo(localPath, "filelist.xml"));
  return localPath;
}

/**
 * Определяет, начинаем ли мы новое сообщение (нужно скачать все файлы заново)
 * или продолжаем ранее прерванный по таймауту импорт (файлы уже в локальном кэше -
 * повторно их с FTP не тащим, чтобы не гонять многомегабайтные events.xml на каждой
 * CONTINUE-итерации).
 */
export async function isFreshMessage(messageno: string): Promise<boolean> {
  const existingResult = await db
    .selectFrom("ediary_import_results")
    .select("id")
    .where("messageno", "=", messageno)
    .executeTakeFirst();

  const existingCheckpoint = await db
    .selectFrom("ediary_import_checkpoint")
    .select("id")
    .where("messageno", "=", messageno)
    .executeTakeFirst();

  return !existingResult && !existingCheckpoint;
}

/**
 * Скачивает с FTP все файлы, перечисленные в filelist.xml, в локальный кэш.
 */
export async function downloadMessageFiles(filenames: string[]): Promise<void> {
  await ensureDir(config.xmlLocalCacheDir);
  await withFtpClient(async (client) => {
    for (const filename of filenames) {
      const localPath = path.join(config.xmlLocalCacheDir, filename);
      await client.downloadTo(localPath, filename);
    }
  });
}

/**
 * Заливает result.xml обратно на FTP, чтобы 1С могла забрать результат обмена -
 * так же, как оригинальный модуль писал result.xml в примонтированную папку.
 */
export async function uploadResult(): Promise<void> {
  const localPath = path.join(config.xmlLocalCacheDir, "result.xml");
  await withFtpClient((client) => client.uploadFrom(localPath, "result.xml"));
}

/**
 * Убирает локальный кэш файлов сообщения после успешного завершения импорта -
 * чтобы не копить на диске старые выгрузки.
 */
export async function cleanupMessageFiles(filenames: string[]): Promise<void> {
  for (const filename of filenames) {
    await fs.rm(path.join(config.xmlLocalCacheDir, filename), { force: true });
  }
}