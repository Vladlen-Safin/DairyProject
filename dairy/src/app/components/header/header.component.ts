import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';

import { AuthService } from '../../services/auth/auth.service';
import { DataService } from '../../services/data/data.service';

@Component({
  selector: 'app-header',
  standalone: true,
  imports: [CommonModule, RouterModule, MatToolbarModule, MatButtonModule],
  templateUrl: './header.component.html',
  styleUrl: './header.component.scss',
})
export class HeaderComponent implements OnInit {
  private auth = inject(AuthService);
  private data = inject(DataService);
  private router = inject(Router);

  studentName = '';
  studyPeriod = '';

  ngOnInit(): void {
    this.data.me().subscribe({
      next: (me) => {
        this.studentName = me.pupil ? `Ученик ${me.login}` : me.login;
        this.studyPeriod = me.studyPeriod ?? '';
      },
      error: () => {},
    });
  }

  logout(): void {
    this.auth.logout().subscribe({
      next: () => this.router.navigate(['/auth']),
      error: () => this.router.navigate(['/auth']),
    });
  }
}
