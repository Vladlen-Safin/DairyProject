import type { Content, TableCell, TDocumentDefinitions } from 'pdfmake/interfaces';
import type { FinalEvent, MyEvent, TermInfo } from '../../../models/diary.models';
import { buildGrades, finalColumns } from './grades-view';

export interface GradesExportInput {
  scope: 'filtered' | 'year';
  schoolyear: string;
  pupilId: string;
  pupilLabel: string;
  yearFrom: string;
  yearTo: string;
  from: string;
  to: string;
  subjects: string[];
  selectedSubjects: string[];
  terms: TermInfo[];
  events: MyEvent[];
  finals: FinalEvent[];
}

const dateLabel = (date: string) => date.split('-').reverse().join('.');

/** Independent of the screen's compact/full view and scroll position. */
export function buildGradesPdf(input: GradesExportInput): TDocumentDefinitions {
  const from = input.scope === 'year' ? input.yearFrom : input.from;
  const to = input.scope === 'year' ? input.yearTo : input.to;
  if (!from || !to || from > to || from < input.yearFrom || to > input.yearTo) throw new Error('Некорректный период выгрузки');
  const subjects = input.subjects.filter(s => input.scope === 'year' || !input.selectedSubjects.length || input.selectedSubjects.includes(s));
  const columns = finalColumns(input.terms, from, to);
  const rows = buildGrades(input.events, input.finals, input.pupilId, subjects, from, to, columns);
  const dates = [...new Set(input.events.filter(e => subjects.includes(e.subject) && e.date >= from && e.date <= to).map(e => e.date))].sort();
  // Keep dates readable: separate months and split wide tables into small panels.
  const panels: string[][] = [];
  const maxDates = Math.max(3, Math.min(8, 12 - columns.length));
  for (const date of dates) {
    const last = panels[panels.length - 1];
    if (!last || last.length >= maxDates || last[0].slice(0, 7) !== date.slice(0, 7)) panels.push([date]);
    else last.push(date);
  }
  if (!panels.length) panels.push([]);
  const content: Content[] = [];
  const headerCell = (text: string): TableCell => ({ text, bold: true, fillColor: '#EAF1FC', color: '#1F2D5C', alignment: 'center' });
  for (let index = 0; index < panels.length; index++) {
    const panel = panels[index];
    content.push(
      { text: 'Текущие и итоговые оценки', fontSize: 17, bold: true, color: '#0A4FB8', margin: [0, 0, 0, 6], ...(index ? { pageBreak: 'before' as const } : {}) },
      { text: `${input.pupilLabel} | Учебный год: ${input.schoolyear}`, margin: [0, 0, 0, 4] },
      { text: `${input.scope === 'year' ? 'Весь учебный год, все предметы' : 'По текущим фильтрам'} | ${dateLabel(from)} - ${dateLabel(to)}`, margin: [0, 0, 0, 4] },
      { text: `Предметы: ${input.scope === 'year' || !input.selectedSubjects.length ? 'все' : subjects.join(', ')}`, fontSize: 8, margin: [0, 0, 0, 8] },
      { text: panel.length ? `Даты занятий: ${dateLabel(panel[0])} - ${dateLabel(panel[panel.length - 1])}` : 'За выбранные даты занятий нет', bold: true, margin: [0, 0, 0, 6] },
      { text: 'Пропуски и средний балл рассчитаны за весь выбранный период и повторяются в каждой части таблицы. Итоговые оценки относятся к соответствующим учебным периодам и году.', fontSize: 7.5, color: '#52627C', margin: [0, 0, 0, 8] },
    );
    if (!rows.length) { content.push({ text: 'Нет данных для отображения.' }); continue; }
    const body: TableCell[][] = [[headerCell('Предмет'), ...panel.map(d => headerCell(dateLabel(d).slice(0, 5))), headerCell('Пропуски\nпар'), headerCell('Средний\nбалл'), ...columns.map(c => headerCell(c.label))]];
    for (const row of rows) {
      body.push([
        { text: row.subject, bold: true },
        ...panel.map(d => ({ text: row.dates[d]?.map(m => m.value).join('  ') || '-', alignment: 'center' as const, color: '#0A4FB8' })),
        { text: String(row.absences), alignment: 'center' },
        { text: row.average.replace('—', '-'), alignment: 'center' },
        ...columns.map(c => ({ text: row.finals[c.id].replace('—', '-'), alignment: 'center' as const, fillColor: '#F3F6FD' })),
      ]);
    }
    content.push({
      table: { headerRows: 1, widths: [115, ...panel.map(() => (785 - 115 - 76 - columns.length * 43 - (panel.length + columns.length + 3) * 8.5) / panel.length), 36, 40, ...columns.map(() => 43)], body },
      fontSize: 8,
      layout: { hLineWidth: () => 0.5, vLineWidth: () => 0.5, hLineColor: () => '#DCE3EF', vLineColor: () => '#DCE3EF', paddingLeft: () => 4, paddingRight: () => 4, paddingTop: () => 5, paddingBottom: () => 5 },
    });
    content.push({ text: 'Средний балл: только числовые текущие оценки, без итоговых и текстовых значений. Даты без занятий не включены.', fontSize: 7.5, color: '#52627C', margin: [0, 9, 0, 0] });
  }
  return {
    pageSize: 'A4', pageOrientation: 'landscape', pageMargins: [28, 28, 28, 32],
    defaultStyle: { font: 'Roboto', fontSize: 9, color: '#1F2D5C' },
    info: { title: `Оценки ${input.schoolyear}`, author: 'Электронный дневник' },
    content,
    footer: (page, total) => ({ text: `Электронный дневник · ${page} / ${total}`, alignment: 'right', margin: [28, 10, 28, 0], fontSize: 8, color: '#52627C' }),
  };
}

export async function downloadGradesPdf(input: GradesExportInput): Promise<void> {
  const definition = buildGradesPdf(input);
  const [{ default: pdfMake }, { default: fonts }] = await Promise.all([
    import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts'),
  ]);
  // pdfmake 0.2.20 exports the font dictionary directly; its typings still describe the older wrapper.
  pdfMake.vfs = fonts as unknown as Record<string, string>;
  const from = input.scope === 'year' ? input.yearFrom : input.from;
  const to = input.scope === 'year' ? input.yearTo : input.to;
  await new Promise<void>(resolve => {
    pdfMake.createPdf(definition).download(`grades-${input.scope}-${from}-${to}.pdf`, resolve);
  });
}
