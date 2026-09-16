import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';
import { FinalEvent, MeResponse, MyEvent } from '../../models/diary.models';

/** Чтение данных дневника с бэкенда (/api/*). Bearer-токен добавляет authInterceptor. */
@Injectable({ providedIn: 'root' })
export class DataService {
  private http = inject(HttpClient);
  private base = environment.apiUrl;

  me(): Observable<MeResponse> {
    return this.http.get<MeResponse>(`${this.base}/me`);
  }

  /** Занятия текущего ученика за период — по всем его группам сразу, бэкенд сам их находит. */
  myEvents(from: string, to: string): Observable<MyEvent[]> {
    return this.http.get<MyEvent[]>(`${this.base}/my-events`, {
      params: { from, to },
    });
  }

  /** Все группы текущего ученика, строго в пределах выбранного учебного года. */
  myFinalMarks(schoolyear: number): Observable<FinalEvent[]> {
    return this.http.get<FinalEvent[]>(`${this.base}/my-final-marks`, {
      params: { schoolyear },
    });
  }

  finalMarks(group: number, pupil?: number): Observable<FinalEvent[]> {
    const params: Record<string, string | number> = { group };
    if (pupil != null) params['pupil'] = pupil;
    return this.http.get<FinalEvent[]>(`${this.base}/final-marks`, { params });
  }
}
