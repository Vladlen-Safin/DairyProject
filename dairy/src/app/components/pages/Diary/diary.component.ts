import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

import { MatButtonModule } from '@angular/material/button';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatNativeDateModule } from '@angular/material/core';

interface DiaryDay {

  mark: string[];

  homework: string;

}

interface DiarySubject {

  subject: string;

  week: DiaryDay[];

}

@Component({

  selector: 'app-diary',

  standalone: true,

  imports: [

    CommonModule,

    MatButtonModule,

    MatDatepickerModule,

    MatFormFieldModule,

    MatInputModule,

    MatSelectModule,

    MatNativeDateModule

  ],

  templateUrl: './diary.component.html',

  styleUrls: ['./diary.component.scss']

})
export class DiaryComponent {

  public quarters = [

    '1-я четверть',

    '2-я четверть',

    '3-я четверть',

    '4-я четверть',

    'Итоговая четверть'

  ];

  public selectedQuarter = this.quarters[0];

  public weeks = [

    '1 неделя (01.09 - 05.09)',

    '2 неделя (08.09 - 12.09)',

    '3 неделя (15.09 - 19.09)',

    '4 неделя (22.09 - 26.09)',

    '5 неделя (29.09 - 03.10)'

  ];

  public selectedWeek = this.weeks[0];

  public subjects: DiarySubject[] = [

    {

      subject: 'Алгебра',

      week: [

        {

          mark: ['5', '4'],

          homework: '№345, 346'

        },

        {

          mark: ['4', '5', '5'],

          homework: '№347'

        },

        {

          mark: ['3'],

          homework: 'Подготовка к контрольной'

        },

        {

          mark: ['5'],

          homework: '№350'

        },

        {

          mark: ['4', '4'],

          homework: '№352'

        }

      ]

    },

    {

      subject: 'Русский язык',

      week: [

        {

          mark: ['5'],

          homework: 'Упр.234'

        },

        {

          mark: ['4'],

          homework: 'Упр.235'

        },

        {

          mark: ['5', '4'],

          homework: 'Сочинение'

        },

        {

          mark: ['4'],

          homework: 'Упр.236'

        },

        {

          mark: ['5'],

          homework: '—'

        }

      ]

    },

    {

      subject: 'Информатика',

      week: [

        {

          mark: ['5'],

          homework: 'Практическая работа'

        },

        {

          mark: ['5', '4'],

          homework: 'Практическая работа'

        },

        {

          mark: ['4'],

          homework: 'Алгоритмы'

        },

        {

          mark: ['О'],

          homework: '—'

        },

        {

          mark: ['5'],

          homework: 'Практическая работа'

        }

      ]

    }

  ];

}