export interface TermInfo {
  id: number;
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

export interface EventMark {
  pupil: number;
  pupil_ext_id: string;
  value: string;
  comment: string | null;
}

export interface EventComment {
  pupil: number;
  pupil_ext_id: string;
  text: string;
}

export interface EventMissing {
  pupil: number;
  pupil_ext_id: string;
}

export interface DiaryEvent {
  id: number;
  ext_id: string;
  date: string;
  lesson: number;
  cabinet: string | null;
  homework: string | null;
  subject: string;
  teacher: string;
  marks: EventMark[];
  comments: EventComment[];
  missings: EventMissing[];
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
