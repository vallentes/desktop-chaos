use rusqlite::{Connection, OptionalExtension};
use std::path::Path;
use std::sync::{Mutex, MutexGuard};

/// Ordered migrations. Never edit a shipped migration; add a new file instead.
const MIGRATIONS: &[(i64, &str)] = &[(1, include_str!("../migrations/0001_init.sql"))];

pub struct Db(Mutex<Connection>);

impl Db {
    pub fn open(path: &Path) -> rusqlite::Result<Self> {
        let mut conn = Connection::open(path)?;
        conn.query_row("PRAGMA journal_mode=WAL", [], |_| Ok(()))?;
        conn.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=NORMAL;")?;
        migrate(&mut conn)?;
        Ok(Self(Mutex::new(conn)))
    }

    pub fn open_in_memory() -> rusqlite::Result<Self> {
        let mut conn = Connection::open_in_memory()?;
        conn.execute_batch("PRAGMA foreign_keys=ON;")?;
        migrate(&mut conn)?;
        Ok(Self(Mutex::new(conn)))
    }

    pub fn conn(&self) -> MutexGuard<'_, Connection> {
        self.0.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn get(&self, key: &str) -> Option<String> {
        self.conn().query_row("SELECT value FROM kv WHERE key = ?1", [key], |r| r.get(0)).optional().ok().flatten()
    }

    pub fn set(&self, key: &str, value: &str) -> rusqlite::Result<()> {
        self.conn()
            .execute("INSERT INTO kv (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [key, value])
            .map(|_| ())
    }
}

fn migrate(conn: &mut Connection) -> rusqlite::Result<()> {
    conn.execute_batch("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")?;
    let current: i64 = conn.query_row("SELECT COALESCE(MAX(version), 0) FROM schema_version", [], |r| r.get(0))?;
    for (v, sql) in MIGRATIONS {
        if *v > current {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            tx.execute("INSERT INTO schema_version (version) VALUES (?1)", [v])?;
            tx.commit()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn migrates_and_stores_values() {
        let db = Db::open_in_memory().unwrap();
        assert_eq!(db.get("x"), None);
        db.set("x", "1").unwrap();
        db.set("x", "2").unwrap();
        assert_eq!(db.get("x").as_deref(), Some("2"));
        let profiles: i64 = db.conn().query_row("SELECT COUNT(*) FROM profiles", [], |r| r.get(0)).unwrap();
        assert_eq!(profiles, 1);
    }
}
