import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, ActivatedRoute } from '@angular/router';
import { finalize } from 'rxjs';
import { AuthService } from '../../../services/auth/auth.service';

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

@Component({
  selector: 'app-auth',
  templateUrl: './auth.component.html',
  styleUrls: ['./auth.component.scss'],
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
})
export class AuthComponent implements OnInit, OnDestroy {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  form = this.fb.group({
    login: ['', [Validators.required, Validators.maxLength(100)]],
    password: ['', [Validators.required, Validators.minLength(4)]],
  });

  isSubmitting = false;
  errorMessage: string | null = null;

  attemptsLeft = MAX_ATTEMPTS;
  isLockedOut = false;
  lockoutSecondsLeft = 0;
  private lockoutInterval?: ReturnType<typeof setInterval>;

  ngOnInit(): void {
    this.restoreLockoutState();
  }

  ngOnDestroy(): void {
    if (this.lockoutInterval) clearInterval(this.lockoutInterval);
  }

  onSubmit(): void {
    if (this.form.invalid || this.isLockedOut || this.isSubmitting) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting = true;
    this.errorMessage = null;

    const { login, password } = this.form.getRawValue();

    this.authService
      .login({ login: login!, password: password! })
      .pipe(finalize(() => (this.isSubmitting = false)))
      .subscribe({
        next: () => {
          this.resetAttempts();
          const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/diary';
          this.router.navigateByUrl(returnUrl);
        },
        error: (err) => {
          this.handleLoginError(err);
        },
      });
  }

  private handleLoginError(err: any): void {
    if (err.status === 429) {
      this.errorMessage = 'Слишком много попыток входа. Попробуйте позже';
      this.lockOut(LOCKOUT_MS);
      return;
    }

    this.errorMessage = err.error?.error || 'Неверный логин или пароль';
    this.registerFailedAttempt();
  }

  private registerFailedAttempt(): void {
    this.attemptsLeft -= 1;
    localStorage.setItem('auth_attempts_left', String(this.attemptsLeft));

    if (this.attemptsLeft <= 0) {
      this.lockOut(LOCKOUT_MS);
    }
  }

  private lockOut(durationMs: number): void {
    this.isLockedOut = true;
    const unlockAt = Date.now() + durationMs;
    localStorage.setItem('auth_lockout_until', String(unlockAt));
    this.startLockoutCountdown(unlockAt);
  }

  private startLockoutCountdown(unlockAt: number): void {
    this.lockoutInterval = setInterval(() => {
      const secondsLeft = Math.ceil((unlockAt - Date.now()) / 1000);

      if (secondsLeft <= 0) {
        this.resetAttempts();
        clearInterval(this.lockoutInterval);
        return;
      }

      this.lockoutSecondsLeft = secondsLeft;
    }, 1000);
  }

  private restoreLockoutState(): void {
    const unlockAt = Number(localStorage.getItem('auth_lockout_until') || 0);
    const attemptsLeft = Number(
      localStorage.getItem('auth_attempts_left') ?? MAX_ATTEMPTS
    );

    this.attemptsLeft = attemptsLeft;

    if (unlockAt && unlockAt > Date.now()) {
      this.isLockedOut = true;
      this.startLockoutCountdown(unlockAt);
    }
  }

  private resetAttempts(): void {
    this.isLockedOut = false;
    this.attemptsLeft = MAX_ATTEMPTS;
    this.lockoutSecondsLeft = 0;
    localStorage.removeItem('auth_lockout_until');
    localStorage.removeItem('auth_attempts_left');
  }

  get loginControl() {
    return this.form.get('login')!;
  }

  get passwordControl() {
    return this.form.get('password')!;
  }
}