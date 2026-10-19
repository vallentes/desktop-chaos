CREATE TABLE kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE profiles (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

CREATE TABLE widgets (
    id            INTEGER PRIMARY KEY,
    profile_id    INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    kind          TEXT NOT NULL,
    x             REAL NOT NULL,
    y             REAL NOT NULL,
    w             REAL NOT NULL,
    h             REAL NOT NULL,
    opacity       REAL NOT NULL DEFAULT 1,
    level         TEXT NOT NULL DEFAULT 'top',
    click_through INTEGER NOT NULL DEFAULT 0,
    visible       INTEGER NOT NULL DEFAULT 1,
    config        TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX widgets_profile ON widgets(profile_id);

INSERT INTO profiles (id, name, created_at) VALUES (1, 'Default', 0);
