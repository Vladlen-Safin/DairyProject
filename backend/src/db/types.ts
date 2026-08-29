import type { Generated } from "kysely";

export interface DB {
  app_users: {
    id: Generated<number>;
    username: string;
    password_hash: string;
    status: number;
    created_at: Generated<Date>;
  };

  ediary_schoolyears: {
    id: Generated<number>;
    ext_id: string;
    name: string;
    start: string; // DATE как строка YYYY-MM-DD, см. db/index.ts
    end: string;
  };

  ediary_term_types: {
    id: Generated<number>;
    ext_id: string;
    name: string;
  };

  ediary_terms: {
    id: Generated<number>;
    ext_id: string;
    name: string;
    type_id: number;
  };

  ediary_teachers: {
    id: Generated<number>;
    ext_id: string;
    name: string;
  };

  ediary_subjects: {
    id: Generated<number>;
    ext_id: string;
    name: string;
  };

  ediary_pupils: {
    id: Generated<number>;
    ext_id: string;
  };

  ediary_pupils_accounts: {
    id: Generated<number>;
    pupil: number;
    type: string;
    uid: number;
  };

  ediary_parent: {
    pid: number;
    cid: number;
  };

  ediary_shifts: {
    id: Generated<number>;
    name: number;
    schoolyear: number;
    parallelstart: number;
    parallelend: number;
  };

  ediary_lessons: {
    id: Generated<number>;
    shift: number;
    lessonnumber: number;
    weekday: number;
    timebegin: string;
    timeend: string;
  };

  ediary_groups: {
    id: Generated<number>;
    ext_id: string;
    schoolyear: number;
    parallel: number | null;
    shift: number | null;
    termtype: number | null;
  };

  ediary_groups_terms: {
    id: Generated<number>;
    group_id: number;
    term: number;
    date_start: string;
    date_end: string;
  };

  ediary_groups_pupils: {
    id: Generated<number>;
    group_id: number;
    pupil: number;
    date_start: string;
    date_end: string;
  };

  ediary_events: {
    id: Generated<number>;
    ext_id: string;
    date: string;
    lesson: number;
    subject: number;
    teacher: number;
    group_id: number;
    cabinet: string | null;
    homework: string | null;
  };

  ediary_comments: {
    id: Generated<number>;
    event: number;
    pupil: number;
    text: string;
  };

  ediary_marks: {
    id: Generated<number>;
    event: number;
    pupil: number;
    value: string;
    comment: string | null;
  };

  ediary_missings: {
    id: Generated<number>;
    event: number;
    pupil: number;
  };

  ediary_final_events: {
    id: Generated<number>;
    ext_id: string;
    type: string;
    term_ext_id: string | null;
    subject: number;
    schoolyear: number;
    group_id: number;
  };

  ediary_final_marks: {
    id: Generated<number>;
    event: number;
    pupil: number;
    value: string;
  };

  ediary_import_results: {
    id: Generated<number>;
    file: string;
    messageno: string;
    errors: string;
    success: number;
    fail: number;
    updated_at: Generated<Date>;
  };

  ediary_import_checkpoint: {
    id: Generated<number>;
    messageno: string;
    filename: string;
    processed_count: number;
    status: string;
    updated_at: Generated<Date>;
  };
}