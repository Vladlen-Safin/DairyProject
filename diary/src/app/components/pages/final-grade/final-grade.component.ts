import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatTableModule } from '@angular/material/table';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin, of, switchMap } from 'rxjs';
import { DataService } from '../../../services/data/data.service';
import { FinalEvent, MyEvent, TermInfo } from '../../../models/diary.models';
import { buildGrades, finalColumns, monthPeriods, GradeRow, FinalColumn, PeriodOption } from './grades-view';

@Component({
  selector: 'app-final-grade', standalone: true,
  imports: [FormsModule, MatTableModule, MatFormFieldModule, MatSelectModule, MatTooltipModule],
  templateUrl: './final-grade.component.html', styleUrl: './final-grade.component.scss',
})
export class FinalGradeComponent implements OnInit {
  private readonly data = inject(DataService);
  loading = true;
  error: string | null = null;
  schoolyear = '';
  yearFrom = '';
  yearTo = '';
  terms: TermInfo[] = [];
  months: PeriodOption[] = [];
  subjects: string[] = [];
  selectedSubjects: string[] = [];
  mode: 'month' | 'term' | 'year' | 'custom' = 'month';
  view: 'full' | 'compact' = typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches ? 'compact' : 'full';
  month = '';
  term = 0;
  from = '';
  to = '';
  rangeError = '';
  periodLabel = '';
  rows: GradeRow[] = [];
  dates: { id: string; label: string; month: string }[] = [];
  finalsColumns: FinalColumn[] = [];
  columns: string[] = [];
  private events: MyEvent[] = [];
  private finals: FinalEvent[] = [];
  private pupilId = '';
  private pupilLabel = '';
  exporting = false;
  exportError = '';

  ngOnInit(): void {
    this.data.me().pipe(switchMap(me => {
      if (!me.group || !me.pupil) {
        this.error = 'Учётная запись не привязана к классу — оценки недоступны.';
        return of(null);
      }
      this.schoolyear = me.group.schoolyear_name;
      this.yearFrom = me.group.schoolyear_start;
      this.yearTo = me.group.schoolyear_end;
      this.pupilId = me.pupil.ext_id;
      this.pupilLabel = me.login;
      this.terms = [...me.terms].sort((a, b) => a.date_start.localeCompare(b.date_start));
      this.months = monthPeriods(this.yearFrom, this.yearTo);
      // The events endpoint has a response limit: load short, non-overlapping ranges.
      return forkJoin({
        events: forkJoin(this.months.map(m => this.data.myEvents(m.from, m.to))),
        finals: this.data.myFinalMarks(me.group.schoolyear_id),
      });
    })).subscribe({
      next: result => {
        this.loading = false;
        if (!result) return;
        if (result.events.some(batch => batch.length >= 2000)) {
          this.error = 'За один из месяцев получен предельный объём данных. Нельзя показать полную таблицу: требуется уточнение загрузки.';
          return;
        }
        this.events = [...new Map(result.events.flat().map(e => [e.id, e])).values()];
        this.finals = result.finals;
        this.subjects = [...new Set([...this.events.map(e => e.subject), ...this.finals.map(e => e.subject)])].sort((a, b) => a.localeCompare(b, 'ru'));
        this.reset();
      },
      error: err => { this.loading = false; this.error = err?.error?.error || 'Не удалось загрузить оценки'; },
    });
  }

  reset(): void {
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    this.month = (this.months.find(m => m.from <= today && m.to >= today) ?? this.months[0])?.id ?? '';
    this.term = (this.terms.find(t => t.date_start <= today && t.date_end >= today) ?? this.terms[0])?.id ?? 0;
    this.mode = 'month';
    this.selectedSubjects = [];
    this.applyPeriod();
  }

  async exportPdf(scope: 'filtered' | 'year'): Promise<void> {
    if (this.exporting || this.loading || this.error || (scope === 'filtered' && this.rangeError)) return;
    this.exporting = true;
    this.exportError = '';
    // Snapshot before lazy loading: changing filters while exporting cannot change the document.
    const snapshot = {
      scope, schoolyear: this.schoolyear, pupilId: this.pupilId, pupilLabel: this.pupilLabel,
      yearFrom: this.yearFrom, yearTo: this.yearTo, from: this.from, to: this.to,
      subjects: [...this.subjects], selectedSubjects: [...this.selectedSubjects],
      terms: [...this.terms], events: [...this.events], finals: [...this.finals],
    };
    try {
      const { downloadGradesPdf } = await import('./grades-pdf');
      await downloadGradesPdf(snapshot);
    } catch {
      this.exportError = 'Не удалось сформировать PDF. Попробуйте ещё раз.';
    } finally { this.exporting = false; }
  }

  applyPeriod(): void {
    if (this.mode === 'month') {
      const m = this.months.find(m => m.id === this.month);
      this.from = m?.from ?? this.yearFrom; this.to = m?.to ?? this.yearTo;
    } else if (this.mode === 'term') {
      const t = this.terms.find(t => t.id === this.term);
      this.from = t?.date_start ?? this.yearFrom; this.to = t?.date_end ?? this.yearTo;
    } else if (this.mode === 'year') {
      this.from = this.yearFrom; this.to = this.yearTo;
    }
    this.refresh();
  }

  refresh(): void {
    this.rangeError = !this.from || !this.to ? 'Укажите обе даты.' : this.from > this.to ? 'Дата начала должна быть не позже даты окончания.'
      : this.from < this.yearFrom || this.to > this.yearTo ? 'Выберите даты в пределах учебного года.' : '';
    if (this.rangeError) { this.rows = []; return; }
    this.periodLabel = `${this.from.split('-').reverse().join('.')} — ${this.to.split('-').reverse().join('.')}`;
    this.finalsColumns = finalColumns(this.terms, this.from, this.to);
    this.rows = buildGrades(this.events, this.finals, this.pupilId,
      this.subjects.filter(s => !this.selectedSubjects.length || this.selectedSubjects.includes(s)), this.from, this.to, this.finalsColumns);
    // Show dates with lessons, including lessons without marks; don't create blank weekend columns.
    const visibleSubjects = new Set(this.rows.map(r => r.subject));
    this.dates = [...new Set(this.events.filter(e => e.date >= this.from && e.date <= this.to && visibleSubjects.has(e.subject)).map(e => e.date))]
      .sort().map(id => ({ id, label: id.slice(8), month: new Date(`${id}T00:00:00Z`).toLocaleDateString('ru-RU', { month: 'short', year: 'numeric', timeZone: 'UTC' }) }));
    this.columns = ['subject', ...(this.view === 'full' && this.dates.length ? this.dates.map(d => d.id) : ['marks']), 'absences', 'average', ...this.finalsColumns.map(c => c.id)];
  }
}
