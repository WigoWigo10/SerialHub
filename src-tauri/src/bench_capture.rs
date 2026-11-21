use crate::mqtt_session::Message;
use chrono::{SecondsFormat, Utc};
use parking_lot::{Condvar, Mutex};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashSet},
    fs::{self, File},
    io::{self, BufWriter, Write},
    path::{Path, PathBuf},
    sync::{mpsc, Arc},
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System};

const QUEUE_LIMIT: usize = 64;
const MAX_LINE: usize = 8192;
const MAX_PAIRS: usize = 100_000;
const SAMPLE_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    Metrics,
    Mqtt,
    Hybrid,
}

impl Mode {
    fn mqtt(self) -> bool {
        self != Self::Metrics
    }
    fn metrics(self) -> bool {
        self != Self::Mqtt
    }
}

#[derive(Clone, Serialize)]
pub struct Info {
    id: String,
    path: PathBuf,
    mode: Mode,
}

#[derive(Clone, Copy, Default, Serialize)]
struct Counts {
    serial_rx_bytes: u64,
    serial_rx_chunks: u64,
    serial_tx_bytes: u64,
    mqtt_messages: u64,
    mqtt_bytes: u64,
    serial_queue_drops: u64,
    mqtt_queue_drops: u64,
    #[serde(skip)]
    ended_at: Option<Instant>,
}

#[derive(Clone, Serialize)]
pub struct Summary {
    info: Info,
    duration_ms: u64,
    counts: Counts,
    serial_rx_bytes_per_second: f64,
    serial_tx_bytes_per_second: f64,
    mqtt_messages_per_second: f64,
    mqtt_bytes_per_second: f64,
    serial_records: u64,
    mqtt_records: u64,
    metrics_samples: u64,
    correlation: Option<CorrelationSummary>,
}

#[derive(Serialize)]
pub struct Status {
    active: Option<Info>,
    busy: bool,
    failed: bool,
    last: Option<Summary>,
}

#[derive(Default, Clone)]
pub struct Capture(Arc<Shared>);

#[derive(Default)]
struct Shared {
    state: Mutex<State>,
    changed: Condvar,
}

#[derive(Default)]
struct State {
    running: Option<Running>,
    busy: bool,
    closing: bool,
    last: Option<Summary>,
}

struct Running {
    info: Info,
    start: Instant,
    sender: mpsc::SyncSender<Record>,
    counts: Arc<Mutex<Counts>>,
    writer: JoinHandle<io::Result<Summary>>,
}

#[derive(Serialize)]
struct Stamp {
    received_at: String,
    elapsed_us: u64,
}

impl Stamp {
    fn now(start: Instant) -> Self {
        Self {
            received_at: Utc::now().to_rfc3339_opts(SecondsFormat::Micros, true),
            elapsed_us: start.elapsed().as_micros().min(u64::MAX as u128) as u64,
        }
    }
}

#[derive(Serialize)]
struct SerialRecord {
    #[serde(flatten)]
    stamp: Stamp,
    session_id: u64,
    rx_sequence: Option<u64>,
    direction: &'static str,
    bytes: Vec<u8>,
}

#[derive(Serialize)]
struct MqttRecord {
    #[serde(flatten)]
    stamp: Stamp,
    #[serde(flatten)]
    message: Message,
}

enum Record {
    Serial(SerialRecord),
    Mqtt(MqttRecord),
    Stop(Instant),
}

impl Capture {
    fn start(&self, parent: &Path, mode: Mode) -> Result<Info, String> {
        {
            let mut state = self.0.state.lock();
            if state.running.is_some() || state.busy || state.closing {
                return Err("Já existe uma captura ativa".into());
            }
            state.busy = true;
        }
        let result = Self::open(parent, mode);
        let mut state = self.0.state.lock();
        state.busy = false;
        self.0.changed.notify_all();
        let running = result?;
        let info = running.info.clone();
        state.running = Some(running);
        Ok(info)
    }

    fn open(parent: &Path, mode: Mode) -> Result<Running, String> {
        let id = uuid::Uuid::new_v4().to_string();
        let path = parent.join(format!(
            "serialhub-{}-{id}",
            Utc::now().format("%Y%m%d-%H%M%S")
        ));
        fs::create_dir(&path).map_err(|error| error.to_string())?;
        let info = Info { id, path, mode };
        let files = Files::open(&info).map_err(|error| error.to_string())?;
        let (sender, receiver) = mpsc::sync_channel(QUEUE_LIMIT);
        let counts = Arc::new(Mutex::new(Counts::default()));
        let worker_counts = counts.clone();
        let worker_info = info.clone();
        let start = Instant::now();
        let writer = thread::Builder::new()
            .name("bench-capture".into())
            .spawn(move || write_capture(worker_info, start, worker_counts, receiver, files))
            .map_err(|error| error.to_string())?;
        Ok(Running {
            info,
            start,
            sender,
            counts,
            writer,
        })
    }

    pub fn serial(&self, session_id: u64, tx: bool, data: &[u8]) {
        let state = self.0.state.lock();
        let Some(running) = &state.running else {
            return;
        };
        let mut counts = running.counts.lock();
        let bytes = if tx {
            &mut counts.serial_tx_bytes
        } else {
            &mut counts.serial_rx_bytes
        };
        *bytes += data.len() as u64;
        let rx_sequence = if tx {
            None
        } else {
            counts.serial_rx_chunks += 1;
            Some(counts.serial_rx_chunks)
        };
        if running.info.mode == Mode::Hybrid {
            let record = SerialRecord {
                stamp: Stamp::now(running.start),
                session_id,
                rx_sequence,
                direction: if tx { "tx" } else { "rx" },
                bytes: data.to_vec(),
            };
            if running.sender.try_send(Record::Serial(record)).is_err() {
                counts.serial_queue_drops += 1;
            }
        }
    }

    pub fn mqtt(&self, message: &Message) {
        let state = self.0.state.lock();
        let Some(running) = &state.running else {
            return;
        };
        let mut counts = running.counts.lock();
        counts.mqtt_messages += 1;
        counts.mqtt_bytes += message.payload_bytes.len() as u64;
        if running.info.mode.mqtt() {
            let record = MqttRecord {
                stamp: Stamp::now(running.start),
                message: message.clone(),
            };
            if running.sender.try_send(Record::Mqtt(record)).is_err() {
                counts.mqtt_queue_drops += 1;
            }
        }
    }

    pub fn stop(&self, expected: Option<&str>) -> Result<Option<Summary>, String> {
        let (running, stopped_at) = {
            let mut state = self.0.state.lock();
            if expected.is_some_and(|id| state.running.as_ref().is_none_or(|run| run.info.id != id))
            {
                return Err("A sessão de captura mudou".into());
            }
            let Some(running) = state.running.take() else {
                return Ok(None);
            };
            state.busy = true;
            // Fence producers and metric sampling before draining accepted records.
            let stopped_at = Instant::now();
            running.counts.lock().ended_at = Some(stopped_at);
            (running, stopped_at)
        };
        let Running { sender, writer, .. } = running;
        // Send the end marker after all callbacks released the capture lock.
        let _ = sender.send(Record::Stop(stopped_at));
        drop(sender);
        let summary = writer
            .join()
            .map_err(|_| "A thread de captura terminou inesperadamente".to_owned())
            .and_then(|result| result.map_err(|error| error.to_string()));
        let mut state = self.0.state.lock();
        state.busy = false;
        self.0.changed.notify_all();
        if let Ok(ref value) = summary {
            state.last = Some(value.clone());
        }
        summary.map(Some)
    }

    pub fn shutdown(&self) -> Result<Option<Summary>, String> {
        {
            let mut state = self.0.state.lock();
            state.closing = true;
            while state.busy {
                self.0.changed.wait(&mut state);
            }
        }
        self.stop(None)
    }

    fn status(&self) -> Status {
        let state = self.0.state.lock();
        Status {
            active: state.running.as_ref().map(|run| run.info.clone()),
            busy: state.busy,
            failed: state
                .running
                .as_ref()
                .is_some_and(|run| run.writer.is_finished()),
            last: state.last.clone(),
        }
    }
}

