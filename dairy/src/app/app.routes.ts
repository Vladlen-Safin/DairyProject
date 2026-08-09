import { Routes } from '@angular/router';
import { LayoutComponent } from './components/layout/layout.component';
import { AuthComponent } from './components/pages/Auth/auth.component';

export const routes: Routes = [
  {
    path: '',
    component: AuthComponent
  },
  {
    path: 'dairy',
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