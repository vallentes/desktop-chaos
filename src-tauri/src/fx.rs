//! The effect bus. Everything that blows something up (the Arsenal, Chaos Mode, the streamer
//! API, the tray) goes through here; overlays and the OBS source listen.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use tokio::sync::broadcast;

/// Must match EFFECT_IDS in src/shared/effects.ts (a test checks this).
pub const EFFECTS: &[&str] = &[
    "hammer",
    "machinegun",
    "flamethrower",
    "water",
    "lightning",
    "meteor",
    "blackhole",
    "monster",
    "gravity",
    "glass",
    "paintball",
    "snow",
    "earthquake",
    "laser",
    "bomb",
];

pub fn is_effect(id: &str) -> bool {
    EFFECTS.contains(&id)
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FxTrigger {
    pub effect: String,
    pub monitor: Option<usize>,
    pub x: Option<f64>,
    pub y: Option<f64>,
    pub intensity: f64,
    pub duration: Option<f64>,
    pub seed: u32,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OverlayConfig {
    pub sound: bool,
    pub volume: f64,
    pub reduced_flashing: bool,
    pub quality: String,
    pub particle_budget: u32,
    pub intensity: f64,
    pub tool_options: Value,
    pub stop_shortcut: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum FxEvent {
    Trigger { seq: u64, trigger: FxTrigger },
    Clear { seq: u64, mode: String },
    Arm { seq: u64, tool: String },
    Disarm { seq: u64 },
    Countdown { seq: u64, value: i32, label: String },
    Config { seq: u64, config: OverlayConfig },
}

impl FxEvent {
    pub fn seq(&self) -> u64 {
        match self {
            FxEvent::Trigger { seq, .. }
            | FxEvent::Clear { seq, .. }
            | FxEvent::Arm { seq, .. }
            | FxEvent::Disarm { seq }
            | FxEvent::Countdown { seq, .. }
            | FxEvent::Config { seq, .. } => *seq,
        }
    }

    /// Whether an overlay window has to be on screen to show this event.
    pub fn needs_window(&self) -> bool {
        matches!(self, FxEvent::Trigger { .. } | FxEvent::Arm { .. } | FxEvent::Countdown { .. })
    }
}

pub struct Fx {
    seq: AtomicU64,
    pub bus: broadcast::Sender<FxEvent>,
    pub armed: Mutex<Option<String>>,
}

impl Default for Fx {
    fn default() -> Self {
        Self { seq: AtomicU64::new(1), bus: broadcast::channel(256).0, armed: Mutex::new(None) }
    }
}

impl Fx {
    pub fn next_seq(&self) -> u64 {
        self.seq.fetch_add(1, Ordering::Relaxed)
    }

    pub fn armed(&self) -> Option<String> {
        self.armed.lock().unwrap().clone()
    }
}

pub fn random_u32() -> u32 {
    let mut b = [0u8; 4];
    getrandom::getrandom(&mut b).unwrap_or_default();
    u32::from_le_bytes(b)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn effect_ids_match_the_frontend() {
        let ts = std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/../src/shared/effects.ts")).unwrap();
        let start = ts.find("EFFECT_IDS = [").unwrap();
        let end = start + ts[start..].find("] as const").unwrap();
        let ids: Vec<&str> = ts[start..end].split('\'').skip(1).step_by(2).collect();
        assert_eq!(ids, EFFECTS);
    }

    #[test]
    fn events_serialize_like_the_frontend_expects() {
        let ev = FxEvent::Arm { seq: 3, tool: "laser".into() };
        assert_eq!(serde_json::to_string(&ev).unwrap(), r#"{"type":"arm","seq":3,"tool":"laser"}"#);
        let t = FxTrigger { effect: "meteor".into(), monitor: None, x: Some(0.5), y: None, intensity: 1.0, duration: None, seed: 9, source: "api".into() };
        let v = serde_json::to_value(FxEvent::Trigger { seq: 1, trigger: t }).unwrap();
        assert_eq!(v["trigger"]["effect"], "meteor");
        assert!(v["trigger"]["monitor"].is_null());
    }
}
