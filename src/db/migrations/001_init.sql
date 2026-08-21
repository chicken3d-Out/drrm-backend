-- DepEd Leyte DRRM Monitoring System — initial schema
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "postgis";
CREATE EXTENSION IF NOT EXISTS "citext";

CREATE TYPE account_status AS ENUM ('PENDING','APPROVED','REJECTED','SUSPENDED');
CREATE TYPE notif_priority AS ENUM ('CRITICAL','HIGH','MODERATE','LOW','INFORMATION');

-- ─────────────────────────────── Users & Roles ───────────────────────────────

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email CITEXT UNIQUE NOT NULL CHECK (email ~* '^[a-zA-Z0-9._%+-]+@deped\.gov\.ph$'),
    password_hash TEXT NOT NULL,
    status account_status NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_login_at TIMESTAMPTZ
);

CREATE TABLE roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,
    description TEXT
);

INSERT INTO roles (name, description) VALUES
    ('DRRM_ADMIN', 'Division DRRM Administrator — full system administration'),
    ('DIVISION_DRRM_STAFF', 'Division DRRM Staff — monitors disasters, alerts, events'),
    ('SCHOOL_DRRM_COORDINATOR', 'School DRRM Coordinator — monitors events relevant to their school'),
    ('SCHOOL_HEAD', 'School Head — receives disaster notifications for their school'),
    ('DEPED_PERSONNEL', 'Authorized DepEd Personnel — view alerts, maps, history'),
    ('SYSTEM_ADMIN', 'System Administrator — technical management only');

CREATE TABLE user_roles (
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role_id UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
    PRIMARY KEY (user_id, role_id)
);

CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

-- ─────────────────────────────── Schools ───────────────────────────────

CREATE TABLE schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    school_type TEXT NOT NULL, -- Elementary | Junior High School | Senior High School | Integrated School | Other
    district TEXT,
    municipality TEXT NOT NULL,
    barangay TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE school_locations (
    school_id UUID PRIMARY KEY REFERENCES schools(id) ON DELETE CASCADE,
    point GEOGRAPHY(POINT, 4326) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_school_locations_gix ON school_locations USING GIST (point);

CREATE TABLE school_contacts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    contact_type TEXT NOT NULL, -- school_head | drrm_coordinator | office
    name TEXT,
    phone TEXT,
    email TEXT
);

CREATE TABLE user_profiles (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    designation TEXT,
    office TEXT,
    school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
    contact_number TEXT,
    profile_picture_url TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ─────────────────────────────── Data Sources & Disaster Events ───────────────────────────────

CREATE TABLE data_sources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT UNIQUE NOT NULL,          -- USGS | EONET | FIRMS | GDACS | PAGASA_TENDAY | MANUAL_ENTRY
    adapter_type TEXT NOT NULL,
    endpoint_url TEXT,
    status TEXT NOT NULL DEFAULT 'offline', -- online | degraded | offline
    last_sync_at TIMESTAMPTZ
);

INSERT INTO data_sources (name, adapter_type, endpoint_url) VALUES
    ('USGS', 'usgs-earthquake', 'https://earthquake.usgs.gov/fdsnws/event/1/query'),
    ('EONET', 'nasa-eonet', 'https://eonet.gsfc.nasa.gov/api/v3/events'),
    ('FIRMS', 'nasa-firms', 'https://firms.modaps.eosdis.nasa.gov/api/area/'),
    ('GDACS', 'gdacs', 'https://www.gdacs.org/xml/rss.xml'),
    ('PAGASA_TENDAY', 'pagasa-tenday', 'https://tenday.pagasa.dost.gov.ph/api/v1/tenday/current'),
    ('MANUAL_ENTRY', 'manual', NULL);

CREATE TABLE data_sync_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    data_source_id UUID NOT NULL REFERENCES data_sources(id) ON DELETE CASCADE,
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ,
    events_retrieved INTEGER DEFAULT 0,
    error_message TEXT,
    response_time_ms INTEGER
);

CREATE TABLE disaster_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    external_id TEXT,                 -- id from source, for de-duplication
    data_source_id UUID REFERENCES data_sources(id),
    disaster_type TEXT NOT NULL,      -- rainfall | tropical_cyclone | earthquake | tsunami | volcano | flood | landslide | wildfire | storm_surge | other
    official_title TEXT NOT NULL,
    source_agency TEXT NOT NULL,      -- verbatim, e.g. "PAGASA", "PHIVOLCS", "USGS"
    warning_level TEXT,               -- verbatim from source, never invented
    description TEXT,
    area GEOGRAPHY(GEOMETRY, 4326),
    status TEXT NOT NULL DEFAULT 'active', -- active | updated | closed
    issued_at TIMESTAMPTZ NOT NULL,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    official_source_url TEXT,
    is_leyte_priority BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (data_source_id, external_id)
);
CREATE INDEX idx_disaster_events_area_gix ON disaster_events USING GIST (area);
CREATE INDEX idx_disaster_events_status ON disaster_events (status);
CREATE INDEX idx_disaster_events_type ON disaster_events (disaster_type);

CREATE TABLE disaster_event_updates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    disaster_event_id UUID NOT NULL REFERENCES disaster_events(id) ON DELETE CASCADE,
    update_text TEXT,
    warning_level TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE affected_areas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    disaster_event_id UUID NOT NULL REFERENCES disaster_events(id) ON DELETE CASCADE,
    municipality TEXT,
    province TEXT,
    geom GEOGRAPHY(GEOMETRY, 4326)
);

CREATE TABLE affected_schools (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    disaster_event_id UUID NOT NULL REFERENCES disaster_events(id) ON DELETE CASCADE,
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    priority TEXT NOT NULL CHECK (priority IN ('high','potential')),
    distance_km NUMERIC,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (disaster_event_id, school_id)
);

-- ─────────────────────────────── Notifications ───────────────────────────────

CREATE TABLE notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    disaster_event_id UUID REFERENCES disaster_events(id) ON DELETE SET NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    priority notif_priority NOT NULL,
    type TEXT NOT NULL, -- official_alert | app_proximity | school_alert | announcement | chat
    read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user ON notifications(user_id, read);

CREATE TABLE notification_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    earthquake BOOLEAN NOT NULL DEFAULT true,
    tsunami BOOLEAN NOT NULL DEFAULT true,
    volcano BOOLEAN NOT NULL DEFAULT true,
    rainfall BOOLEAN NOT NULL DEFAULT true,
    tropical_cyclone BOOLEAN NOT NULL DEFAULT true,
    thunderstorm BOOLEAN NOT NULL DEFAULT true,
    other_hazards BOOLEAN NOT NULL DEFAULT true,
    leyte_alerts BOOLEAN NOT NULL DEFAULT true,
    nearby_alerts BOOLEAN NOT NULL DEFAULT true,
    school_alerts BOOLEAN NOT NULL DEFAULT true,
    critical_alerts BOOLEAN NOT NULL DEFAULT true -- always true; not user-editable at API layer
);

-- ─────────────────────────────── Chat, Announcements ───────────────────────────────

CREATE TABLE chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reported BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE announcements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    author_id UUID NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    priority notif_priority NOT NULL DEFAULT 'INFORMATION',
    attachment_url TEXT,
    published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at TIMESTAMPTZ
);

-- ─────────────────────────────── Audit & Settings ───────────────────────────────

CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity TEXT NOT NULL,
    entity_id UUID,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

CREATE TABLE system_settings (
    key TEXT PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO system_settings (key, value) VALUES
    ('leyte_bounding_box', '{"min_lon": 124.0, "min_lat": 9.8, "max_lon": 125.35, "max_lat": 11.8}'),
    ('affected_school_high_priority_km', '10'),
    ('affected_school_potential_km', '30'),
    ('sync_interval_minutes', '10');

-- Future-ready tables (Phase 7) — created now so no restructuring is needed later
CREATE TABLE school_status_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
    disaster_event_id UUID REFERENCES disaster_events(id) ON DELETE SET NULL,
    reported_by UUID REFERENCES users(id),
    status TEXT NOT NULL, -- normal | monitoring | affected | critical | evacuated
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE incident_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    school_id UUID REFERENCES schools(id) ON DELETE SET NULL,
    submitted_by UUID REFERENCES users(id),
    disaster_event_id UUID REFERENCES disaster_events(id) ON DELETE SET NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'submitted', -- submitted | under_review | validated | closed
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by UUID REFERENCES users(id)
);
