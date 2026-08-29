export interface RawMark {
  value: string;
  pupil: string;
  comment?: string;
}

export interface RawComment {
  text: string;
  pupil: string;
}

/** Структура одного <event> после разбора chunkedXmlReader'ом */
export interface RawEvent {
  id: string;
  date: string;
  lesson: string;
  subject: string;
  cabinet?: string;
  teacher: string;
  homework?: string;
  group: string;
  delete?: string;
  comments?: { comment?: RawComment | RawComment[] } | string;
  marks?: { mark?: RawMark | RawMark[] } | string;
  missing?: { pupil?: string | string[] } | string;
}

export function asArray<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}