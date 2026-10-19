//! Real hardware readings for the widgets. Every value comes from the OS or the hardware.
//! When a value is not exposed (common for temperatures and fans on Windows without a driver),
//! it stays `None` and the widget says "unavailable". Nothing here is ever made up.

pub mod latency;
#[cfg(target_os = "macos")]
mod mac;
#[cfg(windows)]
mod win;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use sysinfo::{Disks, Networks, ProcessRefreshKind, ProcessesToUpdate, System};
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Reading {
    pub label: String,
    pub value: f32,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CpuInfo {
    pub name: String,
    pub vendor: String,
    pub usage: f32,
    pub cores: Vec<f32>,
    pub physical_cores: Option<usize>,
    pub freq_mhz: Option<u64>,
    pub temp_c: Option<f32>,
    pub power_w: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct MemInfo {
    pub total: u64,
    pub used: u64,
    pub available: u64,
    pub swap_total: u64,
    pub swap_used: u64,
    /// e.g. "DDR5 6000 MT/s (2 DIMMs)"
    pub modules: Option<String>,
    pub maker: Option<String>,
    pub temp_c: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GpuInfo {
    pub name: String,
    pub vendor: String,
    pub usage: Option<f32>,
    pub usage_3d: Option<f32>,
    pub video_decode: Option<f32>,
    pub vram_total: Option<u64>,
    pub vram_used: Option<u64>,
    pub temp_c: Option<f32>,
    pub hotspot_c: Option<f32>,
    pub fan_rpm: Option<f32>,
    pub fan_pct: Option<f32>,
    pub power_w: Option<f32>,
    pub clock_mhz: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    pub name: String,
    pub mount: String,
    pub kind: String,
    pub total: u64,
    pub available: u64,
    pub read_bps: u64,
    pub write_bps: u64,
    pub temp_c: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NetInfo {
    pub iface: Option<String>,
    pub kind: Option<String>,
    pub up_bps: u64,
    pub down_bps: u64,
    pub ips: Vec<String>,
    pub lan_ms: Option<f32>,
    pub wan_ms: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BatteryInfo {
    pub percent: f32,
    pub state: String,
    pub time_left_secs: Option<u64>,
    pub power_w: Option<f32>,
    pub health_pct: Option<f32>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BoardInfo {
    pub name: Option<String>,
    pub chip: Option<String>,
    pub fans: Vec<Reading>,
    pub temps: Vec<Reading>,
    pub voltages: Vec<Reading>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProcInfo {
    pub name: String,
    pub pid: u32,
    pub cpu: f32,
    pub mem: u64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub at: u64,
    pub host: Option<String>,
    pub os: String,
    pub uptime_secs: u64,
    pub cpu: CpuInfo,
    pub memory: MemInfo,
    pub gpus: Vec<GpuInfo>,
    pub disks: Vec<DiskInfo>,
    pub net: NetInfo,
    pub battery: Option<BatteryInfo>,
    pub board: BoardInfo,
    pub processes: Vec<ProcInfo>,
    /// Where readings came from, e.g. "sysinfo", "Windows performance counters", "LibreHardwareMonitor".
    pub sources: Vec<String>,
    /// Plain-language notes about what this machine does not expose.
    pub notes: Vec<String>,
    pub streamer_safe: bool,
}

/// Extra readings a platform backend adds on top of sysinfo.
#[derive(Debug, Default)]
pub struct Extra {
    pub cpu_freq_mhz: Option<u64>,
    pub cpu_temp_c: Option<f32>,
    pub cpu_power_w: Option<f32>,
    pub mem_modules: Option<String>,
    pub mem_maker: Option<String>,
    pub mem_temp_c: Option<f32>,
    pub gpus: Vec<GpuInfo>,
    pub board: BoardInfo,
    pub disk_temps: Vec<(String, f32)>,
    pub sources: Vec<String>,
    pub notes: Vec<String>,
}

pub struct Sensors {
    /// Widgets or the Widgets screen are watching.
    pub wanted: AtomicBool,
    pub want_processes: AtomicBool,
    pub refresh_ms: AtomicU32,
    pub streamer_safe: AtomicBool,
    pub latest: Mutex<Option<Snapshot>>,
    pub latency: Arc<latency::Latency>,
}

impl Default for Sensors {
    fn default() -> Self {
        Self {
            wanted: AtomicBool::new(false),
            want_processes: AtomicBool::new(false),
            refresh_ms: AtomicU32::new(1000),
            streamer_safe: AtomicBool::new(false),
            latest: Mutex::new(None),
            latency: Arc::new(latency::Latency::default()),
        }
    }
}

struct Sampler {
    sys: System,
    disks: Disks,
    nets: Networks,
    last: Instant,
    last_disk_list: Instant,
    #[cfg(windows)]
    platform: win::Platform,
    #[cfg(target_os = "macos")]
    platform: mac::Platform,
}

impl Sampler {
    fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu_all();
        sys.refresh_memory();
        Self {
            sys,
            disks: Disks::new_with_refreshed_list(),
            nets: Networks::new_with_refreshed_list(),
            last: Instant::now(),
            last_disk_list: Instant::now(),
            #[cfg(windows)]
            platform: win::Platform::new(),
            #[cfg(target_os = "macos")]
            platform: mac::Platform::new(),
        }
    }

    fn sample(&mut self, want_processes: bool, latency: &latency::Latency) -> Snapshot {
        let secs = self.last.elapsed().as_secs_f64().max(0.05);
        self.last = Instant::now();
        self.sys.refresh_cpu_all();
        self.sys.refresh_memory();
        if self.last_disk_list.elapsed() > Duration::from_secs(30) {
            self.disks.refresh(true);
            self.last_disk_list = Instant::now();
        } else {
            self.disks.refresh(false);
        }
        self.nets.refresh(true);
        if want_processes {
            self.sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing().with_cpu().with_memory());
        }

        #[cfg(any(windows, target_os = "macos"))]
        let extra = self.platform.sample();
        #[cfg(not(any(windows, target_os = "macos")))]
        let extra = Extra::default();

        let cpus = self.sys.cpus();
        let cpu = CpuInfo {
            name: cpus.first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
            vendor: cpus.first().map(|c| c.vendor_id().to_string()).unwrap_or_default(),
            usage: self.sys.global_cpu_usage(),
            cores: cpus.iter().map(|c| c.cpu_usage()).collect(),
            physical_cores: System::physical_core_count(),
            freq_mhz: extra.cpu_freq_mhz.or_else(|| cpus.first().map(|c| c.frequency()).filter(|f| *f > 0)),
            temp_c: extra.cpu_temp_c,
            power_w: extra.cpu_power_w,
        };

        let memory = MemInfo {
            total: self.sys.total_memory(),
            used: self.sys.used_memory(),
            available: self.sys.available_memory(),
            swap_total: self.sys.total_swap(),
            swap_used: self.sys.used_swap(),
            modules: extra.mem_modules.clone(),
            maker: extra.mem_maker.clone(),
            temp_c: extra.mem_temp_c,
        };

        let disks = self
            .disks
            .list()
            .iter()
            .filter(|d| d.total_space() > 0)
            .map(|d| {
                let u = d.usage();
                let name = d.name().to_string_lossy().to_string();
                let mount = d.mount_point().to_string_lossy().to_string();
                DiskInfo {
                    temp_c: extra.disk_temps.iter().find(|(n, _)| !name.is_empty() && n.contains(&name)).map(|(_, t)| *t),
                    name,
                    mount,
                    kind: format!("{:?}", d.kind()),
                    total: d.total_space(),
                    available: d.available_space(),
                    read_bps: (u.read_bytes as f64 / secs) as u64,
                    write_bps: (u.written_bytes as f64 / secs) as u64,
                }
            })
            .collect();

        let net = self.network(secs, latency);

        let processes = if want_processes {
            let n = cpus.len().max(1) as f32;
            let mut list: Vec<ProcInfo> = self
                .sys
                .processes()
                .values()
                .filter(|p| p.pid().as_u32() != 0)
                .map(|p| ProcInfo { name: p.name().to_string_lossy().trim_end_matches(".exe").to_string(), pid: p.pid().as_u32(), cpu: p.cpu_usage() / n, mem: p.memory() })
                .collect();
            list.sort_by(|a, b| b.cpu.partial_cmp(&a.cpu).unwrap_or(std::cmp::Ordering::Equal).then(b.mem.cmp(&a.mem)));
            list.truncate(10);
            list
        } else {
            vec![]
        };

        let mut sources = vec!["sysinfo".to_string()];
        sources.extend(extra.sources.iter().cloned());
        Snapshot {
            at: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0),
            host: System::host_name(),
            os: System::long_os_version().unwrap_or_else(|| std::env::consts::OS.to_string()),
            uptime_secs: System::uptime(),
            cpu,
            memory,
            gpus: extra.gpus,
            disks,
            net,
            battery: battery(),
            board: extra.board,
            processes,
            sources,
            notes: extra.notes,
            streamer_safe: false,
        }
    }

    fn network(&self, secs: f64, latency: &latency::Latency) -> NetInfo {
        let def = netdev::get_default_interface().ok();
        let names: Vec<String> = def.iter().flat_map(|i| [Some(i.name.clone()), i.friendly_name.clone()]).flatten().collect();
        // The default route's interface; otherwise whichever moved the most data.
        let pick = self
            .nets
            .iter()
            .find(|(n, _)| names.iter().any(|x| x == *n))
            .or_else(|| self.nets.iter().max_by_key(|(_, d)| d.received() + d.transmitted()));
        let (up, down, iface) = pick.map(|(n, d)| (d.transmitted(), d.received(), Some(n.clone()))).unwrap_or((0, 0, None));
        let ips = def
            .as_ref()
            .map(|i| i.ipv4.iter().map(|a| a.addr().to_string()).chain(i.ipv6.iter().filter(|a| !a.addr().is_loopback()).map(|a| a.addr().to_string()).take(1)).collect())
            .unwrap_or_default();
        let (lan, wan) = latency.get();
        NetInfo {
            iface: def.as_ref().and_then(|i| i.friendly_name.clone()).or(iface),
            kind: def.as_ref().map(|i| format!("{:?}", i.if_type)),
            up_bps: (up as f64 * 8.0 / secs) as u64,
            down_bps: (down as f64 * 8.0 / secs) as u64,
            ips,
            lan_ms: lan,
            wan_ms: wan,
        }
    }
}

fn battery() -> Option<BatteryInfo> {
    use starship_battery::units::{power::watt, ratio::percent, time::second};
    let manager = starship_battery::Manager::new().ok()?;
    let b = manager.batteries().ok()?.flatten().next()?;
    let state = format!("{:?}", b.state()).to_lowercase();
    let time = match b.state() {
        starship_battery::State::Discharging => b.time_to_empty(),
        starship_battery::State::Charging => b.time_to_full(),
        _ => None,
    };
    Some(BatteryInfo {
        percent: b.state_of_charge().get::<percent>(),
        state,
        time_left_secs: time.map(|t| t.get::<second>() as u64),
        power_w: Some(b.energy_rate().get::<watt>()).filter(|w| *w > 0.0),
        health_pct: Some(b.state_of_health().get::<percent>()).filter(|h| *h > 0.0 && *h <= 150.0),
    })
}

/// Hides IP addresses, the host name and process names (streamer-safe mode).
pub fn redact(mut s: Snapshot) -> Snapshot {
    s.streamer_safe = true;
    s.host = None;
    s.net.ips.clear();
    s.net.iface = s.net.iface.map(|_| "Network".to_string());
    for (i, p) in s.processes.iter_mut().enumerate() {
        p.name = format!("Process {}", i + 1);
        p.pid = 0;
    }
    s
}

/// Background sampler. Idle (no work at all) while nobody is looking at sensor data.
pub fn spawn(app: AppHandle, sensors: Arc<Sensors>) {
    latency::spawn(app.clone(), sensors.latency.clone());
    std::thread::Builder::new()
        .name("sensors".into())
        .spawn(move || {
            let mut sampler: Option<Sampler> = None;
            loop {
                if !sensors.wanted.load(Ordering::Relaxed) {
                    std::thread::sleep(Duration::from_millis(400));
                    continue;
                }
                let s = sampler.get_or_insert_with(Sampler::new);
                let snap = s.sample(sensors.want_processes.load(Ordering::Relaxed), &sensors.latency);
                let snap = if sensors.streamer_safe.load(Ordering::Relaxed) { redact(snap) } else { snap };
                *sensors.latest.lock().unwrap() = Some(snap.clone());
                let _ = app.emit("sensors://snapshot", &snap);
                std::thread::sleep(Duration::from_millis(sensors.refresh_ms.load(Ordering::Relaxed).max(250) as u64));
            }
        })
        .expect("sensor thread");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn samples_real_values() {
        let mut s = Sampler::new();
        std::thread::sleep(Duration::from_millis(300));
        let snap = s.sample(true, &latency::Latency::default());
        assert!(snap.memory.total > 0);
        assert!(snap.memory.used <= snap.memory.total);
        assert!(!snap.cpu.cores.is_empty());
        assert!(snap.cpu.usage >= 0.0 && snap.cpu.usage <= 100.0);
        assert!(snap.uptime_secs > 0);
        assert!(!snap.disks.is_empty());
        assert!(!snap.processes.is_empty());
        for g in &snap.gpus {
            if let (Some(u), Some(t)) = (g.vram_used, g.vram_total) {
                assert!(u <= t * 2, "vram used {u} vs total {t}");
            }
            if let Some(t) = g.temp_c {
                assert!((0.0..130.0).contains(&t));
            }
        }
    }

    #[test]
    fn redaction_hides_identifying_details() {
        let mut snap = Snapshot { host: Some("my-pc".into()), ..Default::default() };
        snap.net.ips = vec!["192.168.1.2".into()];
        snap.net.iface = Some("Wi-Fi at Home".into());
        snap.processes = vec![ProcInfo { name: "secret-client".into(), pid: 42, cpu: 1.0, mem: 1 }];
        let r = redact(snap);
        assert!(r.host.is_none());
        assert!(r.net.ips.is_empty());
        assert_eq!(r.net.iface.as_deref(), Some("Network"));
        assert_eq!(r.processes[0].name, "Process 1");
        assert_eq!(r.processes[0].pid, 0);
        assert!(r.streamer_safe);
    }
}

#[cfg(test)]
mod dump {
    /// `cargo test print_snapshot -- --ignored --nocapture` prints what this machine reports.
    #[test]
    #[ignore]
    fn print_snapshot() {
        let mut s = super::Sampler::new();
        std::thread::sleep(std::time::Duration::from_millis(1200));
        let snap = s.sample(true, &super::latency::Latency::default());
        println!("{}", serde_json::to_string_pretty(&snap).unwrap());
    }
}
