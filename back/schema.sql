-- ============================================
-- Пример схемы базы данных PostgreSQL
-- Пользователи с ролями: teacher / student
-- ============================================

-- Расширение для генерации UUID (если хотите UUID вместо serial id)
-- CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Тип роли пользователя — ENUM гарантирует, что в базу нельзя
-- записать роль, которой не существует (доп. защита на уровне БД)
DROP TYPE IF EXISTS user_role;
CREATE TYPE user_role AS ENUM ('teacher', 'student');

-- ============================================
-- Таблица пользователей
-- ============================================
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    login           VARCHAR(100) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,      -- сюда пишем bcrypt-хэш, никогда не пароль в открытом виде
    role            user_role NOT NULL,
    full_name       VARCHAR(255) NOT NULL,
    email           VARCHAR(255) UNIQUE,
    is_active       BOOLEAN NOT NULL DEFAULT true,  -- можно временно блокировать пользователя
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Индекс по login ускоряет запрос при логине (UNIQUE уже создаёт индекс,
-- но явно показываю для наглядности, если бы поле не было уникальным)
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- ============================================
-- Таблица для учёта неудачных попыток входа (доп. защита от брутфорса на уровне БД,
-- дублирует rate-limit на уровне приложения, но переживает рестарт сервера)
-- ============================================
CREATE TABLE IF NOT EXISTS login_attempts (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE CASCADE,
    ip_address      INET NOT NULL,
    success         BOOLEAN NOT NULL,
    attempted_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_user_id ON login_attempts (user_id);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts (ip_address);

-- ============================================
-- Таблица refresh-токенов (позволяет отзывать конкретные сессии,
-- а не просто полагаться на срок жизни JWT)
-- ============================================
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash      VARCHAR(255) NOT NULL,   -- храним хэш токена, не сам токен
    expires_at      TIMESTAMPTZ NOT NULL,
    revoked         BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens (user_id);

-- ============================================
-- Триггер для автообновления updated_at при изменении строки
-- ============================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_users_updated_at ON users;
CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();

-- ============================================
-- Тестовые данные для примера
-- Пароли ниже — bcrypt-хэш от строки "password123" (cost factor 10)
-- Сгенерировать свой: node -e "console.log(require('bcrypt').hashSync('пароль', 10))"
-- ============================================
INSERT INTO users (login, password_hash, role, full_name, email)
VALUES
    ('ivanov_teacher', '$2b$10$H8hVClt00ulaLl4EXW7La.hLsM2fBPqNTuPd13QIi8Ta9ry050aDm', 'teacher', 'Иванов Иван Иванович', 'ivanov@school.local'),
    ('petrov_student', '$2b$10$H8hVClt00ulaLl4EXW7La.hLsM2fBPqNTuPd13QIi8Ta9ry050aDm', 'student', 'Петров Пётр Петрович', 'petrov@school.local')
ON CONFLICT (login) DO NOTHING;