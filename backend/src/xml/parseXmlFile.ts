import fs from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";

/**
 * Разбор XML-файла целиком в JS-объект.
 *
 * Используется для сравнительно небольших файлов выгрузки (book / groups /
 * final_marks). Большой events.xml по-прежнему читается потоково
 * (см. xml/chunkedXmlReader.ts) - его в память целиком не грузим.
 *
 * parseTagValue: false - все текстовые узлы остаются строками. Так предсказуемее:
 * ext_id (GUID), оценки ("5"), время ("08:30") и номера сообщений не превращаются
 * в number молча и по-разному.
 */
const parser = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
});

export type XmlNode = Record<string, unknown>;

/** Возвращает null, если файла нет на диске. */
export async function parseXmlFile(path: string): Promise<XmlNode | null> {
  let raw: string;
  try {
    raw = await fs.readFile(path, "utf-8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  // Срезаем BOM - fast-xml-parser не всегда его переваривает
  return parser.parse(raw.replace(/^﻿/, "")) as XmlNode;
}

/** Обёртка над возможным «одиночка | массив | undefined» из fast-xml-parser. */
export function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v === undefined || v === null || v === "") return [];
  return Array.isArray(v) ? v : [v];
}

/** Плоский список дочерних элементов-объектов узла, независимо от имён тегов. */
export function childElements(node: unknown): XmlNode[] {
  if (!node || typeof node !== "object") return [];
  const out: XmlNode[] = [];
  for (const value of Object.values(node as XmlNode)) {
    for (const item of asArray(value)) {
      if (item && typeof item === "object") out.push(item as XmlNode);
    }
  }
  return out;
}

/** Строковое значение узла с обрезкой пробелов; пустое -> "". */
export function str(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "object") return "";
  return String(v).trim();
}

/** Целое или null. */
export function intOrNull(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

/**
 * Нормализация даты к строке YYYY-MM-DD.
 * Понимает ISO-дату/датувремя, unix-секунды (как в legacy-выгрузке 1С) и всё,
 * что распарсит Date. Непонятное -> null.
 */
export function toDate(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;

  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  if (/^\d+$/.test(s)) {
    const d = new Date(Number(s) * 1000);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** MessageNo из корня файла: <book>/<file> -> <MessageNo>. */
export function readMessageNo(doc: XmlNode | null): string {
  if (!doc) return "";
  const root = (doc.file ?? doc.book ?? doc.filelist ?? doc) as XmlNode;
  return str(root.MessageNo);
}
