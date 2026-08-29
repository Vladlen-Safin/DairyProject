-- =====================================================================
-- Электронный дневник: базовая схема PostgreSQL
-- =====================================================================

-- Пользователи системы (замена системы пользователей Drupal).
-- Полноценный слой авторизации (JWT, хэширование паролей и т.д.)
-- проектируем отдельным шагом - здесь только структура данных.
CREATE TABLE app_users (
    id            SERIAL PRIMARY KEY,
    username      VARCHAR(255) NOT NULL UNIQUE,
    password_hash TEXT         NOT NULL,
    status        SMALLINT     NOT NULL DEFAULT 1,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- Справочники из book.xml
-- ---------------------------------------------------------------------

CREATE TABLE ediary_schoolyears (
    id      SERIAL PRIMARY KEY,
    ext_id  VARCHAR(36) NOT NULL UNIQUE,
    name    TEXT        NOT NULL,
    start   DATE        NOT NULL,
    "end"   DATE        NOT NULL
);
CREATE INDEX idx_schoolyears_range ON ediary_schoolyears (start, "end");

CREATE TABLE ediary_term_types (
    id      SERIAL PRIMARY KEY,
    ext_id  VARCHAR(36) NOT NULL UNIQUE,
    name    TEXT        NOT NULL
);

CREATE TABLE ediary_terms (
    id       SERIAL PRIMARY KEY,
    ext_id   VARCHAR(36) NOT NULL,
    name     TEXT        NOT NULL,
    type_id  INTEGER     NOT NULL REFERENCES ediary_term_types(id) ON DELETE CASCADE,
    -- в оригинале термины полностью перезаписывались при каждом импорте
    -- схемы аттестации (clear_sub); здесь делаем честный upsert по составному ключу
    UNIQUE (ext_id, type_id)
);
CREATE INDEX idx_terms_ext_id ON ediary_terms (ext_id);

CREATE TABLE ediary_teachers (
    id      SERIAL PRIMARY KEY,
    ext_id  VARCHAR(36) NOT NULL UNIQUE,
    name    TEXT        NOT NULL
);

CREATE TABLE ediary_subjects (
    id      SERIAL PRIMARY KEY,
    ext_id  VARCHAR(36) NOT NULL UNIQUE,
    name    TEXT        NOT NULL
);

CREATE TABLE ediary_pupils (
    id      SERIAL PRIMARY KEY,
    ext_id  VARCHAR(36) NOT NULL UNIQUE
);

CREATE TABLE ediary_pupils_accounts (
    id      SERIAL PRIMARY KEY,
    pupil   INTEGER     NOT NULL REFERENCES ediary_pupils(id) ON DELETE CASCADE,
    type    VARCHAR(20) NOT NULL, -- 'pupil' | 'parent'
    uid     INTEGER     NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE
);
CREATE INDEX idx_pupils_accounts_pupil ON ediary_pupils_accounts (pupil);

CREATE TABLE ediary_parent (
    pid  INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    cid  INTEGER NOT NULL REFERENCES app_users(id) ON DELETE CASCADE,
    PRIMARY KEY (pid, cid)
);
CREATE INDEX idx_parent_cid ON ediary_parent (cid);

CREATE TABLE ediary_shifts (
    id             SERIAL  PRIMARY KEY,
    name           INTEGER NOT NULL,
    schoolyear     INTEGER NOT NULL REFERENCES ediary_schoolyears(id) ON DELETE CASCADE,
    parallelstart  INTEGER NOT NULL,
    parallelend    INTEGER NOT NULL
);
CREATE INDEX idx_shifts_lookup ON ediary_shifts (schoolyear, name, parallelstart, parallelend);

CREATE TABLE ediary_lessons (
    id            SERIAL  PRIMARY KEY,
    shift         INTEGER NOT NULL REFERENCES ediary_shifts(id) ON DELETE CASCADE,
    lessonnumber  INTEGER NOT NULL,
    weekday       INTEGER NOT NULL,
    timebegin     VARCHAR(5) NOT NULL,
    timeend       VARCHAR(5) NOT NULL
);
CREATE INDEX idx_lessons_shift ON ediary_lessons (shift, weekday, lessonnumber);

-- ---------------------------------------------------------------------
-- Данные из groups.xml
-- ---------------------------------------------------------------------

CREATE TABLE ediary_groups (
    id          SERIAL  PRIMARY KEY,
    ext_id      VARCHAR(36) NOT NULL,
    schoolyear  INTEGER NOT NULL REFERENCES ediary_schoolyears(id) ON DELETE CASCADE,
    parallel    INTEGER,
    shift       INTEGER,
    termtype    INTEGER REFERENCES ediary_term_types(id),
    -- группа с одним и тем же ext_id переиздаётся каждый учебный год - составной ключ
    UNIQUE (ext_id, schoolyear)
);
CREATE INDEX idx_groups_schoolyear ON ediary_groups (schoolyear);

CREATE TABLE ediary_groups_terms (
    id          SERIAL  PRIMARY KEY,
    group_id    INTEGER NOT NULL REFERENCES ediary_groups(id) ON DELETE CASCADE,
    term        INTEGER NOT NULL REFERENCES ediary_terms(id) ON DELETE CASCADE,
    date_start  DATE    NOT NULL,
    date_end    DATE    NOT NULL
);
CREATE INDEX idx_groups_terms_group ON ediary_groups_terms (group_id);
CREATE INDEX idx_groups_terms_term ON ediary_groups_terms (term);

CREATE TABLE ediary_groups_pupils (
    id          SERIAL  PRIMARY KEY,
    group_id    INTEGER NOT NULL REFERENCES ediary_groups(id) ON DELETE CASCADE,
    pupil       INTEGER NOT NULL REFERENCES ediary_pupils(id) ON DELETE CASCADE,
    date_start  DATE    NOT NULL,
    date_end    DATE    NOT NULL
);
CREATE INDEX idx_groups_pupils_pupil_range ON ediary_groups_pupils (pupil, date_start, date_end);
CREATE INDEX idx_groups_pupils_group ON ediary_groups_pupils (group_id);

-- ---------------------------------------------------------------------
-- Данные из events.xml
-- ---------------------------------------------------------------------

CREATE TABLE ediary_events (
    id        SERIAL  PRIMARY KEY,
    ext_id    VARCHAR(36) NOT NULL UNIQUE,
    date      DATE    NOT NULL,
    lesson    INTEGER NOT NULL,
    subject   INTEGER NOT NULL REFERENCES ediary_subjects(id),
    teacher   INTEGER NOT NULL REFERENCES ediary_teachers(id),
    group_id  INTEGER NOT NULL REFERENCES ediary_groups(id),
    cabinet   TEXT,
    homework  TEXT
);
CREATE INDEX idx_events_group_date ON ediary_events (group_id, date);
CREATE INDEX idx_events_date ON ediary_events (date);

CREATE TABLE ediary_comments (
    id      SERIAL  PRIMARY KEY,
    event   INTEGER NOT NULL REFERENCES ediary_events(id) ON DELETE CASCADE,
    pupil   INTEGER NOT NULL REFERENCES ediary_pupils(id) ON DELETE CASCADE,
    text    TEXT    NOT NULL
);
CREATE INDEX idx_comments_event_pupil ON ediary_comments (event, pupil);

CREATE TABLE ediary_marks (
    id       SERIAL  PRIMARY KEY,
    event    INTEGER NOT NULL REFERENCES ediary_events(id) ON DELETE CASCADE,
    pupil    INTEGER NOT NULL REFERENCES ediary_pupils(id) ON DELETE CASCADE,
    value    VARCHAR(5) NOT NULL,
    comment  TEXT
    -- намеренно без UNIQUE(event, pupil): в реальной выгрузке 1С один и тот же
    -- ученик может иметь несколько оценок за один урок (см. пример events.xml)
);
CREATE INDEX idx_marks_pupil_event ON ediary_marks (pupil, event);
CREATE INDEX idx_marks_event ON ediary_marks (event);

CREATE TABLE ediary_missings (
    id     SERIAL  PRIMARY KEY,
    event  INTEGER NOT NULL REFERENCES ediary_events(id) ON DELETE CASCADE,
    pupil  INTEGER NOT NULL REFERENCES ediary_pupils(id) ON DELETE CASCADE,
    UNIQUE (event, pupil)
);
CREATE INDEX idx_missings_pupil ON ediary_missings (pupil);

-- ---------------------------------------------------------------------
-- Данные из final_marks.xml
-- ---------------------------------------------------------------------

CREATE TABLE ediary_final_events (
    id          SERIAL  PRIMARY KEY,
    ext_id      VARCHAR(36) NOT NULL UNIQUE,
    type        VARCHAR(20) NOT NULL, -- term | year | final | exam
    term_ext_id VARCHAR(36),          -- ext_id термина (как и в оригинале, без строгого FK на терм)
    subject     INTEGER NOT NULL REFERENCES ediary_subjects(id),
    schoolyear  INTEGER NOT NULL REFERENCES ediary_schoolyears(id),
    group_id    INTEGER NOT NULL REFERENCES ediary_groups(id)
);
CREATE INDEX idx_final_events_schoolyear_subject ON ediary_final_events (schoolyear, subject);
CREATE INDEX idx_final_events_group ON ediary_final_events (group_id);

CREATE TABLE ediary_final_marks (
    id      SERIAL  PRIMARY KEY,
    event   INTEGER NOT NULL REFERENCES ediary_final_events(id) ON DELETE CASCADE,
    pupil   INTEGER NOT NULL REFERENCES ediary_pupils(id) ON DELETE CASCADE,
    value   VARCHAR(5) NOT NULL
);
CREATE INDEX idx_final_marks_event_pupil ON ediary_final_marks (event, pupil);

-- ---------------------------------------------------------------------
-- Служебные таблицы протокола обмена с 1С
-- ---------------------------------------------------------------------

-- Аналог ediary_results из PHP-версии
CREATE TABLE ediary_import_results (
    id          SERIAL PRIMARY KEY,
    file        VARCHAR(255) NOT NULL,
    messageno   VARCHAR(50)  NOT NULL,
    errors      TEXT NOT NULL DEFAULT '',
    success     INTEGER NOT NULL DEFAULT 0,
    fail        INTEGER NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (file, messageno)
);

-- Замена .tmp-файлов: прогресс обработки конкретного файла в рамках сообщения
CREATE TABLE ediary_import_checkpoint (
    id               SERIAL PRIMARY KEY,
    messageno        VARCHAR(50)  NOT NULL,
    filename         VARCHAR(255) NOT NULL,
    processed_count  INTEGER      NOT NULL DEFAULT 0,
    status           VARCHAR(20)  NOT NULL DEFAULT 'in_progress',
    updated_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
    UNIQUE (messageno, filename)
);