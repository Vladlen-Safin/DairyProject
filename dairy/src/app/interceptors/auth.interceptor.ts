import { HttpInterceptorFn, HttpErrorResponse } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from '../services/auth/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const authService = inject(AuthService);
  const token = authService.getAccessToken();

  const authReq = token
    ? req.clone({
        setHeaders: { Authorization: `Bearer ${token}` },
        withCredentials: true,
      })
    : req.clone({ withCredentials: true });

  return next(authReq).pipe(
    catchError((error: HttpErrorResponse) => {
      // Access-токен истёк — пробуем обновить один раз и повторить запрос
      if (error.status === 401 && !req.url.includes('/auth/refresh')) {
        return authService.refresh().pipe(
          switchMap((res) => {
            if (!res) return throwError(() => error);

            const retriedReq = req.clone({
              setHeaders: { Authorization: `Bearer ${res.accessToken}` },
              withCredentials: true,
            });
            return next(retriedReq);
          })
        );
      }
      return throwError(() => error);
    })
  );
};