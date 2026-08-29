import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, of, switchMap } from 'rxjs';

import { DataService } from '../../../services/data/data.service';
import { DiaryEvent, FinalEvent, MeResponse } from '../../../models/diary.models';

interface WeekOption {
  label: string;
  from: string; // понедельник, YYYY-MM-DD
  to: string; // воскресенье, YYYY-MM-DD
}

interface QuarterOption {
  id: number | 'final';
  name: string;
  from?: string;
  to?: string;
}

interface DiaryCell {
  date: string;
  marks: { value: string; comment: string | null }[];
  homework: string;
  note: string | null;
  missing: boolean;
}

interface DiaryRow {
  subject: string;
  days: DiaryCell[]; // ровно 5: пн..пт
}

const WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];

function mondayOf(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d.toISOString().slice(0, 10);
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function ddmm(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}.${m}`;
}

@Component({
  selector: 'app-diary',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './diary.component.html',
  styleUrls: ['./diary.component.scss'],
})
export class DiaryComponent implements OnInit {
  private data = inject(DataService);

  readonly weekdayNames = WEEKDAYS;

  loading = true;
  error: string | null = null;

  me: MeResponse | null = null;
  private allEvents: DiaryEvent[] = [];
  private finals: FinalEvent[] = [];

  quarters: QuarterOption[] = [];
  selectedQuarter!: QuarterOption;

  weeks: WeekOption[] = [];
  selectedWeek: WeekOption | null = null;

  rows: DiaryRow[] = [];
  finalRows: { subject: string; value: string }[] = [];

  ngOnInit(): void {
    this.data
      .me()
      .pipe(
        switchMap((me) => {
          this.me = me;
          if (!me.group || !me.pupil) {
            return of({ me, events: [] as DiaryEvent[], finals: [] as FinalEvent[] });
          }
          return forkJoin({
            me: of(me),
            events: this.data.events(
              me.group.id,
              me.group.schoolyear_start,
              me.group.schoolyear_end
            ),
            finals: this.data.finalMarks(me.group.id, me.pupil.id),
          });
        })
      )
      .subscribe({
        next: ({ me, events, finals }) => {
          this.loading = false;
          if (!me.group || !me.pupil) {
            this.error = 'Учётная запись не привязана к классу — дневник недоступен.';
            return;
          }
          this.allEvents = events;
          this.finals = finals;
          this.buildQuarters(me);
          this.selectQuarter(this.currentQuarter());
        },
        error: (err) => {
          this.loading = false;
          this.error = err?.error?.error || 'Не удалось загрузить дневник';
        },
      });
  }

  private buildQuarters(me: MeResponse): void {
    this.quarters = [
      ...me.terms.map((t) => ({
        id: t.id,
        name: t.name,
        from: t.date_start,
        to: t.date_end,
      })),
      { id: 'final' as const, name: 'Итоговая' },
    ];
  }

  private currentQuarter(): QuarterOption {
    const today = new Date().toISOString().slice(0, 10);
    return (
      this.quarters.find((q) => q.from && q.to && q.from <= today && today <= q.to) ??
      this.quarters[0]
    );
  }

  selectQuarter(q: QuarterOption): void {
    this.selectedQuarter = q;
    if (q.id === 'final') {
      this.weeks = [];
      this.selectedWeek = null;
      this.buildFinalRows();
      return;
    }
    this.buildWeeks(q.from!, q.to!);
    const today = new Date().toISOString().slice(0, 10);
    this.selectedWeek =
      this.weeks.find((w) => w.from <= today && today <= w.to) ?? this.weeks[0] ?? null;
    this.buildRows();
  }

  private buildWeeks(from: string, to: string): void {
    const weeks: WeekOption[] = [];
    let mon = mondayOf(from);
    while (mon <= to) {
      const sun = addDays(mon, 6);
      weeks.push({ label: `${ddmm(mon)} – ${ddmm(sun)}`, from: mon, to: sun });
      mon = addDays(mon, 7);
    }
    this.weeks = weeks;
  }

  onWeekChange(index: number): void {
    this.selectedWeek = this.weeks[index] ?? null;
    this.buildRows();
  }

  private buildRows(): void {
    const week = this.selectedWeek;
    const pupilExt = this.me?.pupil?.ext_id;
    if (!week || !pupilExt) {
      this.rows = [];
      return;
    }

    const inWeek = this.allEvents.filter((e) => e.date >= week.from && e.date <= week.to);
    const bySubject = new Map<string, DiaryEvent[]>();
    for (const e of inWeek) {
      (bySubject.get(e.subject) ?? bySubject.set(e.subject, []).get(e.subject)!).push(e);
    }

    this.rows = [...bySubject.keys()].sort((a, b) => a.localeCompare(b, 'ru')).map((subject) => {
      const evs = bySubject.get(subject)!;
      const days: DiaryCell[] = [];
      for (let d = 0; d < 5; d++) {
        const date = addDays(week.from, d);
        const dayEvents = evs.filter((e) => e.date === date);
        const marks = dayEvents.flatMap((e) =>
          e.marks
            .filter((m) => m.pupil_ext_id === pupilExt)
            .map((m) => ({ value: m.value, comment: m.comment }))
        );
        const homework =
          dayEvents.map((e) => (e.homework ?? '').trim()).find((h) => h && h !== '—') ?? '';
        const note =
          dayEvents
            .flatMap((e) => e.comments.filter((c) => c.pupil_ext_id === pupilExt).map((c) => c.text))
            .find(Boolean) ?? null;
        const missing = dayEvents.some((e) =>
          e.missings.some((m) => m.pupil_ext_id === pupilExt)
        );
        days.push({ date, marks, homework, note, missing });
      }
      return { subject, days };
    });
  }

  private buildFinalRows(): void {
    const pupilExt = this.me?.pupil?.ext_id;
    this.finalRows = this.finals
      .map((fe) => ({
        subject: fe.subject,
        value: fe.marks.find((m) => m.pupil_ext_id === pupilExt)?.value ?? '—',
      }))
      .sort((a, b) => a.subject.localeCompare(b.subject, 'ru'));
  }

  /** css-класс точки/чипа по тексту комментария (совпадает с легендой). */
  markClass(comment: string | null): string {
    const c = (comment ?? '').toLowerCase();
    if (c.includes('контрольн')) return 'control';
    if (c.includes('практическ')) return 'practice';
    if (c.includes('лаборатор')) return 'lab';
    if (c.includes('провероч')) return 'test';
    if (c.includes('домашн')) return 'homework';
    if (c.includes('доск')) return 'answer';
    return 'answer';
  }

  dayLabel(i: number): string {
    return this.weekdayNames[i] ?? '';
  }
  dayDate(i: number): string {
    return this.selectedWeek ? ddmm(addDays(this.selectedWeek.from, i)) : '';
  }
}
