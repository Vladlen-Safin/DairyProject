const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const base = path.join(__dirname, '../src/app/components/pages/final-grade');
function load(name) {
  const context = { exports: {}, require: id => id === './grades-view' ? load('grades-view') : require(id) };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(base, name + '.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText, context);
  return context.exports;
}
const { buildGradesPdf } = load('grades-pdf');
const subjects = ['Алгебра', 'Английский язык', 'Геометрия', 'Информатика', 'История Узбекистана', 'Литература', 'Обществознание', 'Основы государства и права', 'Русский язык', 'Узбекский язык', 'Физика', 'Физическая культура', 'Экономика'];
const terms = [
  { id: 1, ext_id: 'q1', name: 'I четверть', date_start: '2026-09-01', date_end: '2026-10-31' },
  { id: 2, ext_id: 'q2', name: 'II четверть', date_start: '2026-11-01', date_end: '2026-12-31' },
  { id: 3, ext_id: 'q3', name: 'III четверть', date_start: '2027-01-01', date_end: '2027-03-31' },
  { id: 4, ext_id: 'q4', name: 'IV четверть', date_start: '2027-04-01', date_end: '2027-06-30' },
];
const events = subjects.flatMap((subject, s) => Array.from({length: 18}, (_, i) => ({
  id: s * 20 + i, subject, date: `2026-${i < 9 ? '09' : '10'}-${String(i % 9 + 1).padStart(2,'0')}`, lesson: 1,
  teacher: 'Иванов И. И.', marks: [{value: String(3 + (i % 3)), comment: null}, ...(i === 0 ? [{value:'зачёт',comment:null}] : [])], missing: i === 2,
})));
const finals = subjects.flatMap(subject => [...terms.map(t => ({subject, type:'term',term_ext_id:t.ext_id, marks:[{pupil_ext_id:'p1',value:'5'}]})), ...['year','exam','final'].map(type=>({subject,type,marks:[{pupil_ext_id:'p1',value:'4'}]}))]);
const input = { scope:'filtered', schoolyear:'2026-2027', pupilId:'p1', pupilLabel:'Тестовый ученик',yearFrom:'2026-09-01',yearTo:'2027-06-30',from:'2026-10-01',to:'2026-10-09',subjects, selectedSubjects:['Алгебра'],terms,events,finals };
const tables = doc => doc.content.filter(c => c.table);
test('filtered PDF uses all date columns and only selected subjects, regardless of compact view', () => {
  const doc = buildGradesPdf({...input, view:'compact'});
  const table = tables(doc)[0].table;
  assert.equal(table.body.length, 2);
  assert.equal(table.body[1][0].text, 'Алгебра');
  assert.equal(table.body[0][1].text, '01.10');
  assert.equal(tables(doc)[1].table.body[0][1].text, '09.10');
  assert.equal(JSON.stringify(doc).includes('01.09'), false);
});
test('annual PDF ignores dates and subject filters without mutating them; dates are split without loss', () => {
  const before = JSON.stringify(input);
  const doc = buildGradesPdf({...input,scope:'year'});
  const allTables = tables(doc);
  assert.equal(allTables.length, 4);
  assert.equal(allTables[0].table.body.length, subjects.length + 1);
  assert.equal(allTables[0].table.body[0][1].text,'01.09');
  assert.equal(allTables[2].table.body[0][1].text,'01.10');
  assert.ok(JSON.stringify(doc).includes('IV четверть'));
  assert.equal(JSON.stringify(input), before);
});
test('missing lessons still allow summary-only export; invalid filtered dates fail', () => {
  assert.equal(tables(buildGradesPdf({...input,events:[]})).length,1);
  assert.throws(()=>buildGradesPdf({...input,from:'2028-01-01'}));
  assert.doesNotThrow(()=>buildGradesPdf({...input,scope:'year',from:''}));
});
if (process.argv.includes('--preview')) {
  const pdfMake = require('pdfmake/build/pdfmake');
  pdfMake.addVirtualFileSystem(require('pdfmake/build/vfs_fonts'));
  const output = path.resolve(__dirname, '../../tmp/pdfs/grades-export-check.pdf');
  fs.mkdirSync(path.dirname(output),{recursive:true});
  pdfMake.createPdf(buildGradesPdf({...input,scope:'year'})).getBuffer(buffer => {
    fs.writeFileSync(output,buffer);
    console.log('PDF fixture saved:',output);
  });
}
