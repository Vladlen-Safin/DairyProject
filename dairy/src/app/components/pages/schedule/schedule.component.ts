import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { forkJoin, of, switchMap } from 'rxjs';

import { DataService } from '../../../services/data/data.service';
import { MeResponse, MyEvent } from '../../../models/diary.models';

interface Lesson {
  eventId: number;
  number: number;
  time: string;
  subject: string;
  teacher: string;
  room: string;
}

const WEEKDAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница'];
const MONTHS = [
  'января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря',
];

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function todayDate(): Date {
  const now = new Date();
  // Календарная дата пользователя без сдвига на предыдущий день из-за UTC.
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}
function mondayOf(date: Date): Date {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (day === 0 ? -6 : 1 - day));
  return d;
}
function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCDate(r.getUTCDate() + n);
  return r;
}
function isoWeekValue(monday: Date): string {
  // значение для <input type="week"> в формате YYYY-Www
  const target = new Date(monday);
  const thursday = addDays(target, 3);
  const firstMonday = mondayOf(new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4)));
  const week = 1 + Math.round((monday.getTime() - firstMonday.getTime()) / (7 * 86400000));
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
function mondayFromWeekValue(value: string): Date {
  const [y, w] = value.split('-W').map(Number);
  const jan4 = new Date(Date.UTC(y, 0, 4));
  return mondayOf(addDays(jan4, (w - 1) * 7));
}

@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './schedule.component.html',
  styleUrls: ['./schedule.component.scss'],
})
export class ScheduleComponent implements OnInit {
  private data = inject(DataService);

  readonly weekdayNames = WEEKDAYS;

  loading = true;
  error: string | null = null;

  selectedWeek = '';
  weekRange = '';
  currentDate = '';
  selectedDayIndex = 0;
  lessons: Lesson[] = [];
  showWeek = false;
  weekDays: { name: string; date: string; lessons: Lesson[] }[] = [];
  weekRows: { number: number; days: Lesson[][] }[] = [];
  private touchStart: { x: number; y: number } | null = null;

  moveDay(delta: number): void {
    if (this.loading) return;
    const index = this.selectedDayIndex + delta;
    if (index < 0 || index >= WEEKDAYS.length) {
      this.selectedDayIndex = index < 0 ? WEEKDAYS.length - 1 : 0;
      this.shiftWeek(delta);
    } else {
      this.selectDay(index);
    }
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
    if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.5) this.moveDay(dx < 0 ? 1 : -1);
  }

  cancelSwipe(): void { this.touchStart = null; }

  teacherInitials(name: string): string {
    const [surname, ...names] = name.trim().split(/\s+/);
    return [surname, ...names.map((part) => part.includes('.') ? part : `${part[0]}.`)].join(' ');
  }

  private me: MeResponse | null = null;
  private monday = mondayOf(todayDate());
  private weekEvents: MyEvent[] = [];

  ngOnInit(): void {
    const today = todayDate();
    const todayIdx = (today.getUTCDay() + 6) % 7; // 0=пн
    this.selectedDayIndex = todayIdx < WEEKDAYS.length ? todayIdx : 0;
    this.monday = mondayOf(today);
    this.refresh();

    this.data
      .me()
      .pipe(
        switchMap((me) => {
          this.me = me;
          if (!me.group) return of({ me, events: [] as MyEvent[] });
          return forkJoin({ me: of(me), events: this.loadWeek() });
        })
      )
      .subscribe({
        next: ({ me, events }) => {
          this.loading = false;
          if (!me.group) {
            this.error = 'Учётная запись не привязана к классу — расписание недоступно.';
            return;
          }
          this.weekEvents = events;
          this.refresh();
        },
        error: (err) => {
          this.loading = false;
          this.error = err?.error?.error || 'Не удалось загрузить расписание';
        },
      });
  }

  private loadWeek() {
    const from = iso(this.monday);
    const to = iso(addDays(this.monday, 6));
    // /my-events сам находит все группы ученика за неделю - не только "текущую".
    return this.data.myEvents(from, to);
  }

  onWeekChange(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    if (!value) return;
    this.monday = mondayFromWeekValue(value);
    this.reloadWeek();
  }

  shiftWeek(delta: number): void {
    this.monday = addDays(this.monday, delta * 7);
    this.reloadWeek();
  }

  get isCurrentWeek(): boolean {
    return iso(this.monday) === iso(mondayOf(todayDate()));
  }

  goToCurrentWeek(): void {
    const today = todayDate();
    this.monday = mondayOf(today);
    const dayIndex = (today.getUTCDay() + 6) % 7;
    this.selectedDayIndex = dayIndex < WEEKDAYS.length ? dayIndex : 0;
    this.showWeek = false;
    this.reloadWeek();
  }

  private reloadWeek(): void {
    if (!this.me?.group) return;
    this.loading = true;
    this.error = null;
    this.weekEvents = [];
    this.refresh();
    this.loadWeek().subscribe({
      next: (events) => {
        this.loading = false;
        this.weekEvents = events;
        this.refresh();
      },
      error: (err) => {
        this.loading = false;
        this.error = err?.error?.error || 'Не удалось загрузить расписание';
      },
    });
  }

  selectDay(i: number): void {
    this.showWeek = false;
    this.selectedDayIndex = i;
    this.refresh();
  }

  onDayChange(value: string | number): void {
    if (value === 'week') {
      this.showWeek = true;
      return;
    }
    const index = Number(value);
    if (Number.isInteger(index) && index >= 0 && index < this.weekdayNames.length) {
      this.selectDay(index);
    }
  }

  private refresh(): void {
    this.selectedWeek = isoWeekValue(this.monday);
    const sunday = addDays(this.monday, 6);
    this.weekRange = `${this.fmt(this.monday)} – ${this.fmt(sunday)}`;

    const day = addDays(this.monday, this.selectedDayIndex);
    this.currentDate = `${WEEKDAYS[this.selectedDayIndex]}, ${day.getUTCDate()} ${
      MONTHS[day.getUTCMonth()]
    } ${day.getUTCFullYear()}`;

    this.weekDays = WEEKDAYS.map((name, index) => ({
      name,
      date: this.fmt(addDays(this.monday, index)),
      lessons: this.lessonsOn(iso(addDays(this.monday, index))),
    }));
    this.lessons = this.weekDays[this.selectedDayIndex].lessons;
    const numbers = [...new Set(this.weekDays.flatMap((item) => item.lessons.map((lesson) => lesson.number)))].sort((a, b) => a - b);
    this.weekRows = numbers.map((number) => ({
      number,
      days: this.weekDays.map((item) => item.lessons.filter((lesson) => lesson.number === number)),
    }));
  }

  private lessonsOn(date: string): Lesson[] {
    return this.weekEvents
      .filter((e) => e.date === date)
      .sort((a, b) => a.lesson - b.lesson)
      .map((e) => ({
        eventId: e.id,
        number: e.lesson,
        time: e.lesson_time?.timebegin && e.lesson_time?.timeend
          ? `${e.lesson_time.timebegin}–${e.lesson_time.timeend}`
          : 'Время не указано',
        subject: e.subject,
        teacher: e.teacher,
        room: e.cabinet ?? '—',
      }));
  }

  private fmt(d: Date): string {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(d.getUTCDate())}.${p(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}`;
  }
}
