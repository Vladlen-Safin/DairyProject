import { Injectable, signal, computed } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of, BehaviorSubject, switchMap, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { AuthUser, LoginRequest, LoginResponse } from '../../models/auth.models';

@Injectable({ providedIn: 'root' })
export class AuthService {
  // accessToken живёт только в памяти вкладки — при перезагрузке страницы
  // потребуется /refresh (это нормально и безопасно, т.к. refreshToken в httpOnly cookie)
  private accessToken: string | null = null;

  private currentUserSubject = new BehaviorSubject<AuthUser | null>(null);
  currentUser$ = this.currentUserSubject.asObservable();

  isAuthenticated = signal(false);

  constructor(private http: HttpClient) {}

  login(payload: LoginRequest): Observable<LoginResponse> {
    return this.http
      .post<LoginResponse>(`${environment.apiUrl}/auth/login`, payload, {
        withCredentials: true, // обязательно, чтобы браузер принял httpOnly cookie от сервера
      })
      .pipe(
        tap((res) => {
          this.setSession(res);
        })
      );
  }

  refresh(): Observable<{ accessToken: string } | null> {
    return this.http
      .post<{ accessToken: string }>(
        `${environment.apiUrl}/auth/refresh`,
        {},
        { withCredentials: true }
      )
      .pipe(
        tap((res) => {
          this.accessToken = res.accessToken;
          this.isAuthenticated.set(true);
        }),
        // После перезагрузки страницы currentUser теряется - восстанавливаем его
        // через /api/me, иначе roleGuard не пропустит на защищённые роуты.
        switchMap((res) =>
          this.http.get<AuthUser>(`${environment.apiUrl}/me`).pipe(
            tap((me) =>
              this.currentUserSubject.next({ id: me.id, login: me.login, role: me.role })
            ),
            map(() => res),
            catchError(() => of(res))
          )
        ),
        catchError(() => {
          this.clearSession();
          return of(null);
        })
      );
  }

  logout(): Observable<unknown> {
    return this.http
      .post(`${environment.apiUrl}/auth/logout`, {}, { withCredentials: true })
      .pipe(tap(() => this.clearSession()));
  }

  getAccessToken(): string | null {
    return this.accessToken;
  }

  getCurrentUser(): AuthUser | null {
    return this.currentUserSubject.value;
  }

  setAccessToken(token: string): void {
    this.accessToken = token;
  }

  private setSession(res: LoginResponse): void {
    this.accessToken = res.accessToken;
    this.currentUserSubject.next(res.user);
    this.isAuthenticated.set(true);
  }

  private clearSession(): void {
    this.accessToken = null;
    this.currentUserSubject.next(null);
    this.isAuthenticated.set(false);
  }
}