//! macOS readings beyond sysinfo, all without admin rights:
//!  - GPU load and memory from the IOAccelerator registry entries (`ioreg`).
//!  - Temperatures from sysinfo's components (Apple's HID thermal sensors).
//!  - Model and memory from `sysctl` / `system_profiler`, read once.
//! Fans and voltages are not exposed to normal apps on Apple Silicon.

use super::{BoardInfo, Extra, GpuInfo, Reading};
use std::process::Command;
use std::time::{Duration, Instant};
use sysinfo::Components;

pub struct Platform {
    comps: Components,
    model: Option<String>,
    memory: Option<String>,
    gpu: Vec<GpuInfo>,
    gpu_at: Instant,
}

fn run(cmd: &str, args: &[&str]) -> Option<String> {
    let out = Command::new(cmd).args(args).output().ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).to_string())
}

/// Pulls `"Key"=123` out of ioreg's PerformanceStatistics dictionary.
pub fn ioreg_number(text: &str, key: &str) -> Option<f64> {
    let pat = format!("\"{key}\"=");
    let i = text.find(&pat)?;
    let rest = &text[i + pat.len()..];
    let end = rest.find(|c: char| !(c.is_ascii_digit() || c == '.')).unwrap_or(rest.len());
    rest[..end].parse().ok()
}

fn ioreg_string(text: &str, key: &str) -> Option<String> {
    let pat = format!("\"{key}\" = \"");
    let i = text.find(&pat)?;
    let rest = &text[i + pat.len()..];
    Some(rest[..rest.find('"')?].to_string())
}

fn gpus() -> Vec<GpuInfo> {
    let Some(text) = run("/usr/sbin/ioreg", &["-r", "-d", "1", "-w", "0", "-c", "IOAccelerator"]) else { return vec![] };
    text.split("+-o ")
        .filter(|b| b.contains("PerformanceStatistics"))
        .map(|b| GpuInfo {
            name: ioreg_string(b, "model").unwrap_or_else(|| "GPU".into()),
            vendor: "Apple".into(),
            usage: ioreg_number(b, "Device Utilization %").map(|v| v as f32),
            usage_3d: ioreg_number(b, "Renderer Utilization %").map(|v| v as f32),
            vram_used: ioreg_number(b, "In use system memory").or_else(|| ioreg_number(b, "vramUsedBytes")).map(|v| v as u64),
            ..Default::default()
        })
        .collect()
}

impl Platform {
    pub fn new() -> Self {
        let model = run("/usr/sbin/sysctl", &["-n", "hw.model"]).map(|s| s.trim().to_string());
        let memory = run("/usr/sbin/system_profiler", &["SPMemoryDataType", "-json"]).and_then(|j| {
            let v: serde_json::Value = serde_json::from_str(&j).ok()?;
            let m = v.get("SPMemoryDataType")?.get(0)?;
            let kind = m.get("dimm_type").and_then(|t| t.as_str()).unwrap_or("");
            let size = m.get("SPMemoryDataType").and_then(|t| t.as_str()).unwrap_or("");
            let s = format!("{kind} {size}").trim().to_string();
            (!s.is_empty()).then_some(s)
        });
        Platform { comps: Components::new_with_refreshed_list(), model, memory, gpu: vec![], gpu_at: Instant::now() - Duration::from_secs(10) }
    }

    pub fn sample(&mut self) -> Extra {
        self.comps.refresh(false);
        if self.gpu_at.elapsed() > Duration::from_secs(2) {
            self.gpu = gpus();
            self.gpu_at = Instant::now();
        }
        let temps: Vec<Reading> = self.comps.iter().filter_map(|c| Some(Reading { label: c.label().to_string(), value: c.temperature()? })).filter(|r| r.value > 0.0 && r.value < 130.0).collect();
        let cpu = temps
            .iter()
            .filter(|r| {
                let l = r.label.to_lowercase();
                l.contains("cpu") || l.contains("tdie") || l.contains("pmu")
            })
            .map(|r| r.value)
            .reduce(f32::max);
        let gpu_temp = temps.iter().filter(|r| r.label.to_lowercase().contains("gpu")).map(|r| r.value).reduce(f32::max);
        let mut gpus = self.gpu.clone();
        if let Some(g) = gpus.first_mut() {
            g.temp_c = gpu_temp;
        }
        let mut x = Extra {
            cpu_temp_c: cpu,
            mem_modules: self.memory.clone(),
            gpus,
            board: BoardInfo { name: self.model.clone(), temps: temps.into_iter().take(8).collect(), ..Default::default() },
            sources: vec!["IOKit registry".into()],
            ..Default::default()
        };
        x.notes.push("macOS does not expose fan speeds, voltages or CPU power to normal apps on most Macs.".into());
        x
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_ioreg_numbers() {
        let s = r#""PerformanceStatistics" = {"Device Utilization %"=37,"In use system memory"=123456}"#;
        assert_eq!(ioreg_number(s, "Device Utilization %"), Some(37.0));
        assert_eq!(ioreg_number(s, "In use system memory"), Some(123456.0));
        assert_eq!(ioreg_number(s, "missing"), None);
    }
}
