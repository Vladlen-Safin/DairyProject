import { Routes } from '@angular/router';
import { LayoutComponent } from './components/layout/layout.component';
import { AuthComponent } from './components/pages/Auth/auth.component';
import { ForbiddenComponent } from './components/pages/forbidden/forbidden.component';
import { authGuard } from './guards/auth.guard';
import { roleGuard } from './guards/role.guard';

export const routes: Routes = [
  { path: 'auth', component: AuthComponent },
  { path: 'forbidden', component: ForbiddenComponent },
  {
    path: '',
    component: LayoutComponent,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'diary' },
      {
        path: 'diary',
        canActivate: [roleGuard(['student'])],
        loadComponent: () =>
          import('./components/pages/Diary/diary.component').then((m) => m.DiaryComponent),
      },
      {
        path: 'schedule',
        canActivate: [roleGuard(['student'])],
        loadComponent: () =>
          import('./components/pages/schedule/schedule.component').then(
            (m) => m.ScheduleComponent
          ),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
