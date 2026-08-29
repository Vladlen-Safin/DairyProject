import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth/auth.service';

export const roleGuard = (allowedRoles: Array<'teacher' | 'student'>): CanActivateFn => {
  return () => {
    const authService = inject(AuthService);
    const router = inject(Router);

    const user = authService.getCurrentUser();

    if (user && allowedRoles.includes(user.role)) {
      return true;
    }

    router.navigate(['/forbidden']);
    return false;
  };
};