//! Windows readings beyond sysinfo, all available to a normal (non-admin) user:
//!  - Performance counters (PDH): live CPU clock, GPU engine load, dedicated VRAM in use.
//!  - DXGI: GPU names and VRAM size.
//!  - D3DKMT adapter perf data: GPU temperature and fan speed, where the driver reports them
//!    (the same source Task Manager uses).
//!  - WMI: motherboard model and memory modules.
//!  - LibreHardwareMonitor / OpenHardwareMonitor, if the user runs one: CPU temperature and
//!    power, fans, voltages, disk and memory temperatures. Windows does not expose these to
//!    normal apps without a kernel driver, and Desktop Chaos never installs one.

use super::{Extra, GpuInfo, Reading};
use serde::Deserialize;
use std::collections::HashMap;
use std::time::{Duration, Instant};
use windows::core::{w, PCWSTR};
use windows::Wdk::Graphics::Direct3D::{
    D3DKMTCloseAdapter, D3DKMTOpenAdapterFromLuid, D3DKMTQueryAdapterInfo, D3DKMT_ADAPTER_PERFDATA, D3DKMT_CLOSEADAPTER, D3DKMT_OPENADAPTERFROMLUID, D3DKMT_QUERYADAPTERINFO,
    KMTQAITYPE_ADAPTERPERFDATA,
};
use windows::Win32::Foundation::LUID;
use windows::Win32::Graphics::Dxgi::{CreateDXGIFactory1, IDXGIFactory1, DXGI_ADAPTER_FLAG_SOFTWARE};
use windows::Win32::System::Performance::{
    PdhAddEnglishCounterW, PdhCollectQueryData, PdhGetFormattedCounterArrayW, PdhGetFormattedCounterValue, PdhOpenQueryW, PDH_FMT_COUNTERVALUE, PDH_FMT_COUNTERVALUE_ITEM_W,
    PDH_FMT_DOUBLE, PDH_FMT_LARGE, PDH_HCOUNTER, PDH_HQUERY, PDH_MORE_DATA,
};
use wmi::{COMLibrary, WMIConnection};

struct Adapter {
    name: String,
    vendor: String,
    luid: LUID,
    vram_total: u64,
}

pub struct Platform {
    query: Option<PDH_HQUERY>,
    c_perf: Option<PDH_HCOUNTER>,
    c_base: Option<PDH_HCOUNTER>,
    c_engine: Option<PDH_HCOUNTER>,
    c_vram: Option<PDH_HCOUNTER>,
    adapters: Vec<Adapter>,
    com: Option<COMLibrary>,
    board_name: Option<String>,
    mem_modules: Option<String>,
    mem_maker: Option<String>,
    lhm: Option<(WMIConnection, &'static str)>,
    lhm_retry: Instant,
    hardware: HashMap<String, (String, String)>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Board {
    manufacturer: Option<String>,
    product: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct Dimm {
    capacity: Option<u64>,
    speed: Option<u32>,
    configured_clock_speed: Option<u32>,
    manufacturer: Option<String>,
    #[serde(rename = "SMBIOSMemoryType")]
    smbios_memory_type: Option<u32>,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct LhmSensor {
    name: String,
    sensor_type: String,
    value: f32,
    parent: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "PascalCase")]
struct LhmHardware {
    name: String,
    hardware_type: String,
    identifier: String,
}

fn pdh_counter(q: PDH_HQUERY, path: PCWSTR) -> Option<PDH_HCOUNTER> {
    let mut c = PDH_HCOUNTER::default();
    (unsafe { PdhAddEnglishCounterW(q, path, 0, &mut c) } == 0).then_some(c)
}

fn pdh_value(c: Option<PDH_HCOUNTER>) -> Option<f64> {
    let mut v = PDH_FMT_COUNTERVALUE::default();
    (unsafe { PdhGetFormattedCounterValue(c?, PDH_FMT_DOUBLE, None, &mut v) } == 0 && v.CStatus == 0).then(|| unsafe { v.Anonymous.doubleValue })
}

/// Reads a wildcard counter as (instance name, value) pairs.
fn pdh_array(c: Option<PDH_HCOUNTER>, large: bool) -> Vec<(String, f64)> {
    let Some(c) = c else { return vec![] };
    let fmt = if large { PDH_FMT_LARGE } else { PDH_FMT_DOUBLE };
    let mut size = 0u32;
    let mut count = 0u32;
    unsafe {
        if PdhGetFormattedCounterArrayW(c, fmt, &mut size, &mut count, None) != PDH_MORE_DATA || size == 0 {
            return vec![];
        }
        let mut buf = vec![0u8; size as usize];
        let items = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
        if PdhGetFormattedCounterArrayW(c, fmt, &mut size, &mut count, Some(items)) != 0 {
            return vec![];
        }
        (0..count as usize)
            .filter_map(|i| {
                let it = &*items.add(i);
                if it.FmtValue.CStatus != 0 {
                    return None;
                }
                let name = it.szName.to_string().ok()?;
                let v = if large { it.FmtValue.Anonymous.largeValue as f64 } else { it.FmtValue.Anonymous.doubleValue };
                Some((name, v))
            })
            .collect()
    }
}

/// "luid_0x00000000_0x0000C4F2" → LUID.
fn luid_of(instance: &str) -> Option<(i32, u32)> {
    let i = instance.find("luid_0x")?;
    let rest = &instance[i + 7..];
    let high = i32::from_str_radix(rest.get(0..8)?, 16).ok()?;
    let low = u32::from_str_radix(rest.get(11..19)?, 16).ok()?;
    Some((high, low))
}

fn vendor_of(id: u32) -> &'static str {
    match id {
        0x10de => "NVIDIA",
        0x1002 | 0x1022 => "AMD",
        0x8086 => "Intel",
        0x5143 => "Qualcomm",
        _ => "",
    }
}

fn adapters() -> Vec<Adapter> {
    let mut out = vec![];
    unsafe {
        let Ok(f) = CreateDXGIFactory1::<IDXGIFactory1>() else { return out };
        let mut i = 0;
        while let Ok(a) = f.EnumAdapters1(i) {
            i += 1;
            let Ok(d) = a.GetDesc1() else { continue };
            if d.Flags & DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32 != 0 {
                continue;
            }
            let len = d.Description.iter().position(|c| *c == 0).unwrap_or(d.Description.len());
            let name = String::from_utf16_lossy(&d.Description[..len]).trim().to_string();
            // Microsoft Basic Render Driver and remote adapters have no VRAM worth showing.
            if name.contains("Basic Render") {
                continue;
            }
            out.push(Adapter { name, vendor: vendor_of(d.VendorId).into(), luid: d.AdapterLuid, vram_total: d.DedicatedVideoMemory as u64 });
        }
    }
    out
}

/// GPU temperature (°C) and fan RPM from the display driver, when it reports them.
fn kmt_perf(luid: LUID) -> Option<(Option<f32>, Option<f32>)> {
    unsafe {
        let mut open = D3DKMT_OPENADAPTERFROMLUID { AdapterLuid: luid, hAdapter: 0 };
        if D3DKMTOpenAdapterFromLuid(&mut open).is_err() {
            return None;
        }
        let mut perf = D3DKMT_ADAPTER_PERFDATA::default();
        let mut q = D3DKMT_QUERYADAPTERINFO {
            hAdapter: open.hAdapter,
            Type: KMTQAITYPE_ADAPTERPERFDATA,
            pPrivateDriverData: &mut perf as *mut _ as *mut _,
            PrivateDriverDataSize: std::mem::size_of::<D3DKMT_ADAPTER_PERFDATA>() as u32,
        };
        let ok = D3DKMTQueryAdapterInfo(&mut q).is_ok();
        let _ = D3DKMTCloseAdapter(&D3DKMT_CLOSEADAPTER { hAdapter: open.hAdapter });
        if !ok {
            return None;
        }
        // Temperature is in tenths of a degree; 0 means the driver does not report it.
        let temp = (perf.Temperature > 0 && perf.Temperature < 1500).then(|| perf.Temperature as f32 / 10.0);
        let fan = (perf.FanRPM > 0 && perf.FanRPM < 20000).then_some(perf.FanRPM as f32);
        Some((temp, fan))
    }
}

impl Platform {
    pub fn new() -> Self {
        let mut p = Platform {
            query: None,
            c_perf: None,
            c_base: None,
            c_engine: None,
            c_vram: None,
            adapters: adapters(),
            com: COMLibrary::new().ok(),
            board_name: None,
            mem_modules: None,
            mem_maker: None,
            lhm: None,
            lhm_retry: Instant::now(),
            hardware: HashMap::new(),
        };
        unsafe {
            let mut q = PDH_HQUERY::default();
            if PdhOpenQueryW(PCWSTR::null(), 0, &mut q) == 0 {
                p.c_perf = pdh_counter(q, w!("\\Processor Information(_Total)\\% Processor Performance"));
                p.c_base = pdh_counter(q, w!("\\Processor Information(_Total)\\Processor Frequency"));
                p.c_engine = pdh_counter(q, w!("\\GPU Engine(*)\\Utilization Percentage"));
                p.c_vram = pdh_counter(q, w!("\\GPU Adapter Memory(*)\\Dedicated Usage"));
                let _ = PdhCollectQueryData(q);
                p.query = Some(q);
            }
        }
        p.static_wmi();
        p
    }

    fn static_wmi(&mut self) {
        let Some(com) = self.com else { return };
        let Ok(c) = WMIConnection::new(com) else { return };
        if let Ok(b) = c.raw_query::<Board>("SELECT Manufacturer, Product FROM Win32_BaseBoard") {
            if let Some(b) = b.into_iter().next() {
                let name = [b.manufacturer.unwrap_or_default(), b.product.unwrap_or_default()].join(" ").trim().to_string();
                self.board_name = (!name.is_empty()).then_some(name);
            }
        }
        if let Ok(dimms) = c.raw_query::<Dimm>("SELECT Capacity, Speed, ConfiguredClockSpeed, Manufacturer, SMBIOSMemoryType FROM Win32_PhysicalMemory") {
            if !dimms.is_empty() {
                let kind = match dimms[0].smbios_memory_type.unwrap_or(0) {
                    20 => "DDR",
                    21 => "DDR2",
                    24 => "DDR3",
                    26 => "DDR4",
                    27 => "LPDDR",
                    28 => "LPDDR2",
                    29 => "LPDDR3",
                    30 => "LPDDR4",
                    34 => "DDR5",
                    35 => "LPDDR5",
                    _ => "",
                };
                let speed = dimms[0].configured_clock_speed.or(dimms[0].speed).filter(|s| *s > 0);
                let gb: u64 = dimms.iter().filter_map(|d| d.capacity).sum::<u64>() / (1 << 30);
                let mut parts = vec![];
                if !kind.is_empty() {
                    parts.push(kind.to_string());
                }
                if let Some(s) = speed {
                    parts.push(format!("{s} MT/s"));
                }
                let n = dimms.len();
                self.mem_modules = Some(format!("{} ({} DIMM{}, {gb} GB)", parts.join(" "), n, if n == 1 { "" } else { "s" }).trim().to_string());
                self.mem_maker = dimms.iter().filter_map(|d| d.manufacturer.clone()).map(|m| m.trim().to_string()).find(|m| !m.is_empty() && m != "Unknown");
            }
        }
    }

    /// Connects to a running LibreHardwareMonitor (or OpenHardwareMonitor) WMI provider.
    fn lhm(&mut self) -> Option<&WMIConnection> {
        if self.lhm.is_none() && Instant::now() >= self.lhm_retry {
            self.lhm_retry = Instant::now() + Duration::from_secs(20);
            let com = self.com?;
            for ns in ["root\\LibreHardwareMonitor", "root\\OpenHardwareMonitor"] {
                if let Ok(c) = WMIConnection::with_namespace_path(ns, com) {
                    if c.raw_query::<LhmHardware>("SELECT Name, HardwareType, Identifier FROM Hardware").map(|h| !h.is_empty()).unwrap_or(false) {
                        self.lhm = Some((c, if ns.contains("Libre") { "LibreHardwareMonitor" } else { "OpenHardwareMonitor" }));
                        break;
                    }
                }
            }
        }
        self.lhm.as_ref().map(|(c, _)| c)
    }

    pub fn sample(&mut self) -> Extra {
        let mut x = Extra { mem_modules: self.mem_modules.clone(), mem_maker: self.mem_maker.clone(), ..Default::default() };
        x.board.name = self.board_name.clone();
        if let Some(q) = self.query {
            unsafe {
                let _ = PdhCollectQueryData(q);
            }
            x.sources.push("Windows performance counters".into());
        }
        if let (Some(perf), Some(base)) = (pdh_value(self.c_perf), pdh_value(self.c_base)) {
            if perf > 0.0 && base > 0.0 {
                x.cpu_freq_mhz = Some((base * perf / 100.0).round() as u64);
            }
        }

        // GPU engine load: sum each engine type per adapter, then take the busiest type (like Task Manager).
        let mut per: HashMap<(i32, u32), HashMap<String, f64>> = HashMap::new();
        for (inst, v) in pdh_array(self.c_engine, false) {
            let Some(l) = luid_of(&inst) else { continue };
            let eng = inst.rsplit("engtype_").next().unwrap_or("").to_string();
            *per.entry(l).or_default().entry(eng).or_default() += v;
        }
        let mut vram: HashMap<(i32, u32), u64> = HashMap::new();
        for (inst, v) in pdh_array(self.c_vram, true) {
            if let Some(l) = luid_of(&inst) {
                *vram.entry(l).or_default() += v as u64;
            }
        }
        let mut kmt = false;
        for a in &self.adapters {
            let key = (a.luid.HighPart, a.luid.LowPart);
            let engines = per.get(&key);
            let (temp, fan) = kmt_perf(a.luid).unwrap_or((None, None));
            kmt |= temp.is_some();
            x.gpus.push(GpuInfo {
                name: a.name.clone(),
                vendor: a.vendor.clone(),
                usage: engines.map(|e| e.values().cloned().fold(0.0, f64::max).min(100.0) as f32),
                usage_3d: engines.and_then(|e| e.get("3D")).map(|v| v.min(100.0) as f32),
                video_decode: engines.and_then(|e| e.iter().filter(|(k, _)| k.starts_with("VideoDecode")).map(|(_, v)| *v).reduce(f64::max)).map(|v| v.min(100.0) as f32),
                vram_total: (a.vram_total > 0).then_some(a.vram_total),
                vram_used: vram.get(&key).copied(),
                temp_c: temp,
                fan_rpm: fan,
                ..Default::default()
            });
        }
        if kmt {
            x.sources.push("display driver (D3DKMT)".into());
        }

        self.sample_lhm(&mut x);
        if !x.sources.iter().any(|s| s.contains("HardwareMonitor")) {
            x.notes.push(
                "Windows does not give apps CPU temperature, power, fans or voltages without a kernel driver, and Desktop Chaos never installs one. \
                 Run LibreHardwareMonitor (free) and those readings appear here automatically."
                    .into(),
            );
        }
        x
    }

    fn sample_lhm(&mut self, x: &mut Extra) {
        if self.lhm().is_none() {
            return;
        }
        let Some((conn, label)) = self.lhm.as_ref() else { return };
        let sensors = match conn.raw_query::<LhmSensor>("SELECT Name, SensorType, Value, Parent FROM Sensor") {
            Ok(s) if !s.is_empty() => s,
            _ => {
                // The monitor was closed; try again later.
                self.lhm = None;
                self.hardware.clear();
                return;
            }
        };
        if self.hardware.is_empty() {
            if let Ok(hw) = conn.raw_query::<LhmHardware>("SELECT Name, HardwareType, Identifier FROM Hardware") {
                self.hardware = hw.into_iter().map(|h| (h.identifier, (h.hardware_type, h.name))).collect();
            }
        }
        x.sources.push((*label).to_string());
        let hw = &self.hardware;
        let kind_of = |parent: &str| hw.get(parent).map(|(t, n)| (t.to_lowercase(), n.clone())).unwrap_or_default();

        let mut cpu_temps: Vec<(i32, f32)> = vec![];
        let mut gpu_by_name: HashMap<String, GpuInfo> = HashMap::new();
        let mut dimm_temps: Vec<f32> = vec![];
        for s in &sensors {
            if !s.value.is_finite() {
                continue;
            }
            let (kind, hw_name) = kind_of(&s.parent);
            let n = s.name.to_lowercase();
            match (kind.as_str(), s.sensor_type.as_str()) {
                ("cpu", "Temperature") => {
                    let rank = if n.contains("tctl") || n.contains("package") || n.contains("tdie") {
                        0
                    } else if n.contains("average") {
                        1
                    } else {
                        2
                    };
                    cpu_temps.push((rank, s.value));
                }
                ("cpu", "Power") if n.contains("package") => x.cpu_power_w = Some(s.value),
                (k, t) if k.starts_with("gpu") => {
                    let g = gpu_by_name.entry(hw_name.clone()).or_default();
                    match t {
                        "Temperature" if n.contains("hot spot") => g.hotspot_c = Some(s.value),
                        "Temperature" if n == "gpu core" || g.temp_c.is_none() => g.temp_c = Some(s.value),
                        "Fan" => g.fan_rpm = Some(s.value),
                        "Control" if n.contains("fan") => g.fan_pct = Some(s.value),
                        "Power" if n.contains("package") || n.contains("total") || n == "gpu power" => g.power_w = Some(s.value),
                        "Clock" if n.contains("core") => g.clock_mhz = Some(s.value),
                        _ => {}
                    }
                }
                ("superio" | "motherboard", "Fan") if s.value > 0.0 => x.board.fans.push(Reading { label: s.name.clone(), value: s.value }),
                ("superio" | "motherboard", "Temperature") if s.value > -40.0 && s.value < 150.0 => x.board.temps.push(Reading { label: s.name.clone(), value: s.value }),
                ("superio" | "motherboard", "Voltage") => x.board.voltages.push(Reading { label: s.name.clone(), value: s.value }),
                ("storage" | "hdd", "Temperature") => x.disk_temps.push((hw_name.clone(), s.value)),
                ("memory", "Temperature") => dimm_temps.push(s.value),
                _ => {}
            }
            if kind == "superio" && x.board.chip.is_none() {
                x.board.chip = Some(hw_name);
            }
        }
        cpu_temps.sort_by(|a, b| a.0.cmp(&b.0));
        x.cpu_temp_c = cpu_temps.first().map(|t| t.1);
        x.mem_temp_c = dimm_temps.into_iter().reduce(f32::max);
        // Fill GPU temperatures/fans/power the driver did not report.
        for g in x.gpus.iter_mut() {
            if let Some((_, l)) = gpu_by_name.iter().find(|(name, _)| name.contains(&g.name) || g.name.contains(name.as_str())) {
                g.temp_c = g.temp_c.or(l.temp_c);
                g.hotspot_c = l.hotspot_c;
                g.fan_rpm = g.fan_rpm.or(l.fan_rpm);
                g.fan_pct = l.fan_pct;
                g.power_w = l.power_w;
                g.clock_mhz = l.clock_mhz;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gpu_instance_luids() {
        assert_eq!(luid_of("pid_1234_luid_0x00000000_0x0000C4F2_phys_0_eng_0_engtype_3D"), Some((0, 0xC4F2)));
        assert_eq!(luid_of("luid_0x00000001_0x0001A2B3_phys_0"), Some((1, 0x1A2B3)));
        assert_eq!(luid_of("nonsense"), None);
    }

    #[test]
    fn finds_at_least_one_adapter_or_none_without_panicking() {
        for a in adapters() {
            assert!(!a.name.is_empty());
        }
    }
}
