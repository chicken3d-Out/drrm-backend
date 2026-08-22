-- Adds a JSONB track column to store historical positions for events that
-- move over time (tropical cyclones), enabling animated track playback on
-- the map. Nullable — most hazard types (earthquake, volcano, etc.) are
-- single-point and leave this null.
ALTER TABLE disaster_events ADD COLUMN IF NOT EXISTS track JSONB;
