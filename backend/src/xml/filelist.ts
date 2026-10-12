import { importStep } from "../import/diagnostics.js";
import fs from "node:fs/promises";
import { XMLParser } from "fast-xml-parser";

export interface FileListEntry {
  filename: string;
  type: "book" | "groups" | "events" | "final_marks";
}

export interface FileList {
  messageno: string;
  files: FileListEntry[];
}

const parser = new XMLParser();

export async function readFileList(path: string): Promise<FileList> {
  const xml = await importStep("xml.read", () => fs.readFile(path, "utf-8"), { path });
  const doc = await importStep("xml.parse", () => parser.parse(xml), { path, bytes: Buffer.byteLength(xml) });
  const root = doc.filelist;
  const rawFiles = root.files?.file;
  const files: FileListEntry[] = (Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [])
    .map((f: any) => ({ filename: String(f.filename), type: String(f.type) as FileListEntry["type"] }));

  return {
    messageno: String(root.MessageNo),
    files,
  };
}