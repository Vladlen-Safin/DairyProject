import { FinalEvent, MyEvent, TermInfo } from '../../../models/diary.models';

export interface PeriodOption { id: string; label: string; from: string; to: string; }
export interface CurrentMark { value: string; date: string; details: string; }
export interface GradeRow {
  subject: string;
  marks: CurrentMark[];
  dates: Record<string, CurrentMark[]>;
  absences: number;
  average: string;
  finals: Record<string, string>;
}
export interface FinalColumn { id: string; label: string; type: string; termId?: string; }

export function monthPeriods(from: string, to: string): PeriodOption[] {
  const result: PeriodOption[] = [];
  const cursor = new Date(`${from.slice(0, 7)}-01T00:00:00Z`);
  while (cursor.toISOString().slice(0, 10) <= to) {
    const start = cursor.toISOString().slice(0, 10);
    const label = cursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    const end = new Date(cursor.getTime() - 86400000).toISOString().slice(0, 10);
    result.push({ id: start.slice(0, 7), label, from: start < from ? from : start, to: end > to ? to : end });
  }
  return result;
}

export function buildGrades(events: MyEvent[], finals: FinalEvent[], pupilId: string,
  subjects: string[], from: string, to: string, columns: FinalColumn[]): GradeRow[] {
  return subjects.map(subject => {
    const lessons = events.filter(e => e.subject === subject && e.date >= from && e.date <= to)
      .sort((a, b) => a.date.localeCompare(b.date) || a.lesson - b.lesson || a.id - b.id);
    const marks = lessons.flatMap(e => e.marks.filter(m => m.value.trim()).map(m => ({
      value: m.value.trim(), date: e.date,
      details: [e.date.split('-').reverse().join('.'), `Пара ${e.lesson}`, e.teacher, m.comment].filter(Boolean).join(' · '),
    })));
    const dates: Record<string, CurrentMark[]> = {};
    for (const mark of marks) (dates[mark.date] ??= []).push(mark);
    // Text marks and compound values are not interpreted as numbers.
    const numeric = marks.filter(m => /^\d+(?:[.,]\d+)?$/.test(m.value)).map(m => Number(m.value.replace(',', '.')));
    const result: Record<string, string> = {};
    for (const column of columns) {
      const values = finals.filter(e => e.subject === subject && e.type === column.type
        && (!column.termId || e.term_ext_id === column.termId))
        .flatMap(e => e.marks.filter(m => m.pupil_ext_id === pupilId && m.value.trim()).map(m => m.value.trim()));
      result[column.id] = [...new Set(values)].join(' / ') || '—';
    }
    return { subject, marks, dates, finals: result,
      absences: new Set(lessons.filter(e => e.missing).map(e => `${e.date}:${e.lesson}`)).size,
      average: numeric.length ? (numeric.reduce((a, b) => a + b, 0) / numeric.length).toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : '—',
    };
  });
}

export function finalColumns(terms: TermInfo[], from: string, to: string): FinalColumn[] {
  return [
    ...terms.filter(t => t.date_start <= to && t.date_end >= from)
      .map(t => ({ id: `term_${t.id}`, label: t.name, type: 'term', termId: t.ext_id })),
    { id: 'year', label: 'Годовая', type: 'year' },
    { id: 'exam', label: 'Экзамен', type: 'exam' },
    { id: 'final', label: 'Итоговая', type: 'final' },
  ];
}
