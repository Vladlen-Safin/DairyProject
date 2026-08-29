import { Routes } from '@angular/router';
import { LayoutComponent } from './components/layout/layout.component';
import { AuthComponent } from './components/pages/Auth/auth.component';
import { authGuard } from './guards/auth.guard';
import { roleGuard } from './guards/role.guard';

export const routes: Routes = [
  {
    path: '',
    component: AuthComponent
  },
  {
    path: 'dairy',
    component: LayoutComponent,
    canActivate: [authGuard, roleGuard(['student'])],
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