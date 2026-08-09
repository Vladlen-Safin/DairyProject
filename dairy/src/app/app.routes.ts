import { Routes } from '@angular/router';
import { LayoutComponent } from './components/layout/layout.component';

export const routes: Routes = [
  {
    path: '',
    component: LayoutComponent,
    children: [

      {
        path: '',
        loadComponent: () =>
          import('./components/pages/Diary/diary.component')
            .then(m => m.DiaryComponent)
      }
    ]

  }
];