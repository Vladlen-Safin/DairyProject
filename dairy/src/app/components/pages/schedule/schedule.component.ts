import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

interface Lesson {

  number: number;

  time: string;

  subject: string;

  teacher: string;

  room: string;

}

@Component({
  selector: 'app-schedule',
  standalone: true,
  imports: [
    CommonModule
  ],
  templateUrl: './schedule.component.html',
  styleUrl: './schedule.component.scss'
})
export class ScheduleComponent {
  lessons: Lesson[] = [];

  selectedWeek: string = '';
  currentDate: string = '';
  weekRange = '';

ngOnInit(): void {
    const today = new Date();

    this.selectedWeek = this.getWeekValue(today);

    const monday = this.getDateFromWeek(
        today.getFullYear(),
        Number(this.selectedWeek.split('-W')[1])
    );
    this.updateDate(monday);
}


onWeekChange(event: Event): void {
    const input = event.target as HTMLInputElement;

    if (!input.value) return;

    this.selectedWeek = input.value;

    const [year, week] = input.value.split('-W');

    const monday = this.getDateFromWeek(
        Number(year),
        Number(week)
    );

    this.updateDate(monday);
}


// значение для input type="week"
getWeekValue(date: Date): string {
    const year = date.getFullYear();

    const firstDay = new Date(year, 0, 1);
    const days = Math.floor(
        (date.getTime() - firstDay.getTime()) / 86400000
    );

    const week = Math.ceil(
        (days + firstDay.getDay() + 1) / 7
    );

    return `${year}-W${week.toString().padStart(2, '0')}`;
}


// получение понедельника выбранной недели
getDateFromWeek(year: number, week: number): Date {

    const date = new Date(year, 0, 1);

    const day = date.getDay();

    const monday = new Date(
        date.setDate(
            date.getDate() + 
            (week - 1) * 7 -
            day +
            1
        )
    );

    return monday;
}


// формат вывода даты
updateDate(monday: Date): void {

    const days = [
        'Воскресенье',
        'Понедельник',
        'Вторник',
        'Среда',
        'Четверг',
        'Пятница',
        'Суббота'
    ];

    const months = [
        'января',
        'февраля',
        'марта',
        'апреля',
        'мая',
        'июня',
        'июля',
        'августа',
        'сентября',
        'октября',
        'ноября',
        'декабря'
    ];

    // Заголовок
    this.currentDate =
        `${days[monday.getDay()]}, ${monday.getDate()} ${months[monday.getMonth()]} ${monday.getFullYear()}`;

    // Воскресенье этой недели
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const format = (date: Date) =>
        `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1)
            .toString()
            .padStart(2, '0')}.${date.getFullYear()}`;

    this.weekRange = `${format(monday)} - ${format(sunday)}`;
}

}