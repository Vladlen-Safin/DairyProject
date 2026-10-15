// Run: node --test tests/grades-view.test.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/app/components/pages/final-grade/grades-view.ts'), 'utf8');
const context = { exports: {} };
vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context);
const { buildGrades, finalColumns, monthPeriods } = context.exports;
const terms = [{ id: 1, ext_id: 'q1', name: 'I', date_start: '2026-09-01', date_end: '2026-10-31' }, { id: 2, ext_id: 'q2', name: 'II', date_start: '2026-11-01', date_end: '2026-12-31' }];
const event = (id, date, values, extra = {}) => ({ id, date, lesson: 1, subject: 'Алгебра', teacher: 'Учитель', marks: values.map(value => ({ value, comment: 'Контрольная' })), missing: false, ...extra });
const final = (type, value, extra = {}) => ({ subject: 'Алгебра', type, term_ext_id: 'q1', marks: [{ pupil_ext_id: 'p1', value }], ...extra });

test('monthly requests partition school year without overlaps, including leap day', () => {
  const months = monthPeriods('2023-12-15', '2024-03-12');
  assert.equal(months.length, 4);
  assert.equal(months[0].from, '2023-12-15');
  assert.equal(months[2].to, '2024-02-29');
  assert.equal(months[3].to, '2024-03-12');
  for (let i = 1; i < months.length; i++) assert.equal((Date.parse(months[i].from) - Date.parse(months[i - 1].to)) / 86400000, 1);
});

test('keeps repeated and text marks, excludes other dates from average, includes boundary dates', () => {
  const columns = finalColumns(terms, '2026-10-01', '2026-10-31');
  const rows = buildGrades([event(1, '2026-09-30', ['2']), event(2, '2026-10-01', ['5', '5', 'зачёт', '5 (5)']), event(3, '2026-10-31', ['4']), event(4, '2026-11-01', ['2'])], [final('year', '2')], 'p1', ['Алгебра', 'Физика'], '2026-10-01', '2026-10-31', columns);
  assert.equal(rows[0].marks.length, 5);
  assert.equal(rows[0].dates['2026-10-01'].length, 4);
  assert.equal(rows[0].average, '4,67');
  assert.equal(rows[0].finals.year, '2');
  assert.equal(rows[1].marks.length, 0);
  assert.equal(rows[1].average, '—');
});

test('selects overlapping terms and all annual final types, excludes other pupil marks', () => {
  const columns = finalColumns(terms, '2026-10-15', '2026-11-01');
  assert.equal(columns.length, 5);
  const rows = buildGrades([], [final('term', '4'), final('exam', '5'), final('final', '5'), final('year', '3', {marks: [{pupil_ext_id:'other', value:'3'}]})], 'p1', ['Алгебра'], '2026-10-15', '2026-11-01', columns);
  assert.equal(rows[0].finals.term_1, '4');
  assert.equal(rows[0].finals.term_2, '—');
  assert.equal(rows[0].finals.exam, '5');
  assert.equal(rows[0].finals.final, '5');
  assert.equal(rows[0].finals.year, '—');
});

test('counts absent pairs once, applies subject filter and preserves all marks', () => {
  const events = [event(1, '2026-10-02', ['3'], {missing:true}), event(2, '2026-10-02', ['4'], {missing:true}), event(3, '2026-10-03', [], {missing:true}), event(4, '2026-10-03', ['2'], {subject:'Физика'})];
  const rows = buildGrades(events, [], 'p1', ['Алгебра'], '2026-10-01', '2026-10-31', []);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].absences, 2);
  assert.equal(rows[0].marks.length, 2);
  assert.equal(rows[0].average, '3,5');
});