struct Files {
    metrics: Option<BufWriter<File>>,
    mqtt: Option<BufWriter<File>>,
    serial: Option<BufWriter<File>>,
}

impl Files {
    fn open(info: &Info) -> io::Result<Self> {
        let open = |name| File::create_new(info.path.join(name)).map(BufWriter::new);
        let mut metrics = info
            .mode
            .metrics()
            .then(|| open("metrics.csv"))
            .transpose()?;
        if let Some(writer) = &mut metrics {
            writeln!(writer, "received_at,elapsed_us,host_cpu_percent,host_ram_used_bytes,serialhub_cpu_percent,serialhub_ram_bytes,webview_cpu_percent,webview_ram_bytes,webview_processes,serial_rx_bytes,serial_tx_bytes,mqtt_messages,mqtt_bytes,serial_queue_drops,mqtt_queue_drops")?;
        }
        Ok(Self {
            metrics,
            mqtt: info.mode.mqtt().then(|| open("mqtt.jsonl")).transpose()?,
            serial: (info.mode == Mode::Hybrid)
                .then(|| open("serial.jsonl"))
                .transpose()?,
        })
    }
}

fn json_line(writer: &mut impl Write, value: &impl Serialize) -> io::Result<()> {
    serde_json::to_writer(&mut *writer, value)?;
    writer.write_all(b"\n")
}

fn csv_value<T: ToString>(value: Option<T>) -> String {
    value.map(|sample| sample.to_string()).unwrap_or_default()
}

fn sample_metrics(
    writer: &mut impl Write,
    system: &mut System,
    stamp: Stamp,
    counts: Counts,
    has_cpu_baseline: bool,
) -> io::Result<()> {
    system.refresh_cpu_usage();
    system.refresh_memory();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::new().with_cpu().with_memory(),
    );
    let root = Pid::from_u32(std::process::id());
    let native = system.process(root);
    let mut tree = HashSet::from([root]);
    loop {
        let previous = tree.len();
        for (id, proc) in system.processes() {
            if proc.parent().is_some_and(|parent| tree.contains(&parent)) {
                tree.insert(*id);
            }
        }
        if tree.len() == previous {
            break;
        }
    }
    let (mut web_cpu, mut web_ram, mut web_processes) = (0.0, 0, 0);
    for child in tree
        .into_iter()
        .filter(|id| *id != root)
        .filter_map(|id| system.process(id))
    {
        let name = child.name().to_string_lossy().to_ascii_lowercase();
        if name.starts_with("msedgewebview2")
            || name.starts_with("webkit")
            || name.starts_with("com.apple.webkit")
        {
            web_cpu += child.cpu_usage();
            web_ram += child.memory();
            web_processes += 1;
        }
    }
    writeln!(
        writer,
        "{},{},{},{},{},{},{},{},{},{},{},{},{},{},{}",
        stamp.received_at,
        stamp.elapsed_us,
        csv_value(has_cpu_baseline.then(|| system.global_cpu_usage())),
        system.used_memory(),
        csv_value(
            native
                .filter(|_| has_cpu_baseline)
                .map(|proc| proc.cpu_usage())
        ),
        csv_value(native.map(|proc| proc.memory())),
        csv_value((has_cpu_baseline && web_processes > 0).then_some(web_cpu)),
        csv_value((web_processes > 0).then_some(web_ram)),
        web_processes,
        counts.serial_rx_bytes,
        counts.serial_tx_bytes,
        counts.mqtt_messages,
        counts.mqtt_bytes,
        counts.serial_queue_drops,
        counts.mqtt_queue_drops
    )
}

