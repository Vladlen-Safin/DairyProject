import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from '../services/auth/auth.service';

export const authGuard: CanActivateFn = (route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (authService.isAuthenticated()) {
    return true;
  }

  // Токена в памяти нет (например, юзер обновил страницу) —
  // пробуем восстановить сессию через httpOnly refresh-cookie
  return authService.refresh().pipe(
    map((res) => {
      if (res) return true;
      router.navigate(['/auth'], { queryParams: { returnUrl: state.url } });
      return false;
    }),
    catchError(() => {
      router.navigate(['/auth']);
      return of(false);
    })
  );
};