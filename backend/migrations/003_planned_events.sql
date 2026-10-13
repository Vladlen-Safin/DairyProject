BEGIN;
ALTER TABLE ediary_events ALTER COLUMN ext_id DROP NOT NULL;

-- A complete message replaces the anonymous timetable snapshot. Stage it until
-- every events file has finished, including requests resumed via CONTINUE.
CREATE TABLE IF NOT EXISTS ediary_planned_events_stage (
    messageno VARCHAR(50) NOT NULL,
    filename TEXT NOT NULL,
    position INTEGER NOT NULL,
    payload JSONB NOT NULL,
    PRIMARY KEY (messageno, filename, position)
);
COMMIT;