fn write_capture(
    info: Info,
    start: Instant,
    counts: Arc<Mutex<Counts>>,
    receiver: mpsc::Receiver<Record>,
    mut files: Files,
) -> io::Result<Summary> {
    let mut correlation = (info.mode == Mode::Hybrid).then(Correlation::default);
    let mut system = System::new();
    let mut next_sample = start;
    let mut serial_records = 0;
    let mut mqtt_records = 0;
    let mut metrics_samples = 0;
    let end = loop {
        if let Some(metrics) = &mut files.metrics {
            if Instant::now() >= next_sample {
                let stamp = Stamp::now(start);
                let sample = *counts.lock();
                if sample.ended_at.is_none() {
                    sample_metrics(metrics, &mut system, stamp, sample, metrics_samples > 0)?;
                    metrics_samples += 1;
                }
                next_sample = Instant::now() + SAMPLE_INTERVAL;
            }
        }
        let timeout = if files.metrics.is_some() {
            next_sample.saturating_duration_since(Instant::now())
        } else {
            SAMPLE_INTERVAL
        };
        match receiver.recv_timeout(timeout) {
            Ok(Record::Serial(record)) => {
                json_line(files.serial.as_mut().unwrap(), &record)?;
                serial_records += 1;
                if let Some(tracker) = &mut correlation {
                    tracker.serial(&record);
                }
            }
            Ok(Record::Mqtt(record)) => {
                json_line(files.mqtt.as_mut().unwrap(), &record)?;
                mqtt_records += 1;
                if let Some(tracker) = &mut correlation {
                    tracker.mqtt(&record);
                }
            }
            Ok(Record::Stop(instant)) => break instant,
            Err(mpsc::RecvTimeoutError::Disconnected) => break Instant::now(),
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
    };
    for writer in [&mut files.serial, &mut files.mqtt, &mut files.metrics]
        .into_iter()
        .flatten()
    {
        writer.flush()?;
    }
    let correlation = correlation
        .map(|tracker| tracker.finish(&info.path))
        .transpose()?;
    let duration = end.duration_since(start);
    let seconds = duration.as_secs_f64().max(f64::EPSILON);
    let counts = *counts.lock();
    let summary = Summary {
        info,
        duration_ms: duration.as_millis() as u64,
        counts,
        serial_rx_bytes_per_second: counts.serial_rx_bytes as f64 / seconds,
        serial_tx_bytes_per_second: counts.serial_tx_bytes as f64 / seconds,
        mqtt_messages_per_second: counts.mqtt_messages as f64 / seconds,
        mqtt_bytes_per_second: counts.mqtt_bytes as f64 / seconds,
        serial_records,
        mqtt_records,
        metrics_samples,
        correlation,
    };
    let mut output = BufWriter::new(File::create_new(summary.info.path.join("summary.json"))?);
    serde_json::to_writer_pretty(&mut output, &summary)?;
    output.flush()?;
    Ok(summary)
}

#[derive(Default)]
struct Correlation {
    pairs: BTreeMap<(String, u64), Pair>,
    session: Option<u64>,
    last_rx_sequence: u64,
    serial_line: Vec<u8>,
    skipping: bool,
    summary: CorrelationSummary,
}

#[derive(Default, Serialize)]
struct Pair {
    serial_elapsed_us: Option<u64>,
    mqtt_elapsed_us: Option<u64>,
}

#[derive(Clone, Default, Serialize)]
struct CorrelationSummary {
    paired: u64,
    serial_only: u64,
    mqtt_only: u64,
    missing_in_both_inside_observed_ranges: u64,
    serial_duplicates: u64,
    mqtt_duplicates: u64,
    serial_overlong_lines: u64,
    serial_capture_gaps: u64,
    identity_limit_reached: bool,
    median_mqtt_minus_serial_us: Option<f64>,
    p95_mqtt_minus_serial_us: Option<i64>,
}

#[derive(Deserialize)]
struct Identity {
    run: String,
    seq: u64,
}

impl Correlation {
    fn observe(&mut self, data: &[u8], serial: bool, us: u64) {
        let Ok(identity) = serde_json::from_slice::<Identity>(data) else {
            return;
        };
        if identity.run.is_empty() || identity.run.len() > 128 {
            return;
        }
        let key = (identity.run, identity.seq);
        if self.pairs.len() >= MAX_PAIRS && !self.pairs.contains_key(&key) {
            self.summary.identity_limit_reached = true;
            return;
        }
        let pair = self.pairs.entry(key).or_default();
        let (first, duplicates) = if serial {
            (
                &mut pair.serial_elapsed_us,
                &mut self.summary.serial_duplicates,
            )
        } else {
            (&mut pair.mqtt_elapsed_us, &mut self.summary.mqtt_duplicates)
        };
        if first.is_some() {
            *duplicates += 1;
        } else {
            *first = Some(us);
        }
    }

    fn serial(&mut self, record: &SerialRecord) {
        let Some(sequence) = record.rx_sequence else {
            return;
        };
        if self.session != Some(record.session_id) {
            self.session = Some(record.session_id);
            self.serial_line.clear();
            self.skipping = false;
        }
        if sequence != self.last_rx_sequence + 1 {
            self.summary.serial_capture_gaps += sequence - self.last_rx_sequence - 1;
            self.serial_line.clear();
            self.skipping = true;
        }
        self.last_rx_sequence = sequence;
        for &byte in &record.bytes {
            if byte == b'\n' {
                if !self.skipping {
                    let mut line = std::mem::take(&mut self.serial_line);
                    self.observe(&line, true, record.stamp.elapsed_us);
                    line.clear();
                    self.serial_line = line;
                }
                self.skipping = false;
            } else if !self.skipping {
                if self.serial_line.len() < MAX_LINE {
                    self.serial_line.push(byte);
                } else {
                    self.serial_line.clear();
                    self.skipping = true;
                    self.summary.serial_overlong_lines += 1;
                }
            }
        }
    }

    fn mqtt(&mut self, record: &MqttRecord) {
        self.observe(
            &record.message.payload_bytes,
            false,
            record.stamp.elapsed_us,
        );
    }

    fn finish(mut self, directory: &Path) -> io::Result<CorrelationSummary> {
        let mut writer = BufWriter::new(File::create_new(directory.join("correlation.jsonl"))?);
        let mut deltas = Vec::new();
        let mut previous: Option<(&str, u64)> = None;
        for ((run, seq), pair) in &self.pairs {
            if let Some((prior_run, prior_seq)) = previous {
                if prior_run == run {
                    self.summary.missing_in_both_inside_observed_ranges = self
                        .summary
                        .missing_in_both_inside_observed_ranges
                        .saturating_add(seq - prior_seq - 1);
                }
            }
            previous = Some((run, *seq));
            let delta = match (pair.serial_elapsed_us, pair.mqtt_elapsed_us) {
                (Some(serial), Some(mqtt)) => {
                    self.summary.paired += 1;
                    let delta = mqtt as i64 - serial as i64;
                    deltas.push(delta);
                    Some(delta)
                }
                (Some(_), None) => {
                    self.summary.serial_only += 1;
                    None
                }
                (None, Some(_)) => {
                    self.summary.mqtt_only += 1;
                    None
                }
                (None, None) => unreachable!(),
            };
            json_line(
                &mut writer,
                &serde_json::json!({
                    "run": run, "seq": seq, "serial_elapsed_us": pair.serial_elapsed_us,
                    "mqtt_elapsed_us": pair.mqtt_elapsed_us, "mqtt_minus_serial_us": delta
                }),
            )?;
        }
        deltas.sort_unstable();
        let n = deltas.len();
        if n > 0 {
            self.summary.median_mqtt_minus_serial_us =
                Some((deltas[(n - 1) / 2] as f64 + deltas[n / 2] as f64) / 2.0);
            self.summary.p95_mqtt_minus_serial_us = Some(deltas[(n * 95).div_ceil(100) - 1]);
        }
        writer.flush()?;
        Ok(self.summary)
    }
}

#[tauri::command]
pub fn bench_capture_status(state: tauri::State<'_, Capture>) -> Status {
    state.status()
}

#[tauri::command]
pub async fn start_bench_capture(
    parent: PathBuf,
    mode: Mode,
    state: tauri::State<'_, Capture>,
) -> Result<Info, String> {
    let capture = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || capture.start(&parent, mode))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn stop_bench_capture(
    id: String,
    state: tauri::State<'_, Capture>,
) -> Result<Option<Summary>, String> {
    let capture = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || capture.stop(Some(&id)))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests;
