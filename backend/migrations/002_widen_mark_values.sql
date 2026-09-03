-- =====================================================================
-- 002: расширяем колонки оценок и времени звонков.
-- В реальной выгрузке 1С значение оценки не помещается в VARCHAR(5):
-- бывают "н/а", "осв", "зачёт", "5 (5)" и пр. Время звонков в book.xml
-- тоже может приходить длиннее "HH:MM".
--
-- Применять на уже развёрнутой БД:
--   npm run migrate -- 002_widen_mark_values.sql
-- =====================================================================

ALTER TABLE ediary_marks       ALTER COLUMN value     TYPE VARCHAR(20);
ALTER TABLE ediary_final_marks ALTER COLUMN value     TYPE VARCHAR(20);
ALTER TABLE ediary_lessons     ALTER COLUMN timebegin TYPE VARCHAR(10);
ALTER TABLE ediary_lessons     ALTER COLUMN timeend   TYPE VARCHAR(10);
