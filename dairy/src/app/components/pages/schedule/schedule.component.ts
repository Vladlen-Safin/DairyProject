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

  currentDate = 'Понедельник, 1 сентября';

  lessons: Lesson[] = [];

}