import { Component, OnInit, inject } from '@angular/core';
import { forkJoin, of, switchMap } from 'rxjs';
import { DataService } from '../../../services/data/data.service';
import { FinalEvent, TermInfo } from '../../../models/diary.models';

interface GradeRow {
  subject: string;
  terms: string[];
  year: string;
  final: string;
}

@Component({
  selector: 'app-final-grade',
  standalone: true,
  templateUrl: './final-grade.component.html',
  styleUrl: './final-grade.component.scss',
})
export class FinalGradeComponent implements OnInit {
  private readonly data = inject(DataService);
  loading = true;
  error: string | null = null;
  schoolyear = '';
  terms: TermInfo[] = [];
  rows: GradeRow[] = [];

  ngOnInit(): void {
    this.data.me().pipe(
      switchMap((me) => {
        if (!me.group || !me.pupil) {
          this.error = 'Учётная запись не привязана к классу — оценки недоступны.';
          return of(null);
        }
        this.schoolyear = me.group.schoolyear_name;
        this.terms = [...me.terms].sort((a, b) => a.date_start.localeCompare(b.date_start));
        return forkJoin({
          me: of(me),
          finals: this.data.myFinalMarks(me.group.schoolyear_id),
        });
      }),
    ).subscribe({
      next: (result) => {
        this.loading = false;
        if (!result) return;
        this.rows = this.buildRows(result.finals, result.me.pupil!.ext_id);
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'Не удалось загрузить итоговые оценки';
      },
    });
  }

  private buildRows(finals: FinalEvent[], pupilId: string): GradeRow[] {
    const bySubject = new Map<string, FinalEvent[]>();
    for (const event of finals) {
      if (!['term', 'year', 'final'].includes(event.type)
        || !event.marks.some((mark) => mark.pupil_ext_id === pupilId && mark.value.trim())) continue;
      const events = bySubject.get(event.subject) ?? [];
      events.push(event);
      bySubject.set(event.subject, events);
    }
    const values = (events: FinalEvent[]): string => {
      const marks = events.flatMap((event) => event.marks
        .filter((mark) => mark.pupil_ext_id === pupilId && mark.value.trim())
        .map((mark) => mark.value));
      return [...new Set(marks)].join(' / ') || '—';
    };
    return [...bySubject.keys()]
      .sort((a, b) => a.localeCompare(b, 'ru'))
      .map((subject) => {
        const events = bySubject.get(subject) ?? [];
        return {
          subject,
          terms: this.terms.map((term) => values(events.filter((event) =>
            event.type === 'term' && event.term_ext_id === term.ext_id))),
          year: values(events.filter((event) => event.type === 'year')),
          final: values(events.filter((event) => event.type === 'final')),
        };
      });
  }
}
