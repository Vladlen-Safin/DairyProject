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
  const xml = await fs.readFile(path, "utf-8");
  const doc = parser.parse(xml);
  const root = doc.filelist;
  const rawFiles = root.files?.file;
  const files: FileListEntry[] = (Array.isArray(rawFiles) ? rawFiles : rawFiles ? [rawFiles] : [])
    .map((f: any) => ({ filename: String(f.filename), type: String(f.type) as FileListEntry["type"] }));

  return {
    messageno: String(root.MessageNo),
    files,
  };
}