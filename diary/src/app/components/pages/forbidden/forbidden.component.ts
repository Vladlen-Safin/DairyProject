import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-forbidden',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div style="max-width:480px;margin:80px auto;text-align:center;font-family:system-ui">
      <h1 style="font-size:48px;margin:0">403</h1>
      <p>Доступ к этому разделу запрещён для вашей роли.</p>
      <a routerLink="/diary">Вернуться в дневник</a>
    </div>
  `,
})
export class ForbiddenComponent {}
