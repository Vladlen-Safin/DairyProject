export interface TermInfo {
  id: number;
  ext_id: string;
  name: string;
  date_start: string;
  date_end: string;
}

export interface GroupInfo {
  id: number;
  ext_id: string;
  parallel: number | null;
  schoolyear_id: number;
  schoolyear_name: string;
  schoolyear_start: string;
  schoolyear_end: string;
}

export interface MeResponse {
  id: number;
  login: string;
  role: 'teacher' | 'student';
  pupil: { id: number; ext_id: string } | null;
  group: GroupInfo | null;
  terms: TermInfo[];
  studyPeriod: string | null;
}

/**
 * Занятие из /api/my-events - уже отфильтровано бэкендом по текущему ученику
 * (и по всем его группам, актуальным на запрошенный период), поэтому здесь
 * нет списков "по всем ученикам группы", как в общем /api/events.
 */
export interface MyEvent {
  id: number;
  ext_id: string;
  date: string;
  lesson: number;
  cabinet: string | null;
  homework: string | null;
  subject: string;
  teacher: string;
  group_id: number;
  group_ext_id: string;
  lesson_time: { timebegin: string; timeend: string } | null;
  marks: { value: string; comment: string | null }[];
  comments: { text: string }[];
  missing: boolean;
}

export interface FinalEvent {
  id: number;
  ext_id: string;
  type: string;
  term_ext_id: string | null;
  group_id: number;
  subject: string;
  marks: { pupil: number; pupil_ext_id: string; value: string }[];
}
