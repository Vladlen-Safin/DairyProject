import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { forkJoin, of, switchMap } from 'rxjs';

import { DataService } from '../../../services/data/data.service';
import { FinalEvent, MeResponse, MyEvent } from '../../../models/diary.models';

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

interface MonthOption {
  id: string;
  name: string;
  year: string;
  weeks: WeekOption[];
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

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

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
  private allEvents: MyEvent[] = [];
  private finals: FinalEvent[] = [];

  quarters: QuarterOption[] = [];
  selectedQuarter!: QuarterOption;

  months: MonthOption[] = [];
  selectedMonth: MonthOption | null = null;
  showFinal = false;

  weeks: WeekOption[] = [];
  selectedWeek: WeekOption | null = null;
  selectedDay = Math.min((new Date().getDay() + 6) % 7, 4);
  private touchStart: { x: number; y: number } | null = null;

  canMoveDay(direction: number): boolean {
    if (!this.selectedWeek) return false;
    const day = this.selectedDay + direction;
    if (day >= 0 && day < this.weekdayNames.length) return true;
    const weeks = this.navigationWeeks;
    const index = weeks.findIndex((week) => week.from === this.selectedWeek?.from);
    return index >= 0 && !!weeks[index + direction];
  }

  moveDay(direction: number): void {
    if (!this.canMoveDay(direction)) return;
    const day = this.selectedDay + direction;
    if (day >= 0 && day < this.weekdayNames.length) {
      this.selectedDay = day;
      return;
    }
    const weeks = this.navigationWeeks;
    const index = weeks.findIndex((week) => week.from === this.selectedWeek?.from);
    const week = weeks[index + direction];
    const month = this.months.find((item) => item.weeks.includes(week))!;
    this.selectedMonth = month;
    this.weeks = month.weeks;
    this.selectedWeek = week;
    this.selectedDay = direction > 0 ? 0 : this.weekdayNames.length - 1;
    this.buildRows();
  }

  onTouchStart(event: TouchEvent): void {
    this.touchStart = event.touches.length === 1
      ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null;
  }

  onTouchEnd(event: TouchEvent): void {
    const start = this.touchStart;
    this.touchStart = null;
    if (!start || !event.changedTouches.length) return;
    const dx = event.changedTouches[0].clientX - start.x;
    const dy = event.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      this.moveDay(dx < 0 ? 1 : -1);
    }
  }

  cancelSwipe(): void { this.touchStart = null; }

  private get navigationWeeks(): WeekOption[] {
    return [...new Map(this.months.flatMap((month) => month.weeks).map((week) => [week.from, week])).values()];
  }

  onMonthChange(value: string): void {
    if (value === 'final') { this.selectFinal(); return; }
    const month = this.months.find((item) => item.id === value);
    if (month) this.selectMonth(month);
  }

  rows: DiaryRow[] = [];
  finalRows: { subject: string; value: string }[] = [];

  ngOnInit(): void {
    this.data
      .me()
      .pipe(
        switchMap((me) => {
          this.me = me;
          if (!me.group || !me.pupil) {
            return of({ me, events: [] as MyEvent[], finals: [] as FinalEvent[] });
          }
          return forkJoin({
            me: of(me),
            // /my-events сам находит ВСЕ группы ученика, актуальные на этот период
            // (не только "текущую" из /me) - за учебный год класс/подгруппа могли смениться.
            events: this.data.myEvents(me.group.schoolyear_start, me.group.schoolyear_end),
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
          // Прежняя инициализация для навигации по четвертям:
          // this.selectQuarter(this.currentQuarter());
          this.buildMonths(me.group.schoolyear_start, me.group.schoolyear_end);
          const today = localToday();
          const month = this.months.find((m) => m.id === today.slice(0, 7))
            ?? this.months[0];
          if (month) this.selectMonth(month);
        },
        error: (err) => {
          this.loading = false;
          this.error = err?.error?.error || 'Не удалось загрузить дневник';
        },
      });
  }

  private buildMonths(from: string, to: string): void {
    const months = new Map<string, MonthOption>();
    const formatter = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' });
    for (let mon = mondayOf(from); mon <= to; mon = addDays(mon, 7)) {
      const sun = addDays(mon, 6);
      // Неделя на границе месяцев доступна в обоих месяцах.
      const ids = new Set([(mon < from ? from : mon).slice(0, 7), (sun > to ? to : sun).slice(0, 7)]);
      for (const id of ids) {
      let month = months.get(id);
      if (!month) {
        const name = formatter.format(new Date(`${id}-01T00:00:00Z`));
        month = { id, name: name[0].toUpperCase() + name.slice(1), year: id.slice(0, 4), weeks: [] };
        months.set(id, month);
      }
      const label = mon.slice(0, 7) === sun.slice(0, 7)
        ? `${mon.slice(8)}–${sun.slice(8)}`
        : `${ddmm(mon)} – ${ddmm(sun)}`;
      month.weeks.push({ label, from: mon, to: sun });
      }
    }
    this.months = [...months.values()];
  }

  selectMonth(month: MonthOption): void {
    this.showFinal = false;
    this.selectedMonth = month;
    this.weeks = month.weeks;
    const today = localToday();
    this.selectedWeek = this.weeks.find((w) => w.from <= today && today <= w.to)
      ?? this.weeks.find((w) => w.from === this.selectedWeek?.from)
      ?? this.weeks[0] ?? null;
    this.buildRows();
  }

  selectFinal(): void {
    this.showFinal = true;
    this.buildFinalRows();
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
    if (!week) {
      this.rows = [];
      return;
    }

    // /my-events уже отдаёт только занятия и оценки текущего ученика - фильтровать
    // по pupil_ext_id больше не нужно, бэкенд сам это делает (по всем его группам).
    const inWeek = this.allEvents.filter((e) => e.date >= week.from && e.date <= week.to);
    const bySubject = new Map<string, MyEvent[]>();
    for (const e of inWeek) {
      (bySubject.get(e.subject) ?? bySubject.set(e.subject, []).get(e.subject)!).push(e);
    }

    this.rows = [...bySubject.keys()].sort((a, b) => a.localeCompare(b, 'ru')).map((subject) => {
      const evs = bySubject.get(subject)!;
      const days: DiaryCell[] = [];
      for (let d = 0; d < 5; d++) {
        const date = addDays(week.from, d);
        const dayEvents = evs.filter((e) => e.date === date);
        const marks = dayEvents.flatMap((e) => e.marks);
        const homework =
          dayEvents.map((e) => (e.homework ?? '').trim()).find((h) => h && h !== '—') ?? '';
        const note = dayEvents.flatMap((e) => e.comments.map((c) => c.text)).find(Boolean) ?? null;
        const missing = dayEvents.some((e) => e.missing);
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
