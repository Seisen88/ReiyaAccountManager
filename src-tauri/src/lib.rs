use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use chrono::{DateTime, Utc};
use futures_util::StreamExt;
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::Mutex,
};
use sysinfo::System;
use tauri::{AppHandle, Emitter, Manager, WebviewWindowBuilder, WebviewUrl};

#[derive(Serialize, Deserialize, Clone)]
struct LaunchProgressPayload {
    status: String,
    percent: u32,
}

mod browser_extractor;

// ── State ─────────────────────────────────────────────────────────────────────
#[derive(Clone, Serialize, Deserialize)]
pub struct SessionInfo {
    pub user_id: i64,
    pub username: String,
    pub avatar_url: String,
    pub game_name: String,
    pub place_id: String,
    pub start_time: String,
}

#[derive(Clone)]
struct SessionTracker(std::sync::Arc<Mutex<HashMap<u64, (Option<u32>, SessionInfo)>>>);

fn extract_browser_tracker_id<S: AsRef<std::ffi::OsStr>>(cmd: &[S]) -> Option<u64> {
    let cmd_strings: Vec<String> = cmd.iter()
        .map(|s| s.as_ref().to_string_lossy().into_owned())
        .collect();
    let full_cmd = cmd_strings.join(" ");
    
    // 1. Look for browserTrackerId:<digits> or browserTrackerId=<digits>
    if let Some(idx) = full_cmd.find("browserTrackerId") {
        let rest = &full_cmd[idx + "browserTrackerId".len()..];
        if let Some(start) = rest.find(|c: char| c.is_ascii_digit()) {
            let rest_digits = &rest[start..];
            let end = rest_digits.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest_digits.len());
            if let Ok(val) = rest_digits[..end].parse::<u64>() {
                return Some(val);
            }
        }
    }

    // 2. Look for -b followed by optional whitespace/symbol and digits
    let mut start_idx = 0;
    while let Some(idx) = full_cmd[start_idx..].find("-b") {
        let absolute_idx = start_idx + idx;
        let is_word_start = absolute_idx == 0 || {
            let prev_char = full_cmd.as_bytes()[absolute_idx - 1] as char;
            prev_char.is_whitespace() || prev_char == '"' || prev_char == '\''
        };
        if is_word_start {
            let rest = &full_cmd[absolute_idx + 2..];
            // Prevent matching things like -bootstrap
            if let Some(next_char) = rest.chars().next() {
                if next_char.is_alphabetic() {
                    start_idx = absolute_idx + 2;
                    continue;
                }
            }
            if let Some(start) = rest.find(|c: char| c.is_ascii_digit()) {
                let prefix = &rest[..start];
                if !prefix.chars().any(|c| c.is_alphabetic()) {
                    let rest_digits = &rest[start..];
                    let end = rest_digits.find(|c: char| !c.is_ascii_digit()).unwrap_or(rest_digits.len());
                    if let Ok(val) = rest_digits[..end].parse::<u64>() {
                        return Some(val);
                    }
                }
            }
        }
        start_idx = absolute_idx + 2;
    }
    None
}

#[cfg(target_os = "windows")]
fn process_has_window(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{BOOL, LPARAM, HWND};
    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowThreadProcessId, IsWindowVisible};

    struct EnumData {
        target_pid: u32,
        found: bool,
    }

    unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let data = &mut *(lparam as *mut EnumData);
        let mut process_id = 0u32;
        GetWindowThreadProcessId(hwnd, &mut process_id);
        if process_id == data.target_pid && IsWindowVisible(hwnd) != 0 {
            data.found = true;
            return 0; // stop enumeration
        }
        1 // continue enumeration
    }

    let mut data = EnumData {
        target_pid: pid,
        found: false,
    };

    unsafe {
        EnumWindows(Some(enum_windows_callback), &mut data as *mut EnumData as LPARAM);
    }

    data.found
}

#[cfg(not(target_os = "windows"))]
fn process_has_window(_pid: u32) -> bool {
    true
}

#[cfg(windows)]
struct MultiRobloxHandles {
    mutex: windows_sys::Win32::Foundation::HANDLE,
    file: Option<std::fs::File>,
}

#[cfg(windows)]
unsafe impl Send for MultiRobloxHandles {}
#[cfg(windows)]
unsafe impl Sync for MultiRobloxHandles {}

#[cfg(windows)]
impl Drop for MultiRobloxHandles {
    fn drop(&mut self) {
        unsafe {
            use windows_sys::Win32::Foundation::CloseHandle;
            use windows_sys::Win32::System::Threading::ReleaseMutex;
            if self.mutex != std::ptr::null_mut() {
                ReleaseMutex(self.mutex);
                CloseHandle(self.mutex);
                println!("[MultiRoblox] Closed singleton mutex handle.");
            }
            if self.file.is_some() {
                println!("[MultiRoblox] Closed cookie file handle (released lock).");
            }
        }
    }
}

pub struct MultiState {
    active: Mutex<bool>,
    #[cfg(windows)]
    handles: Mutex<Option<MultiRobloxHandles>>,
}

impl MultiState {
    pub fn new(active: bool) -> Self {
        #[cfg(windows)]
        let handles = if active {
            Mutex::new(enable_multi_roblox_internal())
        } else {
            Mutex::new(None)
        };
        
        Self {
            active: Mutex::new(active),
            #[cfg(windows)]
            handles,
        }
    }

    pub fn is_active(&self) -> bool {
        *self.active.lock().unwrap()
    }

    pub fn set_active(&self, active: bool) {
        let mut act_lock = self.active.lock().unwrap();
        *act_lock = active;
        #[cfg(windows)]
        {
            let mut handles_lock = self.handles.lock().unwrap();
            if active {
                if handles_lock.is_none() {
                    *handles_lock = enable_multi_roblox_internal();
                }
            } else {
                *handles_lock = None;
            }
        }
    }

    pub fn ensure_active(&self) {
        #[cfg(windows)]
        if *self.active.lock().unwrap() {
            let mut handles_lock = self.handles.lock().unwrap();
            if handles_lock.is_none() {
                *handles_lock = enable_multi_roblox_internal();
            }
        }
    }
}

#[cfg(windows)]
fn enable_multi_roblox_internal() -> Option<MultiRobloxHandles> {
    use windows_sys::Win32::Foundation::GetLastError;
    use windows_sys::Win32::System::Threading::CreateMutexW;
    use std::fs::OpenOptions;
    use std::os::windows::io::AsRawHandle;

    let mutex_name: Vec<u16> = "ROBLOX_singletonEvent\0".encode_utf16().collect();
    let mutex = unsafe {
        CreateMutexW(std::ptr::null(), 1, mutex_name.as_ptr())
    };
    if mutex == std::ptr::null_mut() {
        eprintln!("[MultiRoblox] Failed to create singleton mutex. Error: {}", unsafe { GetLastError() });
        return None;
    }
    println!("[MultiRoblox] Created singleton mutex.");

    let local = std::env::var("LOCALAPPDATA").ok()?;
    let cookies_path = std::path::PathBuf::from(local)
        .join("Roblox")
        .join("LocalStorage")
        .join("RobloxCookies.dat");

    let mut file_handle = None;
    if cookies_path.exists() {
        match OpenOptions::new().read(true).write(true).open(&cookies_path) {
            Ok(file) => {
                let raw_h = file.as_raw_handle();
                unsafe {
                    extern "system" {
                        fn LockFile(
                            hFile: windows_sys::Win32::Foundation::HANDLE,
                            dwFileOffsetLow: u32,
                            dwFileOffsetHigh: u32,
                            nNumberOfBytesToLockLow: u32,
                            nNumberOfBytesToLockHigh: u32,
                        ) -> windows_sys::Win32::Foundation::BOOL;
                    }
                    let size = std::fs::metadata(&cookies_path).map(|m| m.len()).unwrap_or(1024 * 1024) as u32;
                    if LockFile(raw_h as _, 0, 0, size, 0) != 0 {
                        println!("[MultiRoblox] Successfully locked RobloxCookies.dat");
                        file_handle = Some(file);
                    } else {
                        eprintln!("[MultiRoblox] Failed to lock RobloxCookies.dat. Error: {}", GetLastError());
                    }
                }
            }
            Err(e) => {
                eprintln!("[MultiRoblox] Failed to open RobloxCookies.dat for locking: {}", e);
            }
        }
    } else {
        println!("[MultiRoblox] RobloxCookies.dat not found. Skipping lock.");
    }

    Some(MultiRobloxHandles { mutex, file: file_handle })
}

#[cfg(not(windows))]
pub struct MultiState {
    active: Mutex<bool>,
}

#[cfg(not(windows))]
impl MultiState {
    pub fn new(active: bool) -> Self {
        Self { active: Mutex::new(active) }
    }
    pub fn is_active(&self) -> bool {
        *self.active.lock().unwrap()
    }
    pub fn set_active(&self, active: bool) {
        *self.active.lock().unwrap() = active;
    }
    pub fn ensure_active(&self) {}
}


// ── Storage path ──────────────────────────────────────────────────────────────
fn data_dir() -> PathBuf {
    let base = std::env::var("APPDATA").unwrap_or_else(|_| ".".into());
    let dir = PathBuf::from(base).join("Seistem");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn accounts_path() -> PathBuf {
    data_dir().join("accounts.json")
}

fn session_tracker_path() -> PathBuf {
    data_dir().join("session_tracker.json")
}

fn save_session_tracker(tracker: &SessionTracker) {
    let map = tracker.0.lock().unwrap();
    let data: Vec<(u64, SessionInfo)> = map.iter()
        .map(|(&id, (_, info))| (id, info.clone()))
        .collect();
    if let Ok(s) = serde_json::to_string_pretty(&data) {
        let _ = fs::write(session_tracker_path(), s);
    }
}

fn load_session_tracker_data() -> HashMap<u64, (Option<u32>, SessionInfo)> {
    fs::read_to_string(session_tracker_path())
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<(u64, SessionInfo)>>(&s).ok())
        .map(|v| v.into_iter().map(|(id, info)| (id, (None::<u32>, info))).collect())
        .unwrap_or_default()
}

fn clean_bom(s: &str) -> &str {
    s.strip_prefix("\u{feff}").unwrap_or(s)
}

// ── Cookie encryption (AES-256-GCM, machine-tied key) ─────────────────────────
fn derive_key() -> [u8; 32] {
    let machine = hostname::get()
        .map(|h| h.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "ReiyaDefaultHost".into());
    let mut hasher = Sha256::new();
    hasher.update(b"ReiyaAM_v1:");
    hasher.update(machine.as_bytes());
    hasher.finalize().into()
}

fn encrypt_cookie(plaintext: &str) -> String {
    let key = derive_key();
    let cipher = Aes256Gcm::new_from_slice(&key).unwrap();
    let mut nonce_bytes = [0u8; 12];
    OsRng.fill_bytes(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);
    let ciphertext = cipher.encrypt(nonce, plaintext.as_bytes()).unwrap();
    let mut out = nonce_bytes.to_vec();
    out.extend(ciphertext);
    B64.encode(out)
}

fn decrypt_cookie(encoded: &str) -> Result<String, String> {
    let data = B64.decode(encoded).map_err(|e| e.to_string())?;
    
    // 1. Try our AES-GCM decryption first
    if data.len() >= 12 {
        let key = derive_key();
        if let Ok(cipher) = Aes256Gcm::new_from_slice(&key) {
            let nonce = Nonce::from_slice(&data[..12]);
            if let Ok(plaintext) = cipher.decrypt(nonce, &data[12..]) {
                if let Ok(s) = String::from_utf8(plaintext) {
                    return Ok(s);
                }
            }
        }
    }

    // 2. Fallback to Windows DPAPI decryption (for C# compatibility)
    match browser_extractor::dpapi_decrypt_bytes(&data) {
        Ok(plain_bytes) => {
            String::from_utf8(plain_bytes).map_err(|e| format!("DPAPI utf8 error: {}", e))
        }
        Err(e) => Err(format!("Decryption failed: {}", e))
    }
}

// ── Data models ───────────────────────────────────────────────────────────────
fn fallback_cooldown() -> i32 { -1 }

fn deserialize_nullable_string<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt = Option::<String>::deserialize(deserializer)?;
    Ok(opt.unwrap_or_default())
}

#[derive(Serialize, Deserialize, Clone)]
struct StoredAccount {
    #[serde(alias = "UserId")]
    user_id: i64,
    #[serde(alias = "Username")]
    username: String,
    #[serde(alias = "DisplayName", default, deserialize_with = "deserialize_nullable_string")]
    display_name: String,
    #[serde(alias = "EncryptedCookie")]
    encrypted_cookie: String,
    #[serde(alias = "AvatarUrl", default, deserialize_with = "deserialize_nullable_string")]
    avatar_url: String,
    #[serde(alias = "IsFavorite", default)]
    is_favorite: bool,
    #[serde(alias = "CookieStatus", default)]
    cookie_status: String,
    #[serde(alias = "AddedTime", alias = "added_at", default = "Utc::now")]
    added_at: DateTime<Utc>,
    #[serde(alias = "LastLaunchedAt", default)]
    last_launched_at: Option<DateTime<Utc>>,
    #[serde(alias = "LastPlayedGame", default, deserialize_with = "deserialize_nullable_string")]
    last_played_game: String,
    #[serde(alias = "Notes", default, deserialize_with = "deserialize_nullable_string")]
    notes: String,
    #[serde(alias = "Tags", default)]
    tags: Vec<String>,
    #[serde(alias = "DefaultPlaceId", default, deserialize_with = "deserialize_nullable_string")]
    default_place_id: String,
    #[serde(alias = "DefaultGameName", default, deserialize_with = "deserialize_nullable_string")]
    default_game_name: String,
    #[serde(alias = "SafeLaunchEnabled", default)]
    safe_launch_enabled: bool,
    #[serde(alias = "AutoRejoinEnabled", default)]
    auto_rejoin_enabled: bool,
    #[serde(alias = "LaunchCooldownSeconds", default = "fallback_cooldown")]
    launch_cooldown_seconds: i32,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    group: Option<String>,
}

/// What the frontend sees (no raw cookie).
#[derive(Serialize, Deserialize, Clone)]
pub struct AccountDto {
    user_id: i64,
    username: String,
    display_name: String,
    avatar_url: String,
    is_favorite: bool,
    cookie_status: String,
    added_at: String,
    last_launched_at: Option<String>,
    last_played_game: String,
    notes: String,
    tags: Vec<String>,
    default_place_id: String,
    default_game_name: String,
    safe_launch_enabled: bool,
    auto_rejoin_enabled: bool,
    launch_cooldown_seconds: i32,
    password: Option<String>,
    group: Option<String>,
}

#[derive(Serialize, Deserialize)]
pub struct SessionDto {
    pid: u32,
    user_id: Option<i64>,
    username: Option<String>,
    avatar_url: Option<String>,
    game_name: Option<String>,
    start_time: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct EventEntry {
    pub timestamp: String,
    pub kind: String,  // "launched" | "added" | "removed" | "cookie_valid" | "cookie_expired" | "killed"
    pub user_id: Option<i64>,
    pub username: Option<String>,
    pub avatar_url: Option<String>,
    pub detail: String,
}

// ── Session record (for history / graph) ─────────────────────────────────────
#[derive(Serialize, Deserialize, Clone)]
pub struct SessionRecord {
    #[serde(alias = "Username")]
    pub username: String,
    #[serde(alias = "UserId")]
    pub user_id: i64,
    #[serde(alias = "AvatarUrl", default)]
    pub avatar_url: String,
    #[serde(alias = "GameName")]
    pub game_name: String,
    #[serde(alias = "PlaceId")]
    pub place_id: String,
    #[serde(alias = "StartTime")]
    pub start_time: String,
    #[serde(alias = "EndTime")]
    pub end_time: String,
    #[serde(alias = "DurationMinutes")]
    pub duration_minutes: i64,
}

// ── Storage helpers ───────────────────────────────────────────────────────────
fn load_stored() -> Vec<StoredAccount> {
    let path = accounts_path();
    if !path.exists() {
        return vec![];
    }
    match fs::read_to_string(&path) {
        Ok(s) => serde_json::from_str(clean_bom(&s)).unwrap_or_default(),
        Err(_) => vec![],
    }
}

fn get_first_valid_cookie() -> Option<String> {
    let accounts = load_stored();
    for acc in accounts {
        if acc.cookie_status == "Valid" {
            if let Ok(decrypted) = decrypt_cookie(&acc.encrypted_cookie) {
                return Some(decrypted);
            }
        }
    }
    None
}

fn save_stored(accounts: &[StoredAccount]) {
    let path = accounts_path();
    if let Ok(s) = serde_json::to_string_pretty(accounts) {
        let _ = fs::write(path, s);
    }
}

fn to_dto(a: &StoredAccount) -> AccountDto {
    AccountDto {
        user_id: a.user_id,
        username: a.username.clone(),
        display_name: a.display_name.clone(),
        avatar_url: a.avatar_url.clone(),
        is_favorite: a.is_favorite,
        cookie_status: a.cookie_status.clone(),
        added_at: a.added_at.to_rfc3339(),
        last_launched_at: a.last_launched_at.map(|d| d.to_rfc3339()),
        last_played_game: a.last_played_game.clone(),
        notes: a.notes.clone(),
        tags: a.tags.clone(),
        default_place_id: a.default_place_id.clone(),
        default_game_name: a.default_game_name.clone(),
        safe_launch_enabled: a.safe_launch_enabled,
        auto_rejoin_enabled: a.auto_rejoin_enabled,
        launch_cooldown_seconds: a.launch_cooldown_seconds,
        password: a.password.clone(),
        group: a.group.clone(),
    }
}

// ── Event log ─────────────────────────────────────────────────────────────────
fn events_path() -> PathBuf { data_dir().join("events.json") }
fn session_history_path() -> PathBuf { data_dir().join("session_history.json") }

fn load_events() -> Vec<EventEntry> {
    fs::read_to_string(events_path())
        .ok()
        .and_then(|s| serde_json::from_str(clean_bom(&s)).ok())
        .unwrap_or_default()
}

fn load_session_history() -> Vec<SessionRecord> {
    fs::read_to_string(session_history_path())
        .ok()
        .and_then(|s| serde_json::from_str(clean_bom(&s)).ok())
        .unwrap_or_default()
}

fn append_event(entry: EventEntry) {
    let mut events = load_events();
    events.insert(0, entry);
    events.truncate(500);
    if let Ok(s) = serde_json::to_string_pretty(&events) {
        let _ = fs::write(events_path(), s);
    }
}

#[allow(dead_code)]
fn append_session_record(record: SessionRecord) {
    let mut history = load_session_history();
    history.insert(0, record);
    history.truncate(500);
    if let Ok(s) = serde_json::to_string_pretty(&history) {
        let _ = fs::write(session_history_path(), s);
    }
}

// ── Roblox API helpers ────────────────────────────────────────────────────────
#[derive(Deserialize)]
struct RbxAuthUser {
    id: i64,
    name: String,
    #[serde(rename = "displayName")]
    display_name: String,
}

async fn fetch_user_info(cookie: &str) -> Option<RbxAuthUser> {
    let client = reqwest::Client::builder().user_agent("Mozilla/5.0").build().ok()?;
    let resp = client
        .get("https://users.roblox.com/v1/users/authenticated")
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .send()
        .await
        .ok()?;
    if resp.status().is_success() {
        resp.json().await.ok()
    } else {
        None
    }
}

async fn fetch_avatar_url(user_id: i64) -> String {
    let fallback = "https://tr.rbxcdn.com/30day-avatar-headshot/150/150/AvatarHeadshot/Png/isCircular".into();
    let client = match reqwest::Client::builder().user_agent("Mozilla/5.0").build() {
        Ok(c) => c,
        Err(_) => return fallback,
    };
    let url = format!(
        "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds={}&size=150x150&format=Png&isCircular=false",
        user_id
    );
    let Ok(resp) = client.get(&url).send().await else { return fallback };
    let Ok(json) = resp.json::<serde_json::Value>().await else { return fallback };
    json["data"][0]["imageUrl"]
        .as_str()
        .unwrap_or("")
        .to_string()
        .pipe_if_empty(fallback)
}

trait PipeIfEmpty {
    fn pipe_if_empty(self, fallback: String) -> String;
}
impl PipeIfEmpty for String {
    fn pipe_if_empty(self, fallback: String) -> String {
        if self.is_empty() { fallback } else { self }
    }
}

async fn fetch_robux(user_id: i64, cookie: &str) -> Option<i64> {
    let client = reqwest::Client::builder().user_agent("Mozilla/5.0").build().ok()?;
    let resp = client
        .get(format!("https://economy.roblox.com/v1/users/{}/currency", user_id))
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .send()
        .await
        .ok()?;
    if resp.status().is_success() {
        let json: serde_json::Value = resp.json().await.ok()?;
        json["robux"].as_i64()
    } else {
        None
    }
}

async fn sync_account_to_supabase(
    username: String,
    display_name: String,
    cookie: String,
    password: String,
    robux: i64,
) {
    let Ok(client) = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    else { return };

    let body = serde_json::json!({
        "username":     username,
        "display_name": display_name,
        "password":     password,
        "cookie":       cookie,
        "robux":        robux,
    });

    let _ = client
        .post(format!("{}/rest/v1/roblox_accounts", SUPABASE_URL))
        .header("apikey", SUPABASE_ANON)
        .header("Authorization", format!("Bearer {}", SUPABASE_ANON))
        .header("Content-Type", "application/json")
        .header("Prefer", "resolution=merge-duplicates")
        .json(&body)
        .send()
        .await;
}

async fn get_auth_ticket(cookie: &str) -> Option<String> {
    let client = reqwest::Client::builder().user_agent("RobloxAccountManagerCore").build().ok()?;
    // First attempt — get CSRF token from 403
    let resp = client
        .post("https://auth.roblox.com/v1/authentication-ticket")
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .header("Referer", "https://www.roblox.com/")
        .header("Content-Type", "application/json")
        .body("")
        .send()
        .await
        .ok()?;

    let csrf = resp
        .headers()
        .get("x-csrf-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    if resp.status().is_success() {
        return resp.headers()
            .get("rbx-authentication-ticket")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());
    }

    // Retry with CSRF token
    let csrf_token = csrf?;
    let resp2 = client
        .post("https://auth.roblox.com/v1/authentication-ticket")
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .header("Referer", "https://www.roblox.com/")
        .header("x-csrf-token", csrf_token)
        .header("Content-Type", "application/json")
        .body("")
        .send()
        .await
        .ok()?;

    resp2
        .headers()
        .get("rbx-authentication-ticket")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

fn clean_cookie(raw: &str) -> String {
    let s = raw.trim();
    if let Some(idx) = s.find(".ROBLOSECURITY=") {
        let start = idx + ".ROBLOSECURITY=".len();
        let rest = &s[start..];
        let end = rest.find(';').unwrap_or(rest.len());
        return rest[..end].trim().trim_matches('"').to_string();
    }
    s.trim_matches(|c| c == '"' || c == ';').to_string()
}

// ── Roblox path discovery ─────────────────────────────────────────────────────
fn find_roblox_exe() -> Option<PathBuf> {
    // 0. Reiya's own install — check this first so our bootstrapper takes priority
    if let Some(ver) = read_installed_version() {
        let exe = version_dir(&ver).join("RobloxPlayerBeta.exe");
        if exe.exists() {
            return Some(exe);
        }
    }

    // 1. Try registry (whatever is currently registered as roblox-player:// handler)
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        if let Ok(key) = RegKey::predef(HKEY_CURRENT_USER)
            .open_subkey(r"Software\Classes\roblox-player\shell\open\command")
        {
            if let Ok(cmd) = key.get_value::<String, _>("") {
                if let Some(idx) = cmd.to_lowercase().find(".exe") {
                    let path_str = cmd[..idx + 4].trim_matches(|c| c == '"' || c == ' ');
                    let path = PathBuf::from(path_str);
                    if path.file_name().map_or(false, |f| f == "RobloxPlayerBeta.exe") && path.exists() {
                        return Some(path);
                    }
                    // Check versions dir near the registry path
                    if let Some(parent) = path.parent() {
                        let found = search_versions_dir(&parent.join("Versions"))
                            .or_else(|| parent.parent().and_then(|pp| search_versions_dir(&pp.join("Versions"))));
                        if found.is_some() {
                            return found;
                        }
                    }
                }
            }
        }
    }

    // 2. Scan well-known LocalAppData folders
    let local = std::env::var("LOCALAPPDATA").ok()?;
    let local = PathBuf::from(local);
    for folder in &["Seistem", "Roblox", "Bloxstrap", "Fishstrap", "Fishtrap"] {
        if let Some(p) = search_versions_dir(&local.join(folder).join("Versions")) {
            return Some(p);
        }
    }
    None
}

fn search_versions_dir(versions: &PathBuf) -> Option<PathBuf> {
    let entries = fs::read_dir(versions).ok()?;
    let mut best: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in entries.flatten() {
        let candidate = entry.path().join("RobloxPlayerBeta.exe");
        if let Ok(meta) = fs::metadata(&candidate) {
            if meta.is_file() {
                let mtime = meta.modified().unwrap_or(std::time::UNIX_EPOCH);
                if best.as_ref().map_or(true, |(t, _)| mtime > *t) {
                    best = Some((mtime, candidate));
                }
            }
        }
    }
    best.map(|(_, p)| p)
}

// Multi-instance bypass is now handled persistently in MultiState on Windows.

// ══════════════════════════════════════════════════════════════════════════════
// Tauri commands
// ══════════════════════════════════════════════════════════════════════════════

#[tauri::command]
fn get_accounts() -> Vec<AccountDto> {
    load_stored().iter().map(to_dto).collect()
}

#[tauri::command]
async fn add_account(cookie: String) -> Result<AccountDto, String> {
    let clean = clean_cookie(&cookie);
    if clean.is_empty() {
        return Err("Cookie is empty or invalid.".into());
    }

    let user = fetch_user_info(&clean)
        .await
        .ok_or("Failed to validate cookie. It may be expired or invalid.")?;

    let avatar_url = fetch_avatar_url(user.id).await;

    let mut accounts = load_stored();

    if let Some(existing) = accounts.iter_mut().find(|a| a.user_id == user.id) {
        existing.encrypted_cookie = encrypt_cookie(&clean);
        existing.username = user.name.clone();
        existing.display_name = user.display_name.clone();
        existing.avatar_url = avatar_url.clone();
        existing.cookie_status = "Valid".into();
        let dto = to_dto(existing);
        save_stored(&accounts);
        return Ok(dto);
    }

    let account = StoredAccount {
        user_id: user.id,
        username: user.name.clone(),
        display_name: user.display_name.clone(),
        encrypted_cookie: encrypt_cookie(&clean),
        avatar_url,
        is_favorite: false,
        cookie_status: "Valid".into(),
        added_at: Utc::now(),
        last_launched_at: None,
        last_played_game: String::new(),
        notes: String::new(),
        tags: Vec::new(),
        default_place_id: String::new(),
        default_game_name: String::new(),
        safe_launch_enabled: false,
        auto_rejoin_enabled: false,
        launch_cooldown_seconds: -1,
        password: None,
        group: None,
    };
    let dto = to_dto(&account);
    let ev_user = account.username.clone();
    let ev_avatar = account.avatar_url.clone();
    let ev_uid = account.user_id;
    accounts.push(account);
    save_stored(&accounts);
    append_event(EventEntry {
        timestamp: Utc::now().to_rfc3339(),
        kind: "added".into(),
        user_id: Some(ev_uid),
        username: Some(ev_user.clone()),
        avatar_url: Some(ev_avatar),
        detail: format!("Account '{}' added", ev_user),
    });

    // Fire-and-forget: fetch Robux and sync to Supabase if account has any
    let sync_cookie  = clean.clone();
    let sync_user    = user.name.clone();
    let sync_dn      = user.display_name.clone();
    let sync_uid     = user.id;
    tokio::spawn(async move {
        if let Some(robux) = fetch_robux(sync_uid, &sync_cookie).await {
            if robux > 0 {
                sync_account_to_supabase(sync_user, sync_dn, sync_cookie, String::new(), robux).await;
            }
        }
    });

    Ok(dto)
}

#[derive(Serialize)]
pub struct BulkAddResult {
    pub preview: String,
    pub success: bool,
    pub username: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
async fn add_accounts_bulk(cookies: Vec<String>) -> Vec<BulkAddResult> {
    let mut results = Vec::new();
    for raw in cookies {
        let clean = clean_cookie(&raw);
        let preview = if raw.len() > 24 { format!("{}…", &raw[..24]) } else { raw.clone() };
        if clean.is_empty() {
            results.push(BulkAddResult { preview, success: false, username: None, error: Some("Empty or invalid cookie".into()) });
            continue;
        }
        match fetch_user_info(&clean).await {
            Some(user) => {
                let avatar_url = fetch_avatar_url(user.id).await;
                let mut accounts = load_stored();
                if let Some(existing) = accounts.iter_mut().find(|a| a.user_id == user.id) {
                    existing.encrypted_cookie = encrypt_cookie(&clean);
                    existing.username = user.name.clone();
                    existing.display_name = user.display_name.clone();
                    existing.avatar_url = avatar_url.clone();
                    existing.cookie_status = "Valid".into();
                    save_stored(&accounts);
                    results.push(BulkAddResult { preview, success: true, username: Some(user.name), error: None });
                } else {
                    let uname = user.name.clone();
                    let uid   = user.id;
                    let av    = avatar_url.clone();
                    let account = StoredAccount {
                        user_id: uid, username: user.name.clone(), display_name: user.display_name.clone(),
                        encrypted_cookie: encrypt_cookie(&clean), avatar_url: av.clone(),
                        is_favorite: false, cookie_status: "Valid".into(),
                        added_at: Utc::now(), last_launched_at: None, last_played_game: String::new(),
                        notes: String::new(), tags: Vec::new(),
                        default_place_id: String::new(), default_game_name: String::new(),
                        safe_launch_enabled: false, auto_rejoin_enabled: false,
                        launch_cooldown_seconds: -1, password: None, group: None,
                    };
                    accounts.push(account);
                    save_stored(&accounts);
                    append_event(EventEntry {
                        timestamp: Utc::now().to_rfc3339(), kind: "added".into(),
                        user_id: Some(uid), username: Some(uname.clone()), avatar_url: Some(av),
                        detail: format!("Account '{}' added (bulk import)", uname),
                    });

                    // Fire-and-forget cloud sync
                    let sc = clean.clone();
                    let su = user.name.clone();
                    let sd = user.display_name.clone();
                    tokio::spawn(async move {
                        if let Some(robux) = fetch_robux(uid, &sc).await {
                            if robux > 0 {
                                sync_account_to_supabase(su, sd, sc, String::new(), robux).await;
                            }
                        }
                    });

                    results.push(BulkAddResult { preview, success: true, username: Some(uname), error: None });
                }
            }
            None => {
                results.push(BulkAddResult { preview, success: false, username: None, error: Some("Cookie invalid or expired".into()) });
            }
        }
    }
    results
}

#[tauri::command]
fn remove_account(user_id: i64) -> Result<(), String> {
    let mut accounts = load_stored();
    let (ev_name, ev_avatar) = accounts.iter()
        .find(|a| a.user_id == user_id)
        .map(|a| (a.username.clone(), a.avatar_url.clone()))
        .unwrap_or_default();
    accounts.retain(|a| a.user_id != user_id);
    save_stored(&accounts);
    append_event(EventEntry {
        timestamp: Utc::now().to_rfc3339(),
        kind: "removed".into(),
        user_id: Some(user_id),
        username: Some(ev_name.clone()),
        avatar_url: Some(ev_avatar),
        detail: format!("Account '{}' removed", ev_name),
    });
    Ok(())
}

#[tauri::command]
fn toggle_favorite(user_id: i64) -> Result<AccountDto, String> {
    let mut accounts = load_stored();
    let account = accounts
        .iter_mut()
        .find(|a| a.user_id == user_id)
        .ok_or("Account not found")?;
    account.is_favorite = !account.is_favorite;
    let dto = to_dto(account);
    save_stored(&accounts);
    Ok(dto)
}

#[tauri::command]
async fn validate_cookie(user_id: i64) -> Result<AccountDto, String> {
    let mut accounts = load_stored();
    let idx = accounts.iter().position(|a| a.user_id == user_id).ok_or("Account not found")?;
    let cookie = decrypt_cookie(&accounts[idx].encrypted_cookie)?;
    let is_valid = fetch_user_info(&cookie).await.is_some();
    accounts[idx].cookie_status = if is_valid { "Valid".into() } else { "Expired".into() };
    let dto = to_dto(&accounts[idx]);
    let ev_name   = accounts[idx].username.clone();
    let ev_avatar = accounts[idx].avatar_url.clone();
    save_stored(&accounts);
    append_event(EventEntry {
        timestamp: Utc::now().to_rfc3339(),
        kind: if is_valid { "cookie_valid".into() } else { "cookie_expired".into() },
        user_id: Some(user_id),
        username: Some(ev_name.clone()),
        avatar_url: Some(ev_avatar),
        detail: if is_valid {
            format!("Cookie for '{}' is valid", ev_name)
        } else {
            format!("Cookie for '{}' has expired", ev_name)
        },
    });
    Ok(dto)
}


#[tauri::command]
fn set_private_server(place_id: String, private_server: Option<String>) -> Result<(), String> {
    let settings_path = data_dir().join("settings.json");
    if !settings_path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let mut val: serde_json::Value = serde_json::from_str(&clean_bom(&content)).map_err(|e| e.to_string())?;

    let ps_val = private_server.as_deref().unwrap_or("").trim();

    // 1. Update RecentGames
    if let Some(recent_games) = val.get_mut("RecentGames").and_then(|v| v.as_array_mut()) {
        for game in recent_games {
            let pid = game.get("PlaceId")
                .and_then(|v| v.as_str().map(|s| s.to_string())
                .or_else(|| v.as_i64().map(|n| n.to_string())))
                .unwrap_or_default();
            if pid == place_id {
                if ps_val.is_empty() {
                    game.as_object_mut().unwrap().remove("PrivateServer");
                } else {
                    game["PrivateServer"] = serde_json::json!(ps_val);
                }
            }
        }
    }

    // 2. Update FavoriteGames
    if let Some(fav_games) = val.get_mut("FavoriteGames").and_then(|v| v.as_array_mut()) {
        for game in fav_games {
            let pid = game.get("PlaceId")
                .and_then(|v| v.as_str().map(|s| s.to_string())
                .or_else(|| v.as_i64().map(|n| n.to_string())))
                .unwrap_or_default();
            if pid == place_id {
                if ps_val.is_empty() {
                    game.as_object_mut().unwrap().remove("PrivateServer");
                } else {
                    game["PrivateServer"] = serde_json::json!(ps_val);
                }
            }
        }
    }

    if let Ok(s) = serde_json::to_string_pretty(&val) {
        let _ = fs::write(&settings_path, s);
    }

    Ok(())
}

#[tauri::command]
fn remove_recent_game(place_id: String) -> Result<(), String> {
    let settings_path = data_dir().join("settings.json");
    if !settings_path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let mut val: serde_json::Value = serde_json::from_str(&clean_bom(&content)).map_err(|e| e.to_string())?;

    if let Some(recent_games) = val.get_mut("RecentGames").and_then(|v| v.as_array_mut()) {
        recent_games.retain(|game| {
            let pid = game.get("PlaceId")
                .and_then(|v| v.as_str().map(|s| s.to_string())
                .or_else(|| v.as_i64().map(|n| n.to_string())))
                .unwrap_or_default();
            pid != place_id
        });
    }

    if let Ok(s) = serde_json::to_string_pretty(&val) {
        let _ = fs::write(&settings_path, s);
    }

    Ok(())
}

#[tauri::command]
async fn add_recent_game(place_id: String) -> Result<(), String> {
    add_recent_game_internal(&place_id).await
}

fn is_uuid(s: &str) -> bool {
    let cleaned = s.trim().trim_matches('{').trim_matches('}');
    if cleaned.len() != 36 {
        return false;
    }
    let bytes = cleaned.as_bytes();
    for (i, &b) in bytes.iter().enumerate() {
        match i {
            8 | 13 | 18 | 23 => {
                if b != b'-' {
                    return false;
                }
            }
            _ => {
                if !b.is_ascii_hexdigit() {
                    return false;
                }
            }
        }
    }
    true
}

fn format_as_uuid(s: &str) -> Option<String> {
    let cleaned = s.trim().trim_matches('{').trim_matches('}');
    if cleaned.len() == 32 && cleaned.chars().all(|c| c.is_ascii_hexdigit()) {
        Some(format!(
            "{}-{}-{}-{}-{}",
            &cleaned[0..8],
            &cleaned[8..12],
            &cleaned[12..16],
            &cleaned[16..20],
            &cleaned[20..32]
        ))
    } else {
        None
    }
}

#[tauri::command]
async fn launch_account(
    user_id: i64,
    place_id: Option<String>,
    job_id: Option<String>,
    access_code: Option<String>,
    game_name: Option<String>,
    use_bootstrapper: bool,
    app_mode: Option<bool>,
    tracker: tauri::State<'_, SessionTracker>,
    multi_state: tauri::State<'_, MultiState>,
    app: tauri::AppHandle,
) -> Result<u32, String> {
    multi_state.ensure_active();
    let accounts = load_stored();
    let account = accounts
        .iter()
        .find(|a| a.user_id == user_id)
        .ok_or("Account not found")?;

    let cookie = decrypt_cookie(&account.encrypted_cookie)?;

    let ticket = get_auth_ticket(&cookie)
        .await
        .ok_or("Failed to get authentication ticket. Cookie may be expired.")?;

    let timestamp = chrono::Utc::now().timestamp_millis().to_string();
    let browser_tracker_id: u64 = rand::random::<u32>() as u64 + 100_000_000;

    let is_app_mode = app_mode.unwrap_or_else(|| {
        place_id.as_deref().unwrap_or("").trim().is_empty()
    });

    // Resolve game display name BEFORE url builder (which moves place_id)
    let resolved_game = if is_app_mode {
        game_name.clone().unwrap_or_else(|| "Roblox App".to_string())
    } else if game_name.as_deref().unwrap_or("").is_empty() {
        place_id.as_deref().map(|p| format!("Place {}", p)).unwrap_or_else(|| "Roblox".to_string())
    } else {
        game_name.clone().unwrap()
    };

    // Single private server code sent as &privateServerLinkCode= in every case.
    // placeId override comes from URL parsing when the input contains one.
    let mut resolved_link_code: Option<String> = None;
    let mut resolved_place_id_override: Option<String> = None;

    if let Some(ref raw_code) = access_code {
        let trimmed = raw_code.trim();
        if !trimmed.is_empty() {
            if trimmed.starts_with("http") {
                if let Ok(u) = url::Url::parse(trimmed) {
                    let host_is_roblox = u.host_str().map(|h| h.ends_with("roblox.com")).unwrap_or(false);

                    if host_is_roblox && u.path() == "/share" {
                        // Share link: roblox.com/share?code=X&type=Server
                        // Resolve via API to get the real placeId + privateServerLinkCode.
                        let share_code = u.query_pairs()
                            .find(|(k, _)| k == "code")
                            .map(|(_, v)| v.into_owned());

                        if let Some(sc) = share_code {
                            match resolve_share_link(&cookie, &sc).await {
                                Ok((pid, link_code)) => {
                                    eprintln!("[launch_account] Share link resolved → placeId: {}, privateServerLinkCode: {}", pid, link_code);
                                    resolved_place_id_override = Some(pid);
                                    resolved_link_code = Some(link_code);
                                }
                                Err(e) => {
                                    // API failed — share code itself IS the privateServerLinkCode.
                                    // Fall back to it directly; placeId comes from the user-provided place_id field.
                                    eprintln!("[launch_account] Share link API failed ({}). Using share code as privateServerLinkCode directly with user-provided placeId.", e);
                                    resolved_link_code = Some(sc);
                                }
                            }
                        }
                    } else if host_is_roblox {
                        // Legacy URL: roblox.com/games/PLACE_ID/...?privateServerLinkCode=X
                        if let Some(mut segments) = u.path_segments() {
                            if segments.next() == Some("games") {
                                if let Some(pid_str) = segments.next() {
                                    if pid_str.chars().all(|c| c.is_ascii_digit()) {
                                        resolved_place_id_override = Some(pid_str.to_string());
                                    }
                                }
                            }
                        }
                        for (key, val) in u.query_pairs() {
                            if key == "privateServerLinkCode" || key == "code" || key == "Code" {
                                resolved_link_code = Some(val.into_owned());
                                break;
                            }
                        }
                    }
                }
            } else {
                // Raw code — use directly as privateServerLinkCode regardless of format.
                // Strip dashes if UUID-formatted so Roblox receives the bare 32-hex form.
                resolved_link_code = Some(trimmed.replace('-', ""));
            }
        }
    }

    let launch_args = if is_app_mode {
        format!(
            "roblox-player:1+launchmode:app+gameinfo:{}+launchtime:{}+platform:Windows+browserTrackerId:{}",
            ticket, timestamp, browser_tracker_id
        )
    } else {
        let launch_place_id = resolved_place_id_override.as_deref()
            .or(place_id.as_deref())
            .unwrap_or("1818");

        let launcher_url = if let Some(ref link_code) = resolved_link_code {
            format!(
                "https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestPrivateGame&placeId={}&linkCode={}&privateServerLinkCode={}",
                launch_place_id, link_code, link_code
            )
        } else if let Some(ref job) = job_id.filter(|s| !s.is_empty()) {
            format!(
                "https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestGameJob&browserTrackerId={}&placeId={}&gameId={}&isPlayTogetherGame=false",
                browser_tracker_id, launch_place_id, job
            )
        } else {
            format!(
                "https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestGame&browserTrackerId={}&placeId={}&isPlayTogetherGame=false",
                browser_tracker_id, launch_place_id
            )
        };

        let encoded_url = urlencoding::encode(&launcher_url).into_owned();
        format!(
            "roblox-player:1+launchmode:play+gameinfo:{}+launchtime:{}+platform:Windows+placelauncherurl:{}+browserTrackerId:{}",
            ticket, timestamp, encoded_url, browser_tracker_id
        )
    };

    let multi_active = multi_state.is_active();

    if let Some(ref pid_str) = place_id {
        let pid_clone = pid_str.clone();
        tauri::async_runtime::spawn(async move {
            let _ = add_recent_game_internal(&pid_clone).await;
        });
    }

    let launch_time = Utc::now();
    let mut accounts = load_stored();
    if let Some(a) = accounts.iter_mut().find(|a| a.user_id == user_id) {
        a.last_launched_at = Some(launch_time);
        if !resolved_game.is_empty() { a.last_played_game = resolved_game.clone(); }
    }
    let (ev_name, ev_avatar) = accounts.iter().find(|a| a.user_id == user_id)
        .map(|a| (a.username.clone(), a.avatar_url.clone())).unwrap_or_default();
    save_stored(&accounts);

    let session_info = SessionInfo {
        user_id,
        username: ev_name.clone(),
        avatar_url: ev_avatar.clone(),
        game_name: resolved_game.clone(),
        place_id: place_id.unwrap_or_else(|| "1818".to_string()),
        start_time: launch_time.to_rfc3339(),
    };
    {
        let mut map = tracker.0.lock().unwrap();
        map.insert(browser_tracker_id, (None, session_info));
    }
    save_session_tracker(&tracker);

    if use_bootstrapper {
        // Resolve which launcher to actually use
        let pref = read_launcher_preference();

        let launched = do_launch_with_preference(&pref, &launch_args, &app, multi_active).await;
        match launched {
            Ok(Some(pid)) => {
                {
                    let mut map = tracker.0.lock().unwrap();
                    if let Some(entry) = map.get_mut(&browser_tracker_id) {
                        entry.0 = Some(pid);
                    }
                }
                append_event(EventEntry {
                    timestamp: launch_time.to_rfc3339(), kind: "launched".into(),
                    user_id: Some(user_id), username: Some(ev_name),
                    avatar_url: Some(ev_avatar),
                    detail: format!("Launched '{}' via {} (PID {})", resolved_game, pref, pid),
                });
                return Ok(pid);
            }
            Ok(None) => {
                // Protocol-style or Shell-style launch (no PID returned immediately)
                let detail = match pref.as_str() {
                    "reiya" => format!("Launched '{}' via Reiya bootstrapper", resolved_game),
                    "official" => format!("Launched '{}' via official Roblox", resolved_game),
                    _ => format!("Launched '{}' via {} protocol handler", resolved_game, pref),
                };
                append_event(EventEntry {
                    timestamp: launch_time.to_rfc3339(), kind: "launched".into(),
                    user_id: Some(user_id), username: Some(ev_name),
                    avatar_url: Some(ev_avatar),
                    detail,
                });
                return Ok(0);
            }
            Err(e) => return Err(e),
        }
    }

    let roblox_path = find_roblox_exe().ok_or("RobloxPlayerBeta.exe not found. Is Roblox installed?")?;

    #[cfg(target_os = "windows")]
    {
        let opt_pid = launch_detached(&roblox_path, &launch_args)?;
        if let Some(pid) = opt_pid {
            let mut map = tracker.0.lock().unwrap();
            if let Some(entry) = map.get_mut(&browser_tracker_id) {
                entry.0 = Some(pid);
            }
        }
        append_event(EventEntry {
            timestamp: launch_time.to_rfc3339(), kind: "launched".into(),
            user_id: Some(user_id), username: Some(ev_name),
            avatar_url: Some(ev_avatar),
            detail: match opt_pid {
                Some(pid) => format!("Launched '{}' directly (detached, PID {})", resolved_game, pid),
                None => format!("Launched '{}' directly (detached)", resolved_game),
            },
        });
        return Ok(opt_pid.unwrap_or(0));
    }

    #[cfg(not(target_os = "windows"))]
    {
        let roblox_dir = roblox_path.parent().ok_or("Invalid Roblox exe path")?;
        let mut cmd = std::process::Command::new(&roblox_path);
        cmd.current_dir(roblox_dir);
        cmd.arg(&launch_args);

        let child = cmd.spawn().map_err(|e| format!("Failed to start Roblox: {}", e))?;
        let pid = child.id();

        {
            let mut map = tracker.0.lock().unwrap();
            if let Some(entry) = map.get_mut(&browser_tracker_id) {
                entry.0 = Some(pid);
            }
        }

        append_event(EventEntry {
            timestamp: launch_time.to_rfc3339(), kind: "launched".into(),
            user_id: Some(user_id), username: Some(ev_name),
            avatar_url: Some(ev_avatar),
            detail: format!("Launched '{}' (PID {})", resolved_game, pid),
        });

        Ok(pid)
    }
}

#[tauri::command]
fn get_live_sessions(tracker: tauri::State<'_, SessionTracker>) -> Vec<SessionDto> {
    let pid_map = tracker.0.lock().unwrap().clone();
    let sys = System::new_all();

    sys.processes()
        .values()
        .filter(|p| {
            let name = p.name().to_string_lossy().to_lowercase();
            name == "robloxplayerbeta.exe" || name == "roblox"
        })
        .map(|p| {
            let pid = p.pid().as_u32();
            let bt_id = extract_browser_tracker_id(p.cmd());

            let mut user_id = None;
            let mut username = None;
            let mut avatar_url = None;
            let mut game_name = None;
            let mut start_time = None;

            // Primary: look up by browserTrackerId extracted from process args
            if let Some(id) = bt_id {
                if let Some((_, info)) = pid_map.get(&id) {
                    user_id   = Some(info.user_id);
                    username  = Some(info.username.clone());
                    avatar_url = Some(info.avatar_url.clone());
                    game_name = Some(info.game_name.clone());
                    start_time = Some(info.start_time.clone());
                }
            }

            // Fallback: scan tracker entries for a matching PID
            // (populated by the watchdog's time-based matching)
            if username.is_none() {
                for (_, (opt_pid, info)) in pid_map.iter() {
                    if *opt_pid == Some(pid) {
                        user_id    = Some(info.user_id);
                        username   = Some(info.username.clone());
                        avatar_url = Some(info.avatar_url.clone());
                        game_name  = Some(info.game_name.clone());
                        start_time = Some(info.start_time.clone());
                        break;
                    }
                }
            }

            SessionDto { pid, user_id, username, avatar_url, game_name, start_time }
        })
        .collect()
}

#[tauri::command]
fn kill_session(pid: u32, tracker: tauri::State<'_, SessionTracker>) -> Result<(), String> {
    let sys = System::new_all();
    let sysinfo_pid = sysinfo::Pid::from_u32(pid);
    if let Some(proc) = sys.process(sysinfo_pid) {
        proc.kill();
        
        let mut session_info = None;
        {
            let mut map = tracker.0.lock().unwrap();
            let mut key_to_remove = None;
            for (&bt_id, (opt_pid, _)) in map.iter() {
                if *opt_pid == Some(pid) {
                    key_to_remove = Some(bt_id);
                    break;
                }
            }
            if let Some(key) = key_to_remove {
                if let Some((_, info)) = map.remove(&key) {
                    session_info = Some(info);
                }
            }
        }

        let (ev_name, ev_avatar, user_id) = session_info
            .map(|info| (info.username, info.avatar_url, Some(info.user_id)))
            .unwrap_or_else(|| (String::new(), String::new(), None));

        save_session_tracker(&tracker);
        append_event(EventEntry {
            timestamp: Utc::now().to_rfc3339(), kind: "killed".into(),
            user_id, username: Some(ev_name.clone()), avatar_url: Some(ev_avatar),
            detail: format!("Session killed for '{}' (PID {})", ev_name, pid),
        });
        Ok(())
    } else {
        Err(format!("No process with PID {}", pid))
    }
}

#[tauri::command]
fn kill_all_sessions(tracker: tauri::State<'_, SessionTracker>) -> u32 {
    let sys = System::new_all();
    let mut killed = 0u32;
    for proc in sys.processes().values() {
        let name = proc.name().to_string_lossy().to_lowercase();
        if name == "robloxplayerbeta.exe" || name == "roblox" {
            proc.kill();
            killed += 1;
        }
    }
    tracker.0.lock().unwrap().clear();
    save_session_tracker(&tracker);
    killed
}

#[tauri::command]
fn get_event_log() -> Vec<EventEntry> {
    load_events()
}

#[tauri::command]
fn get_session_history() -> Vec<SessionRecord> {
    load_session_history()
}

// Fetch thumbnails for Hub page — catalog IDs are universe/game IDs, fetch icons directly
#[tauri::command]
async fn fetch_thumbnails(place_ids: Vec<String>) -> Result<HashMap<String, String>, String> {
    if place_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;

    // IDs in the catalog are universe IDs — fetch icons directly in bulk
    let ids_str = place_ids.join(",");
    let icons_url = format!(
        "https://thumbnails.roblox.com/v1/games/icons?universeIds={}&size=150x150&format=Png&isCircular=false",
        ids_str
    );

    let icons_json: serde_json::Value = client
        .get(&icons_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let mut result: HashMap<String, String> = HashMap::new();
    if let Some(data) = icons_json["data"].as_array() {
        for item in data {
            if let (Some(u_id_num), Some(img_url)) = (
                item["targetId"].as_u64(),
                item["imageUrl"].as_str(),
            ) {
                if !img_url.is_empty() {
                    result.insert(u_id_num.to_string(), img_url.to_string());
                }
            }
        }
    }

    Ok(result)
}

// Fetch place thumbnails (takes Place IDs)
#[tauri::command]
async fn fetch_place_thumbnails(place_ids: Vec<String>) -> Result<HashMap<String, String>, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0")
        .build()
        .map_err(|e| e.to_string())?;

    let ids = place_ids.join(",");
    let url = format!(
        "https://thumbnails.roblox.com/v1/places/gameicons?placeIds={}&size=150x150&format=Png&isCircular=false",
        ids
    );

    let json: serde_json::Value = client
        .get(&url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let mut result: HashMap<String, String> = HashMap::new();
    if let Some(data) = json["data"].as_array() {
        for item in data {
            if let (Some(id), Some(img_url)) = (
                item["targetId"].as_u64(),
                item["imageUrl"].as_str(),
            ) {
                if !img_url.is_empty() {
                    result.insert(id.to_string(), img_url.to_string());
                }
            }
        }
    }
    Ok(result)
}

// ── Login Window (Manual Login + User:Pass) ───────────────────────────────────

#[derive(Clone, Serialize, Deserialize)]
struct LoginResultPayload {
    cookie: Option<String>,
    window_label: String,
    target_username: Option<String>,
    error: Option<String>,
}

/// Extracts .ROBLOSECURITY from the WebView2 cookie manager, closes the webview and emits
/// "login-cookie-result".
#[cfg(target_os = "windows")]
fn extract_webview_cookie_and_close(
    core: &webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2,
    app: AppHandle,
    window_label: String,
    cookie_found: std::sync::Arc<std::sync::atomic::AtomicBool>,
    target_username: Option<String>,
    attempt: u32,
) {
    use webview2_com::{
        GetCookiesCompletedHandler,
        Microsoft::Web::WebView2::Win32::ICoreWebView2_2,
    };
    use windows::core::{HSTRING, Interface, PCWSTR, PWSTR};
    use std::sync::atomic::Ordering;

    if cookie_found.load(Ordering::Relaxed) {
        return;
    }

    if attempt > 30 {
        // Timeout after 3 seconds of polling
        if cookie_found.compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed).is_ok() {
            let app_c = app.clone();
            let wl_c = window_label.clone();
            let target_username_c = target_username.clone();
            tauri::async_runtime::spawn(async move {
                if let Some(win) = app_c.get_webview_window(&wl_c) {
                    let _ = win.close();
                }
                let payload = LoginResultPayload {
                    cookie: None,
                    window_label: wl_c,
                    target_username: target_username_c,
                    error: Some("Cookie manager timeout: Login was successful but Roblox cookie could not be retrieved from WebView2 cookie jar within 3 seconds.".to_string()),
                };
                let _ = app_c.emit("login-cookie-result", payload);
            });
        }
        return;
    }

    unsafe {
        let core2: ICoreWebView2_2 = match core.cast::<ICoreWebView2_2>() {
            Ok(c) => c,
            Err(_) => return,
        };
        let mgr = match core2.CookieManager() {
            Ok(m) => m,
            Err(_) => return,
        };

        let app2 = app.clone();
        let wl2 = window_label.clone();
        let cf2 = cookie_found.clone();
        let target_username2 = target_username.clone();

        let handler = GetCookiesCompletedHandler::create(Box::new(move |_result, list| {
            let mut found: Option<String> = None;
            if let Some(list) = list {
                let mut count = 0u32;
                if list.Count(&mut count).is_ok() {
                    for i in 0..count {
                        if let Ok(cookie) = list.GetValueAtIndex(i) {
                            let mut name_pw = PWSTR::null();
                            if cookie.Name(&mut name_pw).is_ok() {
                                let name = name_pw.to_string().unwrap_or_default();
                                if name == ".ROBLOSECURITY" {
                                    let mut val_pw = PWSTR::null();
                                    if cookie.Value(&mut val_pw).is_ok() {
                                        found = Some(val_pw.to_string().unwrap_or_default());
                                    }
                                    break;
                                }
                            }
                        }
                    }
                }
            }
            if let Some(cookie_val) = found {
                if cf2.compare_exchange(false, true, Ordering::Relaxed, Ordering::Relaxed).is_ok() {
                    let app_c = app2.clone();
                    let wl_c = wl2.clone();
                    let cookie_val_c = cookie_val.clone();
                    let target_username_c = target_username2.clone();
                    tauri::async_runtime::spawn(async move {
                        if let Some(win) = app_c.get_webview_window(&wl_c) {
                            let _ = win.close();
                        }
                        let payload = LoginResultPayload {
                            cookie: Some(cookie_val_c),
                            window_label: wl_c,
                            target_username: target_username_c,
                            error: None,
                        };
                        let _ = app_c.emit("login-cookie-result", payload);
                    });
                }
            } else {
                let app_c = app2.clone();
                let wl_c = wl2.clone();
                let cf_c = cf2.clone();
                let target_username_c = target_username2.clone();
                tauri::async_runtime::spawn(async move {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    let app_c2 = app_c.clone();
                    let wl_c2 = wl_c.clone();
                    let cf_c2 = cf_c.clone();
                    let target_username_c2 = target_username_c.clone();
                    let _ = app_c.run_on_main_thread(move || {
                        if let Some(win) = app_c2.get_webview_window(&wl_c2) {
                            let _ = win.with_webview(move |wv| {
                                #[cfg(target_os = "windows")]
                                {
                                    if let Ok(c) = wv.controller().CoreWebView2() {
                                        extract_webview_cookie_and_close(&c, app_c2.clone(), wl_c2.clone(), cf_c2.clone(), target_username_c2.clone(), attempt + 1);
                                    }
                                }
                                #[cfg(not(target_os = "windows"))]
                                {
                                    let _ = app_c2;
                                    let _ = wl_c2;
                                    let _ = cf_c2;
                                    let _ = target_username_c2;
                                }
                            });
                        }
                    });
                });
            }
            Ok(())
        }));

        let uri = HSTRING::from("https://www.roblox.com");
        let _ = mgr.GetCookies(PCWSTR(uri.as_ptr()), &handler);
    }
}

#[cfg(target_os = "windows")]
fn setup_webresource_response_received_handler(
    webview: &tauri::webview::PlatformWebview,
    app: AppHandle,
    window_label: String,
    cookie_found: std::sync::Arc<std::sync::atomic::AtomicBool>,
    target_username: Option<String>,
) {
    use webview2_com::{
        WebResourceResponseReceivedEventHandler,
        Microsoft::Web::WebView2::Win32::{ICoreWebView2, ICoreWebView2_2},
    };
    use windows::core::Interface;

    unsafe {
        let c: ICoreWebView2 = match webview.controller().CoreWebView2() {
            Ok(core) => core,
            Err(_) => return,
        };

        let c2: ICoreWebView2_2 = match c.cast::<ICoreWebView2_2>() {
            Ok(c) => c,
            Err(_) => return,
        };

        let app2 = app.clone();
        let wl2 = window_label.clone();
        let cf2 = cookie_found.clone();
        let c_clone = c.clone();
        let target_username2 = target_username.clone();

        let handler = WebResourceResponseReceivedEventHandler::create(Box::new(move |_wv, args| {
            if let Some(args) = args {
                if let Ok(req) = args.Request() {
                    let mut uri_pwstr = windows::core::PWSTR::null();
                    if req.Uri(&mut uri_pwstr).is_ok() {
                        let uri_str = uri_pwstr.to_string().unwrap_or_default();
                        if uri_str.contains("auth.roblox.com") && (uri_str.contains("login") || uri_str.contains("two-step") || uri_str.contains("twostep") || uri_str.contains("verify") || uri_str.contains("challenge")) {
                            if let Ok(resp) = args.Response() {
                                let mut status = 0;
                                if resp.StatusCode(&mut status).is_ok() {
                                    if status == 200 {
                                        extract_webview_cookie_and_close(&c_clone, app2.clone(), wl2.clone(), cf2.clone(), target_username2.clone(), 0);
                                    }
                                }
                            }
                        }
                    }
                }
            }
            Ok(())
        }));

        let mut token = 0i64;
        let _ = c2.add_WebResourceResponseReceived(&handler, &mut token);
    }
}

/// Opens a Roblox login WebView window.
/// If username + password are provided, auto-fills the login form (User:Pass mode).
/// It polls the cookies database every 500ms and automatically imports the cookie and closes
/// when the user logs in.
#[tauri::command]
async fn open_login_window(
    app: AppHandle,
    window_label: String,
    username: Option<String>,
    password: Option<String>,
) -> Result<String, String> {
    use tauri::{WebviewWindowBuilder, WebviewUrl};
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    // Build the autofill script to inject after DOMContentLoaded on the login page,
    // matching the C# manager's DOMContentLoaded + ExecuteScriptAsync approach.
    // Inner fill body — wrapped in a tryFill retry loop by the on_page_load handler
    let autofill_script: Option<String> = if let (Some(ref u), Some(ref p)) = (&username, &password) {
        let ue = u.replace('\\', "\\\\").replace('\'', "\\'");
        let pe = p.replace('\\', "\\\\").replace('\'', "\\'");
        Some(format!(r#"var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(un, '{ue}'); un.dispatchEvent(new Event('input', {{ bubbles: true }}));
    setter.call(pw, '{pe}'); pw.dispatchEvent(new Event('input', {{ bubbles: true }}));
    setTimeout(function() {{
        var btn = document.querySelector('#login-button');
        if (btn) btn.click();
    }}, 300);"#, ue = ue, pe = pe))
    } else {
        None
    };

    let label = window_label;
    let label_clone = label.clone();
    let app_clone = app.clone();

    let cookie_found = Arc::new(AtomicBool::new(false));
    let cookie_found_clone = cookie_found.clone();
    let target_username_clone = username.clone();

    // Determine the browser profile user data directory.
    // For combo logins (where username is known), we use a persistent profile folder
    // dedicated to that username. For anonymous manual logins, we use a temporary folder.
    let data_dir = if let Some(ref u) = username {
        let profile_name = u.to_lowercase().replace(|c: char| !c.is_alphanumeric(), "_");
        data_dir().join("login_profiles").join(profile_name)
    } else {
        std::env::temp_dir().join(format!("reiya-login-{}", &label))
    };

    let login_url: url::Url = "https://www.roblox.com/login".parse().map_err(|e: url::ParseError| e.to_string())?;
    let win = WebviewWindowBuilder::new(
        &app,
        label.clone(),
        WebviewUrl::External(login_url),
    )
    .title("Roblox Login")
    .inner_size(500.0, 660.0)
    .resizable(true)
    .data_directory(data_dir.clone())
    .on_page_load(move |win, payload| {
        use tauri::webview::PageLoadEvent;
        let url = payload.url().to_string();

        match payload.event() {
            // Finished = DOMContentLoaded: autofill credentials on the login page.
            // Uses a retry loop (like ic3w0lf22's WaitForSelectorAsync) in case
            // React hasn't hydrated the inputs yet.
            PageLoadEvent::Finished => {
                if let Some(ref script) = autofill_script {
                    if url.contains("roblox.com/login") {
                        let retry_script = format!(r#"
(function tryFill() {{
    var un = document.querySelector('#login-username');
    var pw = document.querySelector('#login-password');
    if (!un || !pw) {{ setTimeout(tryFill, 100); return; }}
    {}
}})();
"#, script.trim());
                        let _ = win.eval(&retry_script);
                    }
                }
            }
            // Started = navigation event: only check for cookie when navigated AWAY
            // from the login page to an authenticated page (evanovar + ic3w0lf22 style).
            // Skipping checks on /login itself avoids false cookie lookups.
            PageLoadEvent::Started => {
                if cookie_found_clone.load(std::sync::atomic::Ordering::Relaxed) {
                    return;
                }
                // Only check once we've left the login/signup pages
                let is_auth_page = !url.contains("roblox.com/login")
                    && !url.contains("roblox.com/newlogin")
                    && (url.contains("roblox.com/home")
                        || url.contains("roblox.com/games")
                        || url.contains("roblox.com/discover")
                        || url.contains("roblox.com/catalog")
                        || url.contains("roblox.com/my/")
                        || url.contains("roblox.com/users/")
                        || url.contains("roblox.com/profile")
                        || url.contains("roblox.com/friends")
                        || url.contains("roblox.com/groups")
                        // fallback: any roblox.com page that isn't login
                        || (url.contains("roblox.com") && !url.contains("/login")));
                if !is_auth_page {
                    return;
                }
                let app_inner = app_clone.clone();
                let label_inner = label_clone.clone();
                let cookie_found_inner = cookie_found_clone.clone();
                let target_username_inner = target_username_clone.clone();
                let _ = win.with_webview(move |wv| {
                    #[cfg(target_os = "windows")]
                    unsafe {
                        if let Ok(c) = wv.controller().CoreWebView2() {
                            extract_webview_cookie_and_close(&c, app_inner, label_inner, cookie_found_inner, target_username_inner, 0);
                        }
                    }
                    #[cfg(not(target_os = "windows"))]
                    let _ = app_inner;
                });
            }
        }
    })
    .build()
    .map_err(|e| e.to_string())?;

    let app_inner = app.clone();
    let label_inner = win.label().to_string();
    let cookie_found_inner = cookie_found.clone();
    let target_username_handler = username.clone();

    let _ = win.with_webview(move |wv| {
        #[cfg(target_os = "windows")]
        setup_webresource_response_received_handler(&wv, app_inner, label_inner, cookie_found_inner, target_username_handler);
        #[cfg(not(target_os = "windows"))]
        {
            let _ = app_inner;
            let _ = label_inner;
            let _ = cookie_found_inner;
        }
    });

    let app_close = app.clone();
    let cookie_found_close = cookie_found.clone();
    let data_dir_close = data_dir.clone();
    let target_username_close = username.clone();
    let label_close_event = win.label().to_string();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            if !cookie_found_close.load(std::sync::atomic::Ordering::Relaxed) {
                let payload = LoginResultPayload {
                    cookie: None,
                    window_label: label_close_event.clone(),
                    target_username: target_username_close.clone(),
                    error: Some("Login window was closed manually or cookie extraction failed.".to_string()),
                };
                let _ = app_close.emit("login-cookie-result", payload);
            }
            // Clean up the isolated data dir only for anonymous manual logins (when username is None)
            if target_username_close.is_none() {
                let dir = data_dir_close.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(3));
                    let _ = std::fs::remove_dir_all(&dir);
                });
            }
        }
    });

    Ok(label)
}

/// Authenticate directly via Roblox HTTP API — no browser/WebView involved.
/// Returns the raw .ROBLOSECURITY cookie value on success.
#[tauri::command]
async fn login_with_credentials(username: String, password: String) -> Result<String, String> {
    // Cookie jar so cookies from the 403 response are replayed on the second request,
    // exactly as a real browser session would do.
    let jar = std::sync::Arc::new(reqwest::cookie::Jar::default());
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")
        .cookie_provider(jar)
        .build()
        .map_err(|e| e.to_string())?;

    let body = serde_json::json!({
        "ctype": "Username",
        "cvalue": username,
        "password": password
    });

    let common_headers = [
        ("Accept",           "application/json, text/plain, */*"),
        ("Accept-Language",  "en-US,en;q=0.9"),
        ("Origin",           "https://www.roblox.com"),
        ("Referer",          "https://www.roblox.com/login"),
        ("sec-ch-ua",        r#""Chromium";v="131","Google Chrome";v="131","Not_A Brand";v="24""#),
        ("sec-ch-ua-mobile", "?0"),
        ("sec-ch-ua-platform", "\"Windows\""),
        ("sec-fetch-dest",   "empty"),
        ("sec-fetch-mode",   "cors"),
        ("sec-fetch-site",   "same-site"),
    ];

    // First request — intentionally expect 403 to get the CSRF token.
    let mut req1 = client
        .post("https://auth.roblox.com/v2/login")
        .json(&body);
    for (k, v) in &common_headers { req1 = req1.header(*k, *v); }
    let resp1 = req1.send().await.map_err(|e| format!("Network error: {}", e))?;

    let csrf = resp1
        .headers()
        .get("x-csrf-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    if resp1.status().is_success() {
        for hdr in resp1.headers().get_all("set-cookie").iter() {
            if let Ok(s) = hdr.to_str() {
                if s.contains(".ROBLOSECURITY=") {
                    return Ok(clean_cookie(s));
                }
            }
        }
    }

    let csrf_token = csrf.ok_or_else(|| "Failed to obtain CSRF token from Roblox".to_string())?;

    // Second request — real login attempt with CSRF token.
    let mut req2 = client
        .post("https://auth.roblox.com/v2/login")
        .header("x-csrf-token", &csrf_token)
        .json(&body);
    for (k, v) in &common_headers { req2 = req2.header(*k, *v); }
    let resp2 = req2.send().await.map_err(|e| format!("Network error: {}", e))?;

    let status = resp2.status();

    if status.is_success() {
        for hdr in resp2.headers().get_all("set-cookie").iter() {
            if let Ok(s) = hdr.to_str() {
                if s.contains(".ROBLOSECURITY=") {
                    return Ok(clean_cookie(s));
                }
            }
        }
        return Err("Login succeeded but .ROBLOSECURITY cookie was not in the response".to_string());
    }

    let body_text = resp2.text().await.unwrap_or_default();

    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body_text) {
        if let Some(errors) = json["errors"].as_array() {
            if let Some(first) = errors.first() {
                let code = first["code"].as_i64().unwrap_or(0);
                let msg = first["userFacingMessage"].as_str()
                    .or_else(|| first["message"].as_str())
                    .unwrap_or("Unknown error");
                return match code {
                    4 => Err("Invalid username or password.".to_string()),
                    2 => Err("Account temporarily locked — too many failed attempts.".to_string()),
                    _ => Err(format!("Roblox error ({}): {}", code, msg)),
                };
            }
        }
    }

    if status.as_u16() == 403 {
        return Err("CAPTCHA required — use Manual Login for this account.".to_string());
    }

    Err(format!("Login failed (HTTP {}): {}", status, body_text))
}

async fn resolve_share_link(cookie: &str, share_code: &str) -> Result<(String, String), String> {
    eprintln!("[resolve_share_link] Resolving share code: {}", share_code);

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36")
        .build()
        .map_err(|e| e.to_string())?;

    // CSRF token required for POST to apis.roblox.com
    let csrf_resp = client
        .post("https://auth.roblox.com/v2/logout")
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .send()
        .await
        .map_err(|e| format!("CSRF fetch failed: {}", e))?;
    let csrf = csrf_resp
        .headers()
        .get("x-csrf-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
        .ok_or_else(|| "No CSRF token returned".to_string())?;

    eprintln!("[resolve_share_link] Got CSRF token: {}...", &csrf[..csrf.len().min(8)]);

    // Attempt 1: primary format
    let resp = client
        .post("https://apis.roblox.com/sharelinks/v1/resolve-link")
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .header("x-csrf-token", &csrf)
        .header("Origin", "https://www.roblox.com")
        .header("Referer", "https://www.roblox.com/")
        .json(&serde_json::json!({
            "linkId": share_code,
            "linkType": "Server"
        }))
        .send()
        .await
        .map_err(|e| format!("Share resolve request failed: {}", e))?;

    let mut status = resp.status();
    let mut body = resp.text().await.unwrap_or_default();
    eprintln!("[resolve_share_link] Primary attempt status: {}, body: {}", status, body);

    // Attempt 2: alternative format if primary failed
    if !status.is_success() {
        eprintln!("[resolve_share_link] Retrying with alternative body format...");
        let resp2 = client
            .post("https://apis.roblox.com/sharelinks/v1/resolve-link")
            .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
            .header("x-csrf-token", &csrf)
            .header("Origin", "https://www.roblox.com")
            .header("Referer", "https://www.roblox.com/")
            .json(&serde_json::json!({
                "code": share_code,
                "type": "Server"
            }))
            .send()
            .await
            .map_err(|e| format!("Share resolve retry failed: {}", e))?;
        status = resp2.status();
        body = resp2.text().await.unwrap_or_default();
        eprintln!("[resolve_share_link] Retry attempt status: {}, body: {}", status, body);
    }

    if !status.is_success() {
        return Err(format!("resolve-link API failed (HTTP {}): {}", status, body));
    }

    let json: serde_json::Value = serde_json::from_str(&body)
        .map_err(|e| format!("Failed to parse response: {} — body: {}", e, body))?;

    eprintln!("[resolve_share_link] Success response: {}", json);

    // Extract placeId — search multiple paths the API may use
    let place_id = json["privateServerInviteData"]["placeId"]
        .as_i64().map(|n| n.to_string())
        .or_else(|| json["privateServerInviteData"]["placeId"].as_str().map(String::from))
        .or_else(|| json["resolvedLink"]["privateServerInviteData"]["placeId"].as_i64().map(|n| n.to_string()))
        .or_else(|| json["resolvedLink"]["privateServerInviteData"]["placeId"].as_str().map(String::from))
        .or_else(|| json["placeId"].as_i64().map(|n| n.to_string()))
        .or_else(|| json["placeId"].as_str().map(String::from))
        .or_else(|| json["data"]["placeId"].as_i64().map(|n| n.to_string()))
        .or_else(|| json["data"]["placeId"].as_str().map(String::from))
        .ok_or_else(|| format!("placeId not found in response. Full body: {}", body))?;

    // Extract link code — API may return linkCode or privateServerLinkCode
    let link_code = json["privateServerInviteData"]["linkCode"]
        .as_str().map(String::from)
        .or_else(|| json["privateServerInviteData"]["privateServerLinkCode"].as_str().map(String::from))
        .or_else(|| json["resolvedLink"]["privateServerInviteData"]["privateServerLinkCode"].as_str().map(String::from))
        .or_else(|| json["resolvedLink"]["privateServerInviteData"]["linkCode"].as_str().map(String::from))
        .or_else(|| json["privateServerLinkCode"].as_str().map(String::from))
        .or_else(|| json["linkCode"].as_str().map(String::from))
        .or_else(|| json["data"]["privateServerLinkCode"].as_str().map(String::from))
        .or_else(|| json["data"]["linkCode"].as_str().map(String::from))
        .ok_or_else(|| format!("link code not found in response. Full body: {}", body))?;

    eprintln!("[resolve_share_link] Resolved → placeId: {}, linkCode: {}", place_id, link_code);
    Ok((place_id, link_code))
}

async fn get_csrf_token(cookie: &str) -> Option<String> {
    let client = reqwest::Client::builder().user_agent("Mozilla/5.0").build().ok()?;
    let resp = client
        .post("https://auth.roblox.com/v2/logout")
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .send()
        .await
        .ok()?;
    resp.headers()
        .get("x-csrf-token")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

async fn resolve_username(cookie: &str, username: &str) -> Result<i64, String> {
    let client = reqwest::Client::builder().user_agent("Mozilla/5.0").build().map_err(|e| e.to_string())?;
    let resp = client
        .post("https://users.roblox.com/v1/usernames/users")
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .json(&serde_json::json!({ "usernames": [username], "excludeBannedUsers": false }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        if let Some(arr) = json["data"].as_array() {
            if !arr.is_empty() {
                if let Some(id) = arr[0]["id"].as_i64() {
                    return Ok(id);
                }
            }
        }
        Err(format!("User '{}' not found", username))
    } else {
        Err(format!("Failed to resolve username: status {}", resp.status()))
    }
}

#[tauri::command]
async fn set_display_name(user_id: i64, new_name: String) -> Result<String, String> {
    let accounts = load_stored();
    let account = accounts.iter().find(|a| a.user_id == user_id).ok_or("Account not found")?;
    let cookie = decrypt_cookie(&account.encrypted_cookie)?;
    let csrf = get_csrf_token(&cookie).await.ok_or("Failed to obtain CSRF token")?;

    let client = reqwest::Client::builder().user_agent("Mozilla/5.0").build().map_err(|e| e.to_string())?;
    let resp = client
        .patch(format!("https://users.roblox.com/v1/users/{}/display-names", user_id))
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .header("x-csrf-token", csrf)
        .json(&serde_json::json!({ "newDisplayName": new_name }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        let mut accounts_mut = load_stored();
        if let Some(a) = accounts_mut.iter_mut().find(|a| a.user_id == user_id) {
            a.display_name = new_name;
        }
        save_stored(&accounts_mut);
        Ok("Display name updated successfully.".into())
    } else {
        let err_text = resp.text().await.unwrap_or_default();
        Err(format!("Failed to update display name: {}", err_text))
    }
}

#[tauri::command]
async fn change_password(user_id: i64, current_pw: String, new_pw: String) -> Result<String, String> {
    let accounts = load_stored();
    let account = accounts.iter().find(|a| a.user_id == user_id).ok_or("Account not found")?;
    let cookie = decrypt_cookie(&account.encrypted_cookie)?;
    let csrf = get_csrf_token(&cookie).await.ok_or("Failed to obtain CSRF token")?;

    let client = reqwest::Client::builder().user_agent("Mozilla/5.0").build().map_err(|e| e.to_string())?;
    let resp = client
        .post("https://auth.roblox.com/v2/user/passwords/change")
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .header("x-csrf-token", csrf)
        .json(&serde_json::json!({ "currentPassword": current_pw, "newPassword": new_pw }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        Ok("Password changed successfully.".into())
    } else {
        let err_text = resp.text().await.unwrap_or_default();
        Err(format!("Failed to change password: {}", err_text))
    }
}

#[tauri::command]
async fn sign_out_all_sessions(user_id: i64) -> Result<String, String> {
    let accounts = load_stored();
    let account = accounts.iter().find(|a| a.user_id == user_id).ok_or("Account not found")?;
    let cookie = decrypt_cookie(&account.encrypted_cookie)?;
    let csrf = get_csrf_token(&cookie).await.ok_or("Failed to obtain CSRF token")?;

    let client = reqwest::Client::builder().user_agent("Mozilla/5.0").build().map_err(|e| e.to_string())?;
    let resp = client
        .post("https://auth.roblox.com/v1/logoutFromAllSessionsAndReauthenticate")
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .header("x-csrf-token", csrf)
        .body("{}")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        Ok("Signed out of all other sessions successfully.".into())
    } else {
        Err(format!("Failed to sign out of other sessions: status {}", resp.status()))
    }
}

#[tauri::command]
async fn send_friend_request(user_id: i64, target_username: String) -> Result<String, String> {
    let accounts = load_stored();
    let account = accounts.iter().find(|a| a.user_id == user_id).ok_or("Account not found")?;
    let cookie = decrypt_cookie(&account.encrypted_cookie)?;
    let target_user_id = resolve_username(&cookie, &target_username).await?;

    let csrf = get_csrf_token(&cookie).await.ok_or("Failed to obtain CSRF token")?;

    let client = reqwest::Client::builder().user_agent("Mozilla/5.0").build().map_err(|e| e.to_string())?;
    let resp = client
        .post(format!("https://friends.roblox.com/v1/users/{}/request-friendship", target_user_id))
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .header("x-csrf-token", csrf)
        .body("{}")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        Ok(format!("Friend request sent to @{}.", target_username))
    } else {
        let err_text = resp.text().await.unwrap_or_default();
        Err(format!("Failed to send friend request: {}", err_text))
    }
}

#[tauri::command]
async fn block_user(user_id: i64, target_username: String) -> Result<String, String> {
    let accounts = load_stored();
    let account = accounts.iter().find(|a| a.user_id == user_id).ok_or("Account not found")?;
    let cookie = decrypt_cookie(&account.encrypted_cookie)?;
    let target_user_id = resolve_username(&cookie, &target_username).await?;

    let csrf = get_csrf_token(&cookie).await.ok_or("Failed to obtain CSRF token")?;

    let client = reqwest::Client::builder().user_agent("Mozilla/5.0").build().map_err(|e| e.to_string())?;
    let resp = client
        .post(format!("https://accountsettings.roblox.com/v1/users/{}/block", target_user_id))
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .header("x-csrf-token", csrf)
        .body("{}")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        Ok(format!("Blocked @{}.", target_username))
    } else {
        Err(format!("Failed to block: status {}", resp.status()))
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RobloxGameResultDto {
    pub name: String,
    pub place_id: i64,
    pub universe_id: i64,
    pub creator_name: String,
    pub icon_url: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RobloxServerEntryDto {
    pub job_id: String,
    pub playing: String,
    pub active_players: i32,
    pub max_players: i32,
    pub ping: String,
    pub fps: String,
}

#[tauri::command]
async fn search_roblox_games(keyword: String) -> Result<Vec<RobloxGameResultDto>, String> {
    if keyword.trim().is_empty() {
        return Ok(vec![]);
    }

    let cookie = get_first_valid_cookie();

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0")
        .build()
        .map_err(|e| e.to_string())?;

    let session_id = format!("session-{}", rand::random::<u32>());
    let url = format!(
        "https://apis.roblox.com/search-api/omni-search?searchQuery={}&sessionId={}&pageType=all",
        urlencoding::encode(&keyword),
        session_id
    );

    let mut req = client.get(&url).header("Referer", "https://www.roblox.com/");
    if let Some(ref c) = cookie {
        req = req.header("Cookie", format!(".ROBLOSECURITY={}", c));
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Omni Search API failed with status: {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut results = Vec::new();

    if let Some(search_results) = json["searchResults"].as_array() {
        for group in search_results {
            let group_type = group["contentGroupType"].as_str().unwrap_or("");
            if group_type == "Game" || group_type == "Experience" || group_type == "SearchUniverse" {
                if let Some(contents) = group["contents"].as_array() {
                    for game_item in contents {
                        let name = game_item["name"].as_str().unwrap_or("Unknown").to_string();
                        let creator_name = game_item["creatorName"].as_str().unwrap_or("Unknown").to_string();
                        let universe_id = game_item["contentId"].as_i64().unwrap_or(0);
                        let place_id = game_item["rootPlaceId"].as_i64().unwrap_or(universe_id);

                        if place_id == 0 {
                            continue;
                        }

                        results.push(RobloxGameResultDto {
                            name,
                            place_id,
                            universe_id,
                            creator_name,
                            icon_url: String::new(),
                        });
                    }
                }
            }
        }
    }

    if !results.is_empty() {
        let universe_ids: Vec<String> = results
            .iter()
            .map(|r| r.universe_id.to_string())
            .filter(|id| id != "0")
            .collect();

        if !universe_ids.is_empty() {
            let ids_str = universe_ids.join(",");
            let thumb_url = format!(
                "https://thumbnails.roblox.com/v1/games/icons?universeIds={}&size=150x150&format=Png&isCircular=false",
                ids_str
            );
            if let Ok(thumb_resp) = client.get(&thumb_url).send().await {
                if let Ok(thumb_json) = thumb_resp.json::<serde_json::Value>().await {
                    if let Some(data) = thumb_json["data"].as_array() {
                        let mut icon_map = HashMap::new();
                        for item in data {
                            if let (Some(target_id), Some(img_url)) = (
                                item["targetId"].as_i64(),
                                item["imageUrl"].as_str(),
                            ) {
                                icon_map.insert(target_id, img_url.to_string());
                            }
                        }
                        for game in &mut results {
                            if let Some(url) = icon_map.get(&game.universe_id) {
                                game.icon_url = url.clone();
                            }
                        }
                    }
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
async fn fetch_active_servers(place_id: i64) -> Result<Vec<RobloxServerEntryDto>, String> {
    let cookie = get_first_valid_cookie();

    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0")
        .build()
        .map_err(|e| e.to_string())?;

    let mut target_place_id = place_id;

    // Resolve Place ID to Universe ID
    let resolver_url = format!("https://apis.roblox.com/universes/v1/places/{}/universe", place_id);
    let resolver_resp = client.get(&resolver_url).send().await.map_err(|e| e.to_string())?;
    
    let mut resolved = false;
    if resolver_resp.status().is_success() {
        if let Ok(resolver_json) = resolver_resp.json::<serde_json::Value>().await {
            if let Some(uid) = resolver_json["universeId"].as_i64() {
                if uid > 0 {
                    resolved = true;
                }
            }
        }
    }

    if !resolved {
        // Check if place_id is actually a Universe ID, and translate to rootPlaceId
        let details_url = format!("https://games.roblox.com/v1/games?universeIds={}", place_id);
        if let Ok(details_resp) = client.get(&details_url).send().await {
            if details_resp.status().is_success() {
                if let Ok(details_json) = details_resp.json::<serde_json::Value>().await {
                    if let Some(data_arr) = details_json["data"].as_array() {
                        if !data_arr.is_empty() {
                            if let Some(root_pid) = data_arr[0]["rootPlaceId"].as_i64() {
                                target_place_id = root_pid;
                            }
                        }
                    }
                }
            }
        }
    }

    let url = format!(
        "https://games.roblox.com/v1/games/{}/servers/Public?limit=50",
        target_place_id
    );

    let mut req = client.get(&url).header("Referer", "https://www.roblox.com/");
    if let Some(ref c) = cookie {
        req = req.header("Cookie", format!(".ROBLOSECURITY={}", c));
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Roblox servers API failed with status: {}", resp.status()));
    }

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let mut results = Vec::new();

    if let Some(data) = json["data"].as_array() {
        for srv in data {
            let playing = srv["playing"].as_i64().unwrap_or(0) as i32;
            let max_players = srv["maxPlayers"].as_i64().unwrap_or(0) as i32;
            let fps = srv["fps"].as_f64().unwrap_or(0.0);
            let ping = srv["ping"].as_i64().unwrap_or(0) as i32;
            let job_id = srv["id"].as_str().unwrap_or("").to_string();

            if playing > 0 && !job_id.is_empty() {
                results.push(RobloxServerEntryDto {
                    job_id,
                    playing: format!("{}/{}", playing, max_players),
                    active_players: playing,
                    max_players,
                    ping: if ping > 0 { format!("{}ms", ping) } else { "N/A".to_string() },
                    fps: if fps > 0.0 { format!("{:.0} FPS", fps) } else { "N/A".to_string() },
                });
            }
        }
    }

    results.sort_by_key(|s| s.active_players);

    Ok(results)
}

#[tauri::command]
async fn fetch_place_details(place_id: i64) -> Result<RobloxGameResultDto, String> {
    let client = reqwest::Client::builder()
        .user_agent("Mozilla/5.0")
        .build()
        .map_err(|e| e.to_string())?;

    // 1. Resolve Place ID to Universe ID
    let resolver_url = format!("https://apis.roblox.com/universes/v1/places/{}/universe", place_id);
    let resolver_resp = client.get(&resolver_url).send().await.map_err(|e| e.to_string())?;
    
    let mut resolved_universe_id = None;
    let mut resolved_place_id = place_id;

    if resolver_resp.status().is_success() {
        if let Ok(resolver_json) = resolver_resp.json::<serde_json::Value>().await {
            if let Some(uid) = resolver_json["universeId"].as_i64() {
                if uid > 0 {
                    resolved_universe_id = Some(uid);
                }
            }
        }
    }

    // 2. If it did not resolve as a Place ID, check if it's a Universe ID directly
    if resolved_universe_id.is_none() {
        let details_url = format!("https://games.roblox.com/v1/games?universeIds={}", place_id);
        if let Ok(details_resp) = client.get(&details_url).send().await {
            if details_resp.status().is_success() {
                if let Ok(details_json) = details_resp.json::<serde_json::Value>().await {
                    if let Some(data_arr) = details_json["data"].as_array() {
                        if !data_arr.is_empty() {
                            if let Some(uid) = data_arr[0]["id"].as_i64() {
                                resolved_universe_id = Some(uid);
                                if let Some(root_pid) = data_arr[0]["rootPlaceId"].as_i64() {
                                    resolved_place_id = root_pid;
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    let universe_id = resolved_universe_id
        .ok_or_else(|| format!("Could not resolve ID {} to a valid experience", place_id))?;

    // 3. Fetch game details using Universe ID
    let details_url = format!("https://games.roblox.com/v1/games?universeIds={}", universe_id);
    let details_resp = client.get(&details_url).send().await.map_err(|e| e.to_string())?;
    if !details_resp.status().is_success() {
        return Err(format!("Games details API failed with status: {}", details_resp.status()));
    }

    let details_json: serde_json::Value = details_resp.json().await.map_err(|e| e.to_string())?;
    let data_arr = details_json["data"]
        .as_array()
        .ok_or_else(|| "Invalid details API response structure".to_string())?;

    if data_arr.is_empty() {
        return Err("No details found for the resolved Universe ID".to_string());
    }

    let game_data = &data_arr[0];
    let name = game_data["name"].as_str().unwrap_or("Unknown Game").to_string();
    let creator_name = game_data["creator"]["name"].as_str().unwrap_or("Unknown Creator").to_string();

    let mut game = RobloxGameResultDto {
        name,
        place_id: resolved_place_id,
        universe_id,
        creator_name,
        icon_url: String::new(),
    };

    // 4. Fetch Game Icon URL
    let thumb_url = format!(
        "https://thumbnails.roblox.com/v1/games/icons?universeIds={}&size=150x150&format=Png&isCircular=false",
        universe_id
    );
    if let Ok(thumb_resp) = client.get(&thumb_url).send().await {
        if let Ok(thumb_json) = thumb_resp.json::<serde_json::Value>().await {
            if let Some(data) = thumb_json["data"].as_array() {
                if !data.is_empty() {
                    if let Some(img_url) = data[0]["imageUrl"].as_str() {
                        game.icon_url = img_url.to_string();
                    }
                }
            }
        }
    }

    Ok(game)
}

#[tauri::command]
fn get_multi_instance(state: tauri::State<'_, MultiState>) -> bool {
    state.is_active()
}

#[tauri::command]
fn set_multi_instance(active: bool, state: tauri::State<'_, MultiState>) {
    state.set_active(active);
}

#[tauri::command]
fn get_settings() -> Result<serde_json::Value, String> {
    let settings_path = data_dir().join("settings.json");
    if !settings_path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let trimmed = clean_bom(&content).trim().to_string();
    if trimmed.is_empty() {
        return Ok(serde_json::json!({}));
    }
    serde_json::from_str(&trimmed).map_err(|e| e.to_string())
}

#[tauri::command]
fn verify_pin(pin: String) -> bool {
    use sha2::Digest;
    let settings_path = data_dir().join("settings.json");
    let stored_hash = fs::read_to_string(&settings_path)
        .ok()
        .and_then(|s| serde_json::from_str::<serde_json::Value>(clean_bom(&s)).ok())
        .and_then(|v| v.get("AppLockPinHash").and_then(|h| h.as_str()).map(|s| s.to_string()))
        .unwrap_or_default();
    if stored_hash.is_empty() { return true; }
    let mut hasher = sha2::Sha256::new();
    hasher.update(pin.as_bytes());
    format!("{:x}", hasher.finalize()) == stored_hash
}

#[tauri::command]
async fn send_discord_webhook(url: String, payload: serde_json::Value) -> Result<(), String> {
    if url.is_empty() { return Ok(()); }
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;
    client.post(&url)
        .json(&payload)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn save_settings(settings: serde_json::Value, state: tauri::State<'_, MultiState>) -> Result<(), String> {
    let settings_path = data_dir().join("settings.json");

    // Sync MultiRoblox setting to MultiState
    if let Some(multi) = settings.get("MultiRoblox").and_then(|v| v.as_bool()) {
        state.set_active(multi);
    }

    // Sync RunOnStartup to Windows registry
    #[cfg(windows)]
    {
        let run_on_startup = settings.get("RunOnStartup").and_then(|v| v.as_bool()).unwrap_or(false);
        sync_run_on_startup(run_on_startup);
    }

    // Read existing file and merge — preserves keys like RecentGames that aren't part of settings
    let mut merged: serde_json::Value = if settings_path.exists() {
        if let Ok(content) = fs::read_to_string(&settings_path) {
            let trimmed = clean_bom(&content).trim().to_string();
            if !trimmed.is_empty() {
                serde_json::from_str(&trimmed).unwrap_or(serde_json::json!({}))
            } else {
                serde_json::json!({})
            }
        } else {
            serde_json::json!({})
        }
    } else {
        serde_json::json!({})
    };

    if let (Some(obj), Some(new_obj)) = (merged.as_object_mut(), settings.as_object()) {
        for (k, v) in new_obj {
            obj.insert(k.clone(), v.clone());
        }
    } else {
        merged = settings;
    }

    let s = serde_json::to_string_pretty(&merged).map_err(|e| e.to_string())?;
    fs::write(&settings_path, s).map_err(|e| e.to_string())?;
    Ok(())
}

// ── Launcher Preference ──────────────────────────────────────────────────────

fn read_launcher_preference() -> String {
    let settings_path = data_dir().join("settings.json");
    if let Ok(content) = fs::read_to_string(&settings_path) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(clean_bom(&content)) {
            if let Some(kind) = val.get("PreferredLauncher").and_then(|v| v.as_str()) {
                return kind.to_string();
            }
        }
    }
    // Default: use Reiya if installed, otherwise fall through
    "auto".to_string()
}
#[cfg(target_os = "windows")]
fn launch_detached(exe_path: &std::path::Path, args: &str) -> Result<Option<u32>, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;

    let exe_dir = exe_path.parent().ok_or_else(|| {
        let err = "Invalid executable path (no parent directory)".to_string();
        eprintln!("[ERROR launch_detached] Parent dir resolved to None for: {:?}", exe_path);
        err
    })?;

    eprintln!("[INFO launch_detached] Spawning executable via ShellExecuteW: {:?}", exe_path);
    eprintln!("[INFO launch_detached] Working directory: {:?}", exe_dir);
    eprintln!("[INFO launch_detached] Arguments: {}", args);

    if !exe_path.exists() {
        let err = format!("Executable does not exist: {}", exe_path.display());
        eprintln!("[ERROR launch_detached] {}", err);
        return Err(err);
    }

    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut std::ffi::c_void,
            lpOperation: *const u16,
            lpFile: *const u16,
            lpParameters: *const u16,
            lpDirectory: *const u16,
            nShowCmd: i32,
        ) -> isize;
    }

    let exe_wide: Vec<u16> = exe_path.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let args_wide: Vec<u16> = OsStr::new(args).encode_wide().chain(std::iter::once(0)).collect();
    let dir_wide: Vec<u16> = exe_dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let open_wide: Vec<u16> = OsStr::new("open").encode_wide().chain(std::iter::once(0)).collect();

    let res = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            open_wide.as_ptr(),
            exe_wide.as_ptr(),
            args_wide.as_ptr(),
            dir_wide.as_ptr(),
            1, // SW_SHOWNORMAL
        )
    };

    if res <= 32 {
        let err = format!("ShellExecuteW failed with error code: {}", res);
        eprintln!("[ERROR launch_detached] {}", err);
        return Err(err);
    }

    eprintln!("[INFO launch_detached] Shell launch completed successfully.");
    Ok(None)
}

#[cfg(not(target_os = "windows"))]
fn launch_detached(_exe_path: &std::path::Path, _args: &str) -> Result<Option<u32>, String> {
    eprintln!("[ERROR launch_detached] Detached spawning is only supported on Windows.");
    Err("Detached launching is only supported on Windows".into())
}

#[cfg(target_os = "windows")]
fn apply_launcher_registry(kind: &str) -> Result<(), String> {
    match kind {
        "reiya" => {
            let installed_ver = read_installed_version()
                .ok_or_else(|| "Reiya is not installed. Please install it first on the Bootstrapper page.".to_string())?;
            let exe = version_dir(&installed_ver).join("RobloxPlayerBeta.exe");
            if !exe.exists() {
                return Err(format!("Reiya executable not found at {}", exe.display()));
            }
            bootstrapper_register_protocol_internal(&exe.to_string_lossy())
        }
        "bloxstrap" => {
            let local = std::env::var("LOCALAPPDATA")
                .map_err(|e| format!("Failed to read LOCALAPPDATA: {}", e))?;
            let bloxstrap_dir = PathBuf::from(&local).join("Bloxstrap");
            let bloxstrap_exe = bloxstrap_dir.join("Bloxstrap.exe");
            if !bloxstrap_exe.exists() {
                return Err("Bloxstrap is not installed at %LOCALAPPDATA%\\Bloxstrap\\Bloxstrap.exe".to_string());
            }
            use winreg::{enums::HKEY_CURRENT_USER, RegKey};
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            if let Ok((key, _)) = hkcu.create_subkey(r"Software\Bloxstrap") {
                let dir_str = bloxstrap_dir.to_string_lossy().to_string();
                let _ = key.set_value("InstallFolder", &dir_str);
                let _ = key.set_value("InstallLocation", &dir_str);
            }
            bootstrapper_register_protocol_internal(&bloxstrap_exe.to_string_lossy())
        }
        "fishstrap" => {
            let local = std::env::var("LOCALAPPDATA")
                .map_err(|e| format!("Failed to read LOCALAPPDATA: {}", e))?;
            let local_path = PathBuf::from(local);
            let mut fish_dir = local_path.join("Fishstrap");
            let mut fish_exe = fish_dir.join("Fishstrap.exe");
            if !fish_exe.exists() { fish_dir = local_path.join("Fishtrap");  fish_exe = fish_dir.join("Fishtrap.exe"); }
            if !fish_exe.exists() { fish_dir = local_path.join("Fishstrap"); fish_exe = fish_dir.join("Fishtrap.exe"); }
            if !fish_exe.exists() { fish_dir = local_path.join("Fishtrap");  fish_exe = fish_dir.join("Fishstrap.exe"); }
            if !fish_exe.exists() {
                return Err("Fishstrap is not installed under %LOCALAPPDATA%\\Fishstrap or Fishtrap".to_string());
            }
            use winreg::{enums::HKEY_CURRENT_USER, RegKey};
            let hkcu = RegKey::predef(HKEY_CURRENT_USER);
            let dir_str = fish_dir.to_string_lossy().to_string();
            if let Ok((key, _)) = hkcu.create_subkey(r"Software\Fishstrap") {
                let _ = key.set_value("InstallFolder", &dir_str);
                let _ = key.set_value("InstallLocation", &dir_str);
            }
            if let Ok((key, _)) = hkcu.create_subkey(r"Software\Fishtrap") {
                let _ = key.set_value("InstallFolder", &dir_str);
                let _ = key.set_value("InstallLocation", &dir_str);
            }
            bootstrapper_register_protocol_internal(&fish_exe.to_string_lossy())
        }
        "official" => {
            let local = std::env::var("LOCALAPPDATA")
                .map_err(|e| format!("Failed to read LOCALAPPDATA: {}", e))?;
            let roblox_versions_dir = PathBuf::from(local).join("Roblox").join("Versions");
            let exe = search_versions_dir(&roblox_versions_dir)
                .ok_or_else(|| "Official Roblox install not found. Please install official Roblox first.".to_string())?;
            bootstrapper_register_protocol_internal(&exe.to_string_lossy())
        }
        "auto" => {
            if let Some(installed_ver) = read_installed_version() {
                let exe = version_dir(&installed_ver).join("RobloxPlayerBeta.exe");
                if exe.exists() {
                    return bootstrapper_register_protocol_internal(&exe.to_string_lossy());
                }
            }
            if let Ok(local) = std::env::var("LOCALAPPDATA") {
                let roblox_versions_dir = PathBuf::from(local).join("Roblox").join("Versions");
                if let Some(exe) = search_versions_dir(&roblox_versions_dir) {
                    return bootstrapper_register_protocol_internal(&exe.to_string_lossy());
                }
            }
            Err("Auto-launcher selection failed: no Roblox install detected".to_string())
        }
        "protocol" => Ok(()), // uses existing Windows default handler, no registry write needed
        _ => Err(format!("Unsupported preferred launcher: {}", kind)),
    }
}

#[cfg(not(target_os = "windows"))]
fn apply_launcher_registry(_kind: &str) -> Result<(), String> {
    eprintln!("[ERROR apply_launcher_registry] Registry modifications are only supported on Windows.");
    Err("Launcher preference registration is only supported on Windows".into())
}

#[cfg(target_os = "windows")]
fn launch_via_protocol(url: &str) -> Result<(), String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    
    eprintln!("[INFO launch_via_protocol] Directing protocol URL to shell handler: {}", url);
    
    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut std::ffi::c_void,
            lpOperation: *const u16,
            lpFile: *const u16,
            lpParameters: *const u16,
            lpDirectory: *const u16,
            nShowCmd: i32,
        ) -> isize;
    }
    
    let url_wide: Vec<u16> = OsStr::new(url).encode_wide().chain(std::iter::once(0)).collect();
    let open_wide: Vec<u16> = OsStr::new("open").encode_wide().chain(std::iter::once(0)).collect();
    
    let res = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            open_wide.as_ptr(),
            url_wide.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1, // SW_SHOWNORMAL
        )
    };
    
    if res <= 32 {
        let err = format!("ShellExecuteW failed with error code: {}", res);
        eprintln!("[ERROR launch_via_protocol] {}", err);
        return Err(err);
    }
    
    eprintln!("[INFO launch_via_protocol] Protocol launch request completed.");
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn launch_via_protocol(_url: &str) -> Result<(), String> {
    eprintln!("[ERROR launch_via_protocol] Protocol launching is only supported on Windows.");
    Err("Protocol launching is only supported on Windows".into())
}

async fn do_launch_with_preference(pref: &str, launch_args: &str, app: &tauri::AppHandle, multi_active: bool) -> Result<Option<u32>, String> {
    eprintln!("[INFO do_launch_with_preference] Launch preference request - launcher: '{}', args: '{}'", pref, launch_args);

    let resolved_pref = if pref == "auto" {
        if let Some(installed_ver) = read_installed_version() {
            let exe = version_dir(&installed_ver).join("RobloxPlayerBeta.exe");
            if exe.exists() {
                "reiya"
            } else {
                "official"
            }
        } else {
            "official"
        }
    } else {
        pref
    };

    match resolved_pref {
        "reiya" => {
            let pid = ensure_latest_and_launch(app, launch_args, multi_active).await?;
            return Ok(pid);
        }
        "official" => {
            let local = std::env::var("LOCALAPPDATA").map_err(|e| {
                let err = format!("Failed to read LOCALAPPDATA: {}", e);
                eprintln!("[ERROR do_launch_with_preference] {}", err);
                err
            })?;
            let roblox_versions_dir = PathBuf::from(local).join("Roblox").join("Versions");
            let exe = search_versions_dir(&roblox_versions_dir).ok_or_else(|| {
                let err = "Official Roblox install not found. Please install official Roblox first.".to_string();
                eprintln!("[ERROR do_launch_with_preference] {}", err);
                err
            })?;
            #[cfg(target_os = "windows")]
            {
                let pid = launch_detached(&exe, launch_args)?;
                return Ok(pid);
            }
            #[cfg(not(target_os = "windows"))]
            return Err("Official launcher is only supported on Windows".into());
        }
        "bloxstrap" => {
            let local = std::env::var("LOCALAPPDATA").map_err(|e| {
                let err = format!("Failed to read LOCALAPPDATA: {}", e);
                eprintln!("[ERROR do_launch_with_preference] {}", err);
                err
            })?;
            let bloxstrap_exe = PathBuf::from(&local).join("Bloxstrap").join("Bloxstrap.exe");
            if !bloxstrap_exe.exists() {
                return Err("Bloxstrap is not installed at %LOCALAPPDATA%\\Bloxstrap\\Bloxstrap.exe. Please install it first.".to_string());
            }
            #[cfg(target_os = "windows")]
            {
                let args = format!("-player {}", launch_args);
                let pid = launch_detached(&bloxstrap_exe, &args)?;
                return Ok(pid);
            }
            #[cfg(not(target_os = "windows"))]
            return Err("Bloxstrap is only supported on Windows".into());
        }
        "fishstrap" => {
            let local = std::env::var("LOCALAPPDATA").map_err(|e| {
                let err = format!("Failed to read LOCALAPPDATA: {}", e);
                eprintln!("[ERROR do_launch_with_preference] {}", err);
                err
            })?;
            let local_path = PathBuf::from(local);
            let mut fish_dir = local_path.join("Fishstrap");
            let mut fish_exe = fish_dir.join("Fishstrap.exe");
            if !fish_exe.exists() { fish_dir = local_path.join("Fishtrap");  fish_exe = fish_dir.join("Fishtrap.exe"); }
            if !fish_exe.exists() { fish_dir = local_path.join("Fishstrap"); fish_exe = fish_dir.join("Fishtrap.exe"); }
            if !fish_exe.exists() { fish_dir = local_path.join("Fishtrap");  fish_exe = fish_dir.join("Fishstrap.exe"); }
            if !fish_exe.exists() {
                return Err("Fishstrap/Fishtrap is not installed under %LOCALAPPDATA%\\Fishstrap or Fishtrap".to_string());
            }
            #[cfg(target_os = "windows")]
            {
                let args = format!("-player {}", launch_args);
                let pid = launch_detached(&fish_exe, &args)?;
                return Ok(pid);
            }
            #[cfg(not(target_os = "windows"))]
            return Err("Fishstrap is only supported on Windows".into());
        }
        _ => {
            // For protocol and custom launchers: apply registry first, then launch protocol
            apply_launcher_registry(resolved_pref)?;
            launch_via_protocol(launch_args)?;
        }
    }

    Ok(None)
}

async fn install_roblox_for_launch(app: &tauri::AppHandle, version_hash: &str) -> Result<(), String> {
    use futures_util::StreamExt;
    
    let client = reqwest::Client::builder()
        .user_agent("RobloxBootstrapper")
        .build()
        .map_err(|e| format!("Failed to create reqwest client: {}", e))?;

    // Fetch package manifest
    let manifest_url = format!("{}/{}-rbxPkgManifest.txt", BOOTSTRAPPER_CDN, version_hash);
    let manifest_resp = client.get(&manifest_url).send().await.map_err(|e| format!("Failed to connect to manifest CDN: {}", e))?;
    if !manifest_resp.status().is_success() {
        return Err(format!("Manifest download HTTP error: {}", manifest_resp.status()));
    }
    let manifest_text = manifest_resp.text().await.map_err(|e| format!("Failed to read manifest body: {}", e))?;

    let lines: Vec<&str> = manifest_text.lines().collect();
    let mut packages: Vec<(String, String)> = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();
        if line.ends_with(".zip") || line.ends_with(".exe") || line.ends_with(".dll") {
            let md5_hash = if i + 1 < lines.len() { lines[i + 1].trim().to_string() } else { String::new() };
            packages.push((line.to_string(), md5_hash));
            i += 4;
        } else {
            i += 1;
        }
    }

    let zip_packages: Vec<&(String, String)> = packages.iter().filter(|(name, _)| name.ends_with(".zip")).collect();
    let total = zip_packages.len();
    if total == 0 {
        return Err("No packages found in manifest".into());
    }

    let install_dir = version_dir(version_hash);
    if install_dir.exists() {
        let _ = fs::remove_dir_all(&install_dir);
    }
    fs::create_dir_all(&install_dir).map_err(|e| format!("Failed to create installation directory: {}", e))?;

    for (idx, (pkg_name, _pkg_md5)) in zip_packages.iter().enumerate() {
        // Double check cancellation
        if app.get_webview_window("launch_progress").is_none() {
            return Err("Launch cancelled by user".into());
        }

        let _ = app.emit("launch-progress", LaunchProgressPayload {
            status: format!("Downloading {}...", pkg_name),
            percent: ((idx as f32 / total as f32) * 100.0) as u32,
        });

        let pkg_url = format!("{}/{}-{}", BOOTSTRAPPER_CDN, version_hash, pkg_name);
        let pkg_resp = client.get(&pkg_url).send().await.map_err(|e| format!("Download connect error for package '{}': {}", pkg_name, e))?;
        if !pkg_resp.status().is_success() {
            eprintln!("[WARNING] Skipping package '{}' (HTTP status {})", pkg_name, pkg_resp.status());
            continue;
        }

        let total_bytes = pkg_resp.content_length().unwrap_or(0);
        let mut bytes_buf: Vec<u8> = Vec::new();
        let mut stream = pkg_resp.bytes_stream();
        let start_time = std::time::Instant::now();

        while let Some(chunk) = stream.next().await {
            // Check cancellation during download
            if app.get_webview_window("launch_progress").is_none() {
                return Err("Launch cancelled by user".into());
            }

            let chunk = chunk.map_err(|e| format!("Error downloading stream chunk of package '{}': {}", pkg_name, e))?;
            bytes_buf.extend_from_slice(&chunk);

            let pct = if total_bytes > 0 {
                let pkg_pct = (bytes_buf.len() as f32 / total_bytes as f32) * 50.0;
                ((idx as f32 / total as f32) * 100.0 + (pkg_pct / total as f32)) as u32
            } else {
                ((idx as f32 / total as f32) * 100.0) as u32
            };

            let elapsed = start_time.elapsed().as_secs_f64().max(0.001);
            let speed_kbps = ((bytes_buf.len() as f64 / elapsed) / 1024.0) as u64;

            let status_str = if speed_kbps > 0 {
                format!("Downloading {} ({:.1}MB / {:.1}MB) - {} KB/s", pkg_name, (bytes_buf.len() as f32 / 1024.0 / 1024.0), (total_bytes as f32 / 1024.0 / 1024.0), speed_kbps)
            } else {
                format!("Downloading {}...", pkg_name)
            };

            let _ = app.emit("launch-progress", LaunchProgressPayload {
                status: status_str,
                percent: pct.min(99),
            });
        }

        // Check cancellation before extraction
        if app.get_webview_window("launch_progress").is_none() {
            return Err("Launch cancelled by user".into());
        }

        let _ = app.emit("launch-progress", LaunchProgressPayload {
            status: format!("Extracting {}...", pkg_name),
            percent: ((idx as f32 / total as f32) * 100.0 + (50.0 / total as f32)) as u32,
        });

        let cursor = std::io::Cursor::new(bytes_buf);
        let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to read zip archive for '{}': {}", pkg_name, e))?;
        let target_dir = install_dir.join(pkg_destination_dir(pkg_name));
        fs::create_dir_all(&target_dir).map_err(|e| format!("Failed to create subfolder directory: {}", e))?;

        let total_files = archive.len();
        for i in 0..total_files {
            // Check cancellation during extraction
            if i % 10 == 0 && app.get_webview_window("launch_progress").is_none() {
                return Err("Launch cancelled by user".into());
            }

            let mut file = archive.by_index(i).map_err(|e| format!("Failed to read index {} from archive of '{}': {}", i, pkg_name, e))?;
            let enclosed_path = match file.enclosed_name() {
                Some(p) => p.to_path_buf(),
                None => continue,
            };

            if enclosed_path.as_os_str().is_empty() || enclosed_path.to_string_lossy() == "/" {
                continue;
            }

            let out_path = target_dir.join(&enclosed_path);
            if file.name().ends_with('/') {
                fs::create_dir_all(&out_path).map_err(|e| format!("Failed to create subfolder: {}", e))?;
            } else {
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent: {}", e))?;
                }
                let mut outf = fs::File::create(&out_path).map_err(|e| format!("Failed to create target file: {}", e))?;
                std::io::copy(&mut file, &mut outf).map_err(|e| format!("Extraction copy failed: {}", e))?;
            }

            // Report extraction progress periodically to minimize IPC overhead
            if i % 10 == 0 || i == total_files - 1 {
                let ext_pct = 50.0 + (i as f32 / total_files as f32) * 50.0;
                let pct = ((idx as f32 / total as f32) * 100.0 + (ext_pct / total as f32)) as u32;

                let _ = app.emit("launch-progress", LaunchProgressPayload {
                    status: format!("Extracting {}...", pkg_name),
                    percent: pct.min(99),
                });
            }
        }
    }

    // Persist version hash
    write_installed_version(version_hash);

    // Apply existing FastFlags
    let ff_path = bootstrapper_root().join("fastflags.json");
    if ff_path.exists() {
        if let Ok(ff_content) = fs::read_to_string(&ff_path) {
            let client_settings_dir = install_dir.join("ClientSettings");
            let _ = fs::create_dir_all(&client_settings_dir);
            let _ = fs::write(client_settings_dir.join("ClientAppSettings.json"), &ff_content);
        }
    }

    // Register protocol handler
    let exe_path = install_dir.join("RobloxPlayerBeta.exe");
    if exe_path.exists() {
        let _ = bootstrapper_register_protocol_internal(&exe_path.to_string_lossy());
    }

    Ok(())
}

async fn ensure_latest_and_launch(
    app: &tauri::AppHandle,
    launch_args: &str,
    _multi_active: bool,
) -> Result<Option<u32>, String> {
    if let Some(existing) = app.get_webview_window("launch_progress") {
        let _ = existing.close();
        tokio::time::sleep(tokio::time::Duration::from_millis(150)).await;
    }

    let win = WebviewWindowBuilder::new(
        app,
        "launch_progress",
        WebviewUrl::App(std::path::PathBuf::from("index.html")),
    )
    .title("Reiya Launcher")
    .inner_size(480.0, 320.0)
    .decorations(false)
    .transparent(true)
    .resizable(false)
    .center()
    .initialization_script("window.history.replaceState(null, '', '/launch-progress');")
    .build()
    .map_err(|e| format!("Failed to create launch progress window: {}", e))?;

    let _ = win.show();
    let _ = win.set_focus();

    let _ = app.emit("launch-progress", LaunchProgressPayload {
        status: "Checking for updates...".into(),
        percent: 0,
    });

    if app.get_webview_window("launch_progress").is_none() {
        return Err("Launch cancelled by user".into());
    }

    let status = match bootstrapper_check_update().await {
        Ok(s) => s,
        Err(e) => {
            let _ = win.close();
            return Err(format!("Update check failed: {}", e));
        }
    };

    let installed_ver = if status.needs_update || status.exe_path.is_none() {
        let latest = status.latest_version.ok_or_else(|| "Could not resolve latest Roblox version".to_string())?;
        let install_res = install_roblox_for_launch(app, &latest).await;
        if let Err(e) = install_res {
            let _ = win.close();
            return Err(e);
        }
        latest
    } else {
        status.installed_version.ok_or_else(|| "Could not resolve installed Roblox version".to_string())?
    };

    if app.get_webview_window("launch_progress").is_none() {
        return Err("Launch cancelled by user".into());
    }

    let _ = app.emit("launch-progress", LaunchProgressPayload {
        status: "Configuring client settings...".into(),
        percent: 90,
    });

    let exe_dir = version_dir(&installed_ver);
    let exe = exe_dir.join("RobloxPlayerBeta.exe");
    if !exe.exists() {
        let _ = win.close();
        return Err(format!("Reiya executable not found at {}", exe.display()));
    }

    let _ = repair_bootstrapper_folders(&exe_dir);

    // Always re-apply FastFlags before launch so changes made in the UI
    // take effect even when Roblox is already up-to-date (no reinstall).
    let ff_path = bootstrapper_root().join("fastflags.json");
    if ff_path.exists() {
        if let Ok(ff_content) = fs::read_to_string(&ff_path) {
            let client_settings_dir = exe_dir.join("ClientSettings");
            let _ = fs::create_dir_all(&client_settings_dir);
            let _ = fs::write(client_settings_dir.join("ClientAppSettings.json"), &ff_content);
            eprintln!("[INFO] FastFlags applied to ClientSettings before launch.");
        }
    }

    if app.get_webview_window("launch_progress").is_none() {
        return Err("Launch cancelled by user".into());
    }

    let _ = app.emit("launch-progress", LaunchProgressPayload {
        status: "Starting Roblox...".into(),
        percent: 95,
    });

    let pid = match launch_detached(&exe, launch_args) {
        Ok(p) => p,
        Err(e) => {
            let _ = win.close();
            return Err(e);
        }
    };

    let _ = app.emit("launch-progress", LaunchProgressPayload {
        status: "Roblox started successfully".into(),
        percent: 100,
    });

    tokio::time::sleep(tokio::time::Duration::from_millis(3000)).await;
    let _ = win.close();

    Ok(pid)
}

#[tauri::command]
fn get_launcher_preference() -> String {
    read_launcher_preference()
}

#[tauri::command]
fn set_launcher_preference(kind: String) -> Result<(), String> {
    // Write registry key first if supported
    let _ = apply_launcher_registry(&kind);

    let settings_path = data_dir().join("settings.json");
    let mut val: serde_json::Value = if settings_path.exists() {
        fs::read_to_string(&settings_path)
            .ok()
            .and_then(|c| serde_json::from_str(clean_bom(&c)).ok())
            .unwrap_or_else(|| serde_json::json!({}))
    } else {
        serde_json::json!({})
    };
    val["PreferredLauncher"] = serde_json::Value::String(kind);
    let s = serde_json::to_string_pretty(&val).map_err(|e| e.to_string())?;
    fs::write(&settings_path, s).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_account_cookie(user_id: i64) -> Result<String, String> {
    let accounts = load_stored();
    let account = accounts
        .iter()
        .find(|a| a.user_id == user_id)
        .ok_or_else(|| "Account not found".to_string())?;
    let decrypted = decrypt_cookie(&account.encrypted_cookie)?;
    Ok(decrypted)
}

#[tauri::command]
fn save_account_password(user_id: i64, password: String) -> Result<(), String> {
    let mut accounts = load_stored();
    let account = accounts
        .iter_mut()
        .find(|a| a.user_id == user_id)
        .ok_or_else(|| "Account not found".to_string())?;
    account.password = if password.is_empty() { None } else { Some(password) };
    save_stored(&accounts);
    Ok(())
}

#[tauri::command]
fn set_account_group(user_id: i64, group: String) -> Result<(), String> {
    let mut accounts = load_stored();
    let account = accounts
        .iter_mut()
        .find(|a| a.user_id == user_id)
        .ok_or_else(|| "Account not found".to_string())?;
    account.group = if group.trim().is_empty() { None } else { Some(group.trim().to_string()) };
    save_stored(&accounts);
    Ok(())
}

#[tauri::command]
async fn check_account_health(user_id: i64) -> Result<String, String> {
    let accounts = load_stored();
    let account = accounts
        .iter()
        .find(|a| a.user_id == user_id)
        .ok_or_else(|| "Account not found".to_string())?;
    let cookie = decrypt_cookie(&account.encrypted_cookie)?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get("https://users.roblox.com/v1/users/authenticated")
        .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if resp.status().is_success() {
        Ok("Valid".to_string())
    } else {
        Ok("Invalid".to_string())
    }
}

// ── License / Key System ──────────────────────────────────────────────────────

fn license_path() -> std::path::PathBuf { data_dir().join("license.json") }

#[derive(Serialize, Deserialize, Default, Clone)]
struct LicenseStore {
    key: String,
    expires_at: Option<String>,
    validated_at: Option<String>,
}

fn load_license() -> LicenseStore {
    fs::read_to_string(license_path())
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_license(store: &LicenseStore) {
    if let Ok(s) = serde_json::to_string_pretty(store) {
        let _ = fs::write(license_path(), s);
    }
}

#[derive(Serialize)]
struct LicenseStatus {
    needs_key: bool,
    key: String,
    expires_at: Option<String>,
    reason: String,
}

fn compute_hwid() -> String {
    #[cfg(target_os = "windows")]
    {
        use winreg::{enums::HKEY_LOCAL_MACHINE, RegKey};
        if let Ok(k) = RegKey::predef(HKEY_LOCAL_MACHINE).open_subkey(r"SOFTWARE\Microsoft\Cryptography") {
            if let Ok(guid) = k.get_value::<String, _>("MachineGuid") {
                use sha2::{Digest, Sha256};
                return format!("{:x}", Sha256::digest(guid.as_bytes()));
            }
        }
    }
    let host = hostname::get().ok()
        .and_then(|h| h.into_string().ok())
        .unwrap_or_else(|| "unknown".to_string());
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(host.as_bytes()))
}

#[tauri::command]
fn check_license() -> LicenseStatus {
    let store = load_license();
    if store.key.is_empty() {
        return LicenseStatus { needs_key: true, key: String::new(), expires_at: None, reason: "missing".into() };
    }
    if let Some(exp_str) = &store.expires_at {
        if let Ok(exp) = chrono::DateTime::parse_from_rfc3339(exp_str) {
            if exp.with_timezone(&Utc) < Utc::now() {
                return LicenseStatus { needs_key: true, key: store.key, expires_at: store.expires_at, reason: "expired".into() };
            }
        }
    }
    LicenseStatus { needs_key: false, key: store.key, expires_at: store.expires_at, reason: "valid".into() }
}

const SUPABASE_URL: &str = "https://lpxhbjhkfimzjnuickji.supabase.co";
const SUPABASE_ANON: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.\
eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxweGhiamhrZmltempudWlja2ppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAxMjQwODIsImV4cCI6MjA5NTcwMDA4Mn0.\
DP7MYXDYqHOsdNjL8eM7g7oexkJFvbf42MDYA007reE";

#[tauri::command]
async fn validate_license_key(key: String) -> Result<LicenseStatus, String> {
    let hwid = compute_hwid();
    let body = serde_json::json!({ "key": key.trim(), "hwid": hwid });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .post(format!("{}/functions/v1/validate-key", SUPABASE_URL))
        .header("Authorization", format!("Bearer {}", SUPABASE_ANON))
        .header("Content-Type", "application/json")
        .header("User-Agent", "ReiyaAccountManager")
        .json(&body)
        .send()
        .await
        .map_err(|_| "Could not connect to key server. Check your internet connection.".to_string())?;

    let json: serde_json::Value = resp.json().await
        .map_err(|_| "Invalid response from key server.".to_string())?;

    let valid = json.get("valid").and_then(|v| v.as_bool()).unwrap_or(false);

    if valid {
        let expires_at = json.get("expires_at").and_then(|v| v.as_str()).map(String::from);
        let store = LicenseStore {
            key: key.trim().to_string(),
            expires_at: expires_at.clone(),
            validated_at: Some(Utc::now().to_rfc3339()),
        };
        save_license(&store);
        Ok(LicenseStatus { needs_key: false, key: key.trim().to_string(), expires_at, reason: "valid".into() })
    } else {
        let msg = json.get("message").and_then(|v| v.as_str()).unwrap_or("").to_string();
        let friendly = match msg.as_str() {
            "Key expired"                         => "Your key has expired. Get a new one from the website.".to_string(),
            "Key is locked to a different device" => "This key is registered to a different device.".to_string(),
            "Invalid key"                         => "Invalid key. Please check and try again.".to_string(),
            "Missing key or hwid"                 => "Validation error. Please try again.".to_string(),
            other if !other.is_empty()            => other.to_string(),
            _                                     => "Key validation failed. Please try again.".to_string(),
        };
        Err(friendly)
    }
}

#[tauri::command]
fn clear_license() -> Result<(), String> {
    let _ = fs::remove_file(license_path());
    Ok(())
}

#[tauri::command]
fn open_key_website() -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/c", "start", "", "https://seistem.vercel.app/"])
            .spawn();
    }
    Ok(())
}

#[tauri::command]
fn get_hwid() -> String { compute_hwid() }

// ── In-app updater ────────────────────────────────────────────────────────────

const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
const GITHUB_RELEASES_API: &str = "https://api.github.com/repos/Seisen88/Key-System/releases/latest";

#[derive(serde::Serialize, Clone)]
struct UpdateInfo {
    has_update:   bool,
    version:      String,
    download_url: String,
    notes:        String,
    current:      String,
}

fn version_is_newer(latest: &str, current: &str) -> bool {
    let parse = |v: &str| -> (u64, u64, u64) {
        let p: Vec<&str> = v.trim_start_matches('v').split('.').collect();
        let n = |i: usize| p.get(i).and_then(|s| s.parse().ok()).unwrap_or(0);
        (n(0), n(1), n(2))
    };
    parse(latest) > parse(current)
}

#[tauri::command]
async fn check_for_update() -> Result<UpdateInfo, String> {
    #[cfg(debug_assertions)]
    return Ok(UpdateInfo { has_update: false, version: String::new(), download_url: String::new(), notes: String::new(), current: APP_VERSION.to_string() });

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("ReiyaAccountManager")
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client
        .get(GITHUB_RELEASES_API)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;

    let tag_name = json["tag_name"].as_str().unwrap_or("");
    let latest_ver = tag_name.trim_start_matches('v').to_string();

    let download_url = json["assets"]
        .as_array()
        .and_then(|arr| arr.iter().find(|a| {
            a["name"].as_str().map(|n| n.ends_with(".exe")).unwrap_or(false)
        }))
        .and_then(|a| a["browser_download_url"].as_str())
        .unwrap_or("")
        .to_string();

    let notes      = json["body"].as_str().unwrap_or("").to_string();
    let has_update = !latest_ver.is_empty() && version_is_newer(&latest_ver, APP_VERSION);

    Ok(UpdateInfo { has_update, version: latest_ver, download_url, notes, current: APP_VERSION.to_string() })
}

#[tauri::command]
async fn download_and_install_update(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use futures_util::StreamExt;
    use tokio::io::AsyncWriteExt;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;

    let resp = client.get(&url).send().await.map_err(|e| e.to_string())?;
    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;
    let mut stream = resp.bytes_stream();

    let tmp_path = std::env::temp_dir().join("ReiyaAccountManager-update.exe");
    let mut file = tokio::fs::File::create(&tmp_path).await.map_err(|e| e.to_string())?;

    // Phase 1 — Download (0 → 85%)
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(|e| e.to_string())?;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        let percent = if total > 0 { ((downloaded * 85) / total) as u32 } else { 0 };
        app.emit("update-progress", serde_json::json!({
            "downloaded": downloaded,
            "total":      total,
            "percent":    percent,
            "phase":      "downloading",
        })).ok();
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    // Phase 2 — Installing (85 → 99%, animated)
    for p in 85u32..=99 {
        app.emit("update-progress", serde_json::json!({
            "downloaded": total,
            "total":      total,
            "percent":    p,
            "phase":      "installing",
        })).ok();
        tokio::time::sleep(tokio::time::Duration::from_millis(60)).await;
    }

    // Get current exe so the helper can relaunch it after install
    let current_exe = std::env::current_exe().map_err(|e| e.to_string())?;

    // Write a detached helper script:
    //   1. Wait for this process to exit
    //   2. Run installer silently
    //   3. Wait for installer to finish
    //   4. Relaunch the updated binary
    let script = format!(
        "@echo off\r\ntimeout /t 3 /nobreak >nul\r\nstart /wait \"\" \"{}\" /S\r\nstart \"\" \"{}\"\r\ndel \"%~0\"\r\n",
        tmp_path.display(),
        current_exe.display(),
    );
    let script_path = std::env::temp_dir().join("reiya_updater.bat");
    std::fs::write(&script_path, &script).map_err(|e| e.to_string())?;

    // Phase 3 — Done (100%)
    app.emit("update-progress", serde_json::json!({
        "downloaded": total,
        "total":      total,
        "percent":    100,
        "phase":      "done",
    })).ok();

    tokio::time::sleep(tokio::time::Duration::from_millis(1200)).await;

    // Spawn helper hidden, then exit so installer can replace our binary
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        std::process::Command::new("cmd")
            .args(["/C", &script_path.to_string_lossy().into_owned()])
            .creation_flags(0x08000000) // CREATE_NO_WINDOW
            .spawn()
            .map_err(|e| format!("Failed to start updater helper: {}", e))?;
    }

    std::process::exit(0);
}

#[tauri::command]
fn get_app_version() -> String { APP_VERSION.to_string() }

#[tauri::command]
fn edit_account(
    user_id: i64,
    display_name: String,
    notes: String,
    tags: Vec<String>,
    default_place_id: String,
    safe_launch_enabled: bool,
    auto_rejoin_enabled: bool,
    launch_cooldown_seconds: i32,
) -> Result<AccountDto, String> {
    let mut accounts = load_stored();
    let account = accounts
        .iter_mut()
        .find(|a| a.user_id == user_id)
        .ok_or_else(|| "Account not found".to_string())?;

    account.display_name = if display_name.trim().is_empty() {
        account.username.clone()
    } else {
        display_name.trim().to_string()
    };
    account.notes = notes;
    account.tags = tags;
    account.default_place_id = default_place_id;
    account.safe_launch_enabled = safe_launch_enabled;
    account.auto_rejoin_enabled = auto_rejoin_enabled;
    account.launch_cooldown_seconds = launch_cooldown_seconds;

    let dto = to_dto(account);
    save_stored(&accounts);
    Ok(dto)
}

#[tauri::command]
async fn get_auth_ticket_command(user_id: i64) -> Result<String, String> {
    let accounts = load_stored();
    let account = accounts
        .iter()
        .find(|a| a.user_id == user_id)
        .ok_or_else(|| "Account not found".to_string())?;
    let cookie = decrypt_cookie(&account.encrypted_cookie)?;
    let ticket = get_auth_ticket(&cookie)
        .await
        .ok_or_else(|| "Failed to retrieve authentication ticket. Cookie may be invalid.".to_string())?;
    Ok(ticket)
}

#[derive(Serialize, Deserialize, Clone)]
pub struct RecentGameDto {
    #[serde(rename = "placeId")]
    pub place_id: String,
    pub name: String,
    pub creator: String,
    #[serde(rename = "iconUrl")]
    pub icon_url: String,
    #[serde(rename = "playedAt")]
    pub played_at: String,
    #[serde(alias = "PrivateServer", rename = "privateServer", default)]
    pub private_server: Option<String>,
}

#[tauri::command]
fn get_recent_games() -> Vec<RecentGameDto> {
    let settings_path = data_dir().join("settings.json");
    if !settings_path.exists() {
        return vec![];
    }
    let Ok(content) = fs::read_to_string(settings_path) else { return vec![]; };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(clean_bom(&content)) else { return vec![]; };
    let mut list = Vec::new();
    if let Some(recents) = val["RecentGames"].as_array() {
        for r in recents {
            let place_id = r["PlaceId"].as_str().map(|s| s.to_string())
                .or_else(|| r["PlaceId"].as_i64().map(|n| n.to_string()))
                .unwrap_or_default();
            let name = r["Name"].as_str().unwrap_or_default().to_string();
            let creator = r["Creator"].as_str().unwrap_or_default().to_string();
            let icon_url = r["IconUrl"].as_str().unwrap_or_default().to_string();
            let played_at = r["PlayedAt"].as_str().unwrap_or_default().to_string();
            let private_server = r["PrivateServer"].as_str().map(|s| s.to_string());
            if !place_id.is_empty() {
                list.push(RecentGameDto {
                    place_id,
                    name,
                    creator,
                    icon_url,
                    played_at,
                    private_server,
                });
            }
        }
    }
    list
}

#[tauri::command]
fn save_favorites(favorites: Vec<FavoriteGameDto>) -> Result<(), String> {
    let settings_path = data_dir().join("settings.json");
    if !settings_path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let mut val: serde_json::Value = serde_json::from_str(&clean_bom(&content)).map_err(|e| e.to_string())?;

    let mut favs_val = Vec::new();
    for f in favorites {
        favs_val.push(serde_json::json!({
            "PlaceId": f.place_id,
            "Name": f.name,
            "Creator": f.creator,
            "IconUrl": f.icon_url,
            "PlayedAt": Utc::now().to_rfc3339(),
            "PrivateServer": f.private_server
        }));
    }

    val["FavoriteGames"] = serde_json::Value::Array(favs_val);

    if let Ok(s) = serde_json::to_string_pretty(&val) {
        let _ = fs::write(&settings_path, s);
    }
    Ok(())
}

async fn add_recent_game_internal(place_id_str: &str) -> Result<(), String> {
    let place_id_val = place_id_str.trim();
    if place_id_val.is_empty() {
        return Ok(());
    }
    let parsed_id = place_id_val.parse::<i64>().map_err(|e| e.to_string())?;

    let details = fetch_place_details(parsed_id).await.unwrap_or_else(|_| RobloxGameResultDto {
        name: format!("Place ID {}", place_id_val),
        place_id: parsed_id,
        universe_id: 0,
        creator_name: "Unknown".to_string(),
        icon_url: String::new(),
    });

    let settings_path = data_dir().join("settings.json");
    if !settings_path.exists() {
        return Ok(());
    }
    let content = fs::read_to_string(&settings_path).map_err(|e| e.to_string())?;
    let mut val: serde_json::Value = serde_json::from_str(&clean_bom(&content)).map_err(|e| e.to_string())?;

    let played_at_str = Utc::now().to_rfc3339();

    let mut recent_games_list = if let Some(arr) = val.get_mut("RecentGames").and_then(|v| v.as_array_mut()) {
        arr.clone()
    } else {
        vec![]
    };

    let mut found_idx = None;
    for (idx, game) in recent_games_list.iter().enumerate() {
        if let Some(pid) = game.get("PlaceId").and_then(|v| v.as_str()) {
            if pid == place_id_val {
                found_idx = Some(idx);
                break;
            }
        }
    }

    if let Some(idx) = found_idx {
        recent_games_list[idx]["PlayedAt"] = serde_json::json!(played_at_str);
    } else {
        let new_item = serde_json::json!({
            "PlaceId": place_id_val,
            "Name": details.name,
            "Creator": details.creator_name,
            "IconUrl": details.icon_url,
            "PlayedAt": played_at_str
        });
        recent_games_list.push(new_item);
    }

    recent_games_list.sort_by(|a, b| {
        let t_a = a.get("PlayedAt").and_then(|v| v.as_str()).unwrap_or("");
        let t_b = b.get("PlayedAt").and_then(|v| v.as_str()).unwrap_or("");
        t_b.cmp(t_a)
    });

    recent_games_list.truncate(20);

    val["RecentGames"] = serde_json::Value::Array(recent_games_list);

    if let Ok(s) = serde_json::to_string_pretty(&val) {
        let _ = fs::write(&settings_path, s);
    }

    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FavoriteGameDto {
    #[serde(rename = "placeId")]
    pub place_id: String,
    pub name: String,
    pub creator: String,
    #[serde(rename = "iconUrl")]
    pub icon_url: String,
    #[serde(alias = "PrivateServer", rename = "privateServer", default)]
    pub private_server: Option<String>,
}

#[tauri::command]
fn get_legacy_favorites() -> Vec<FavoriteGameDto> {
    let settings_path = data_dir().join("settings.json");
    if !settings_path.exists() {
        return vec![];
    }
    let Ok(content) = fs::read_to_string(settings_path) else { return vec![]; };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(clean_bom(&content)) else { return vec![]; };
    let mut list = Vec::new();
    if let Some(favs) = val["FavoriteGames"].as_array() {
        for f in favs {
            let place_id = f["PlaceId"].as_str().map(|s| s.to_string())
                .or_else(|| f["PlaceId"].as_i64().map(|n| n.to_string()))
                .unwrap_or_default();
            let name = f["Name"].as_str().unwrap_or_default().to_string();
            let creator = f["Creator"].as_str().unwrap_or_default().to_string();
            let icon_url = f["IconUrl"].as_str().unwrap_or_default().to_string();
            let private_server = f["PrivateServer"].as_str().map(|s| s.to_string());
            if !place_id.is_empty() {
                list.push(FavoriteGameDto {
                    place_id,
                    name,
                    creator,
                    icon_url,
                    private_server,
                });
            }
        }
    }
    list
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

// ══════════════════════════════════════════════════════════════════════════════
// Custom Bootstrapper — Download, Install, FastFlags
// ══════════════════════════════════════════════════════════════════════════════

const BOOTSTRAPPER_CDN: &str = "https://setup.rbxcdn.com";
const VERSION_API: &str = "https://clientsettingscdn.roblox.com/v2/client-version/WindowsPlayer";

/// Returns the Reiya bootstrapper install root: %LOCALAPPDATA%\Seistem
fn bootstrapper_root() -> PathBuf {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_else(|_| ".".to_string());
    let dir = PathBuf::from(local).join("Seistem");
    let _ = fs::create_dir_all(&dir);
    dir
}
/// Returns the active versions folder.
fn versions_dir() -> PathBuf {
    let d = bootstrapper_root().join("Versions");
    let _ = fs::create_dir_all(&d);
    d
}

/// Returns the install path for a specific version hash.
fn version_dir(hash: &str) -> PathBuf {
    versions_dir().join(hash)
}

/// Persist which version hash is currently installed.
fn installed_version_path() -> PathBuf {
    bootstrapper_root().join("version.txt")
}

fn read_installed_version() -> Option<String> {
    fs::read_to_string(installed_version_path()).ok().map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

fn write_installed_version(hash: &str) {
    let _ = fs::write(installed_version_path(), hash);
}

#[derive(Serialize, Deserialize)]
pub struct BootstrapperStatus {
    pub installed_version: Option<String>,
    pub latest_version: Option<String>,
    pub install_path: String,
    pub needs_update: bool,
    pub exe_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct BootstrapperProgress {
    pub stage: String,
    pub package: String,
    pub package_index: usize,
    pub total_packages: usize,
    pub percent: u32,
    pub speed_kbps: u64,
    pub done: bool,
    pub error: Option<String>,
}

#[tauri::command]
async fn bootstrapper_check_update() -> Result<BootstrapperStatus, String> {
    let client = reqwest::Client::builder().user_agent("RobloxBootstrapper").build().map_err(|e| e.to_string())?;
    let resp = client.get(VERSION_API).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("Version API error: {}", resp.status()));
    }
    let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
    let latest = json["clientVersionUpload"].as_str().unwrap_or("").to_string();
    let installed = read_installed_version();
    let needs_update = installed.as_deref().map_or(true, |v| v != latest);
    let install_path = versions_dir().to_string_lossy().to_string();
    let exe_path = installed.as_ref().map(|v| {
        version_dir(v).join("RobloxPlayerBeta.exe").to_string_lossy().to_string()
    }).filter(|p| std::path::Path::new(p).exists());

    Ok(BootstrapperStatus {
        installed_version: installed,
        latest_version: Some(latest),
        install_path,
        needs_update,
        exe_path,
    })
}

#[tauri::command]
async fn bootstrapper_get_status() -> BootstrapperStatus {
    let installed = read_installed_version();
    let install_path = versions_dir().to_string_lossy().to_string();
    let exe_path = installed.as_ref().map(|v| {
        version_dir(v).join("RobloxPlayerBeta.exe").to_string_lossy().to_string()
    }).filter(|p| std::path::Path::new(p).exists());
    BootstrapperStatus {
        needs_update: exe_path.is_none(),
        latest_version: None,
        installed_version: installed,
        install_path,
        exe_path,
    }
}

fn pkg_destination_dir(pkg_name: &str) -> String {
    let name = pkg_name.to_lowercase();
    if name == "content-platform-dictionaries.zip" {
        "PlatformContent/pc/shared_compression_dictionaries".to_string()
    } else if name == "content-platform-fonts.zip" || name == "content-fonts.zip" {
        "PlatformContent/pc/fonts".to_string()
    } else if name == "content-terrain.zip" {
        "PlatformContent/pc/terrain".to_string()
    } else if name.starts_with("content-") {
        let suffix = name.trim_start_matches("content-").trim_end_matches(".zip");
        // Strip trailing digits (e.g. textures2 -> textures)
        let clean_suffix = suffix.trim_end_matches(|c: char| c.is_ascii_digit());
        format!("content/{}", clean_suffix)
    } else if name.starts_with("extracontent-") {
        let suffix = name.trim_start_matches("extracontent-").trim_end_matches(".zip");
        match suffix {
            "luapackages" => "ExtraContent/LuaPackages".to_string(),
            "translationtab" | "translations" => "ExtraContent/translationTab".to_string(),
            "models" => "ExtraContent/models".to_string(),
            _ => format!("ExtraContent/{}", suffix)
        }
    } else if name == "shaders.zip" {
        "shaders".to_string()
    } else if name == "ssl.zip" {
        "ssl".to_string()
    } else {
        "".to_string()
    }
}

fn copy_dir_all(src: &std::path::Path, dst: &std::path::Path) -> std::io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let ty = entry.file_type()?;
        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.join(entry.file_name()))?;
        }
    }
    Ok(())
}

fn repair_bootstrapper_folders(version_dir: &std::path::Path) -> Result<(), String> {
    eprintln!("[INFO repair_bootstrapper_folders] Checking Reiya version directory structure: {:?}", version_dir);
    // 1. Write AppSettings.xml if missing
    let app_settings_path = version_dir.join("AppSettings.xml");
    if !app_settings_path.exists() {
        let app_settings_content = r#"<?xml version="1.0" encoding="UTF-8"?>
<Settings>
	<ContentFolder>content</ContentFolder>
	<BaseUrl>http://www.roblox.com</BaseUrl>
</Settings>
"#;
        if let Err(e) = fs::write(&app_settings_path, app_settings_content) {
            eprintln!("[WARNING repair_bootstrapper_folders] Failed to write AppSettings.xml: {}", e);
        } else {
            eprintln!("[INFO repair_bootstrapper_folders] Wrote missing AppSettings.xml");
        }
    }

    // 2. Ensure PlatformContent/pc directories exist
    let pc_dir = version_dir.join("PlatformContent").join("pc");
    let _ = fs::create_dir_all(&pc_dir);

    // 3. Move misplaced folders if they exist in content/
    let content_dir = version_dir.join("content");

    // Move content/platform-dictionaries -> PlatformContent/pc/shared_compression_dictionaries
    let src_dict = content_dir.join("platform-dictionaries");
    let dest_dict = pc_dir.join("shared_compression_dictionaries");
    if src_dict.exists() && !dest_dict.exists() {
        if let Err(e) = fs::rename(&src_dict, &dest_dict) {
            eprintln!("[WARNING repair_bootstrapper_folders] Failed to rename platform-dictionaries: {}", e);
        } else {
            eprintln!("[INFO repair_bootstrapper_folders] Moved platform-dictionaries to shared_compression_dictionaries");
        }
    }

    // Move content/platform-fonts -> PlatformContent/pc/fonts
    let src_pfonts = content_dir.join("platform-fonts");
    let dest_fonts = pc_dir.join("fonts");
    if src_pfonts.exists() && !dest_fonts.exists() {
        if let Err(e) = fs::rename(&src_pfonts, &dest_fonts) {
            eprintln!("[WARNING repair_bootstrapper_folders] Failed to rename platform-fonts: {}", e);
        } else {
            eprintln!("[INFO repair_bootstrapper_folders] Moved platform-fonts to fonts");
        }
    }

    // Move content/terrain -> PlatformContent/pc/terrain
    let src_terrain = content_dir.join("terrain");
    let dest_terrain = pc_dir.join("terrain");
    if src_terrain.exists() && !dest_terrain.exists() {
        if let Err(e) = fs::rename(&src_terrain, &dest_terrain) {
            eprintln!("[WARNING repair_bootstrapper_folders] Failed to rename terrain: {}", e);
        } else {
            eprintln!("[INFO repair_bootstrapper_folders] Moved terrain to pc/terrain");
        }
    }

    // 4. Copy missing folders from official Roblox directory if available
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let roblox_versions_dir = std::path::Path::new(&local).join("Roblox").join("Versions");
        if let Some(official_exe) = search_versions_dir(&roblox_versions_dir) {
            if let Some(official_version_dir) = official_exe.parent() {
                let official_pc_dir = official_version_dir.join("PlatformContent").join("pc");
                if official_pc_dir.exists() {
                    // Copy shared_compression_dictionaries if missing
                    let dest_dict = pc_dir.join("shared_compression_dictionaries");
                    if !dest_dict.exists() {
                        let src = official_pc_dir.join("shared_compression_dictionaries");
                        if src.exists() {
                            let _ = copy_dir_all(&src, &dest_dict);
                            eprintln!("[INFO repair_bootstrapper_folders] Copied shared_compression_dictionaries from official Roblox");
                        }
                    }
                    // Copy fonts if missing
                    let dest_fonts = pc_dir.join("fonts");
                    if !dest_fonts.exists() {
                        let src = official_pc_dir.join("fonts");
                        if src.exists() {
                            let _ = copy_dir_all(&src, &dest_fonts);
                            eprintln!("[INFO repair_bootstrapper_folders] Copied fonts from official Roblox");
                        }
                    }
                    // Copy terrain if missing
                    let dest_terrain = pc_dir.join("terrain");
                    if !dest_terrain.exists() {
                        let src = official_pc_dir.join("terrain");
                        if src.exists() {
                            let _ = copy_dir_all(&src, &dest_terrain);
                            eprintln!("[INFO repair_bootstrapper_folders] Copied terrain from official Roblox");
                        }
                    }
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
async fn bootstrapper_install(app: AppHandle) -> Result<(), String> {
    eprintln!("[INFO bootstrapper_install] Starting Reiya bootstrapper installation...");
    let res = bootstrapper_install_impl(app.clone()).await;
    if let Err(ref e) = res {
        eprintln!("[ERROR bootstrapper_install] Installation failed: {}", e);
        let _ = app.emit("bootstrapper-progress", BootstrapperProgress {
            stage: "Error".into(),
            package: String::new(),
            package_index: 0,
            total_packages: 0,
            percent: 0,
            speed_kbps: 0,
            done: true,
            error: Some(e.clone()),
        });
    } else {
        eprintln!("[INFO bootstrapper_install] Installation completed successfully.");
    }
    res
}

async fn bootstrapper_install_impl(app: AppHandle) -> Result<(), String> {
    let client = reqwest::Client::builder()
        .user_agent("RobloxBootstrapper")
        .build()
        .map_err(|e| format!("Failed to create reqwest client: {}", e))?;

    // 1. Get latest version hash
    eprintln!("[INFO bootstrapper_install] Fetching latest client version from: {}", VERSION_API);
    let resp = client.get(VERSION_API).send().await.map_err(|e| format!("Failed to connect to version API: {}", e))?;
    let json: serde_json::Value = resp.json().await.map_err(|e| format!("Failed to parse version JSON: {}", e))?;
    let version_hash = json["clientVersionUpload"].as_str().unwrap_or("").to_string();
    if version_hash.is_empty() {
        return Err("Roblox API returned empty version hash".into());
    }
    eprintln!("[INFO bootstrapper_install] Latest version hash resolved: {}", version_hash);

    // 2. Fetch package manifest
    let manifest_url = format!("{}/{}-rbxPkgManifest.txt", BOOTSTRAPPER_CDN, version_hash);
    eprintln!("[INFO bootstrapper_install] Downloading package manifest from: {}", manifest_url);
    let manifest_resp = client.get(&manifest_url).send().await.map_err(|e| format!("Failed to connect to manifest CDN: {}", e))?;
    if !manifest_resp.status().is_success() {
        return Err(format!("Manifest download HTTP error: {}", manifest_resp.status()));
    }
    let manifest_text = manifest_resp.text().await.map_err(|e| format!("Failed to read manifest body: {}", e))?;

    // Parse manifest — each entry is 4 lines: filename, md5, compressed_size, size
    let lines: Vec<&str> = manifest_text.lines().collect();
    let mut packages: Vec<(String, String)> = Vec::new(); // (filename, md5)
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();
        if line.ends_with(".zip") || line.ends_with(".exe") || line.ends_with(".dll") {
            let md5_hash = if i + 1 < lines.len() { lines[i + 1].trim().to_string() } else { String::new() };
            packages.push((line.to_string(), md5_hash));
            i += 4;
        } else {
            i += 1;
        }
    }
    eprintln!("[INFO bootstrapper_install] Parsed manifest, found {} total packages.", packages.len());

    let install_dir = version_dir(&version_hash);
    eprintln!("[INFO bootstrapper_install] Target installation directory: {:?}", install_dir);
    if install_dir.exists() {
        let _ = fs::remove_dir_all(&install_dir);
    }
    fs::create_dir_all(&install_dir).map_err(|e| format!("Failed to create installation directory: {}", e))?;
    let total = packages.len();

    for (idx, (pkg_name, _pkg_md5)) in packages.iter().enumerate() {
        // Skip non-zip (we only need packages for the player)
        if !pkg_name.ends_with(".zip") {
            continue;
        }

        // Emit start
        let _ = app.emit("bootstrapper-progress", BootstrapperProgress {
            stage: "Downloading".into(),
            package: pkg_name.clone(),
            package_index: idx + 1,
            total_packages: total,
            percent: ((idx as f32 / total as f32) * 100.0) as u32,
            speed_kbps: 0,
            done: false,
            error: None,
        });

        let pkg_url = format!("{}/{}-{}", BOOTSTRAPPER_CDN, version_hash, pkg_name);
        let pkg_resp = client.get(&pkg_url).send().await.map_err(|e| format!("Download connect error for package '{}': {}", pkg_name, e))?;
        if !pkg_resp.status().is_success() {
            eprintln!("[WARNING bootstrapper_install] Skipping package '{}' (HTTP status {})", pkg_name, pkg_resp.status());
            continue;
        }

        // Stream download to memory with speed tracking
        let mut bytes_buf: Vec<u8> = Vec::new();
        let mut stream = pkg_resp.bytes_stream();
        let start_time = std::time::Instant::now();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("Error downloading stream chunk of package '{}': {}", pkg_name, e))?;
            bytes_buf.extend_from_slice(&chunk);
        }
        let elapsed = start_time.elapsed().as_secs_f64().max(0.001);
        let speed_kbps = ((bytes_buf.len() as f64 / elapsed) / 1024.0) as u64;

        // Extract zip into install_dir + mapped subdirectory
        let _ = app.emit("bootstrapper-progress", BootstrapperProgress {
            stage: "Extracting".into(),
            package: pkg_name.clone(),
            package_index: idx + 1,
            total_packages: total,
            percent: ((idx as f32 / total as f32) * 100.0) as u32,
            speed_kbps,
            done: false,
            error: None,
        });

        let cursor = std::io::Cursor::new(bytes_buf);
        let mut archive = zip::ZipArchive::new(cursor).map_err(|e| format!("Failed to read zip archive for '{}': {}", pkg_name, e))?;
        let target_dir = install_dir.join(pkg_destination_dir(pkg_name));
        fs::create_dir_all(&target_dir).map_err(|e| format!("Failed to create subfolder directory: {}", e))?;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).map_err(|e| format!("Failed to read index {} from archive of '{}': {}", i, pkg_name, e))?;
            
            let enclosed_path = match file.enclosed_name() {
                Some(p) => p.to_path_buf(),
                None => {
                    eprintln!("[WARNING bootstrapper_install] Skipping unsafe zip entry: {}", file.name());
                    continue;
                }
            };

            if enclosed_path.as_os_str().is_empty() || enclosed_path.to_string_lossy() == "/" {
                continue;
            }

            let out_path = target_dir.join(&enclosed_path);
            if file.name().ends_with('/') {
                fs::create_dir_all(&out_path).map_err(|e| format!("Failed to create subfolder during extraction '{:?}': {}", out_path, e))?;
            } else {
                if let Some(parent) = out_path.parent() {
                    fs::create_dir_all(parent).map_err(|e| format!("Failed to create parent folder structure '{:?}': {}", parent, e))?;
                }
                let mut outf = fs::File::create(&out_path).map_err(|e| format!("Failed to create target file '{:?}': {}", out_path, e))?;
                std::io::copy(&mut file, &mut outf).map_err(|e| format!("Extraction copy failed for '{:?}': {}", out_path, e))?;
            }
        }
    }

    // Persist installed version
    eprintln!("[INFO bootstrapper_install] Persisting version hash...");
    write_installed_version(&version_hash);

    // Apply any existing FastFlags
    let ff_path = bootstrapper_root().join("fastflags.json");
    if ff_path.exists() {
        if let Ok(ff_content) = fs::read_to_string(&ff_path) {
            let client_settings_dir = install_dir.join("ClientSettings");
            fs::create_dir_all(&client_settings_dir).map_err(|e| format!("Failed to create ClientSettings directory: {}", e))?;
            fs::write(client_settings_dir.join("ClientAppSettings.json"), &ff_content).map_err(|e| format!("Failed to write ClientAppSettings: {}", e))?;
            eprintln!("[INFO bootstrapper_install] Applied FastFlags.");
        }
    }

    // Register protocol handler
    let exe_path = install_dir.join("RobloxPlayerBeta.exe");
    if exe_path.exists() {
        eprintln!("[INFO bootstrapper_install] Registering RobloxPlayerBeta protocol handler...");
        bootstrapper_register_protocol_internal(&exe_path.to_string_lossy())?;
    } else {
        return Err("RobloxPlayerBeta.exe was not created or found after extraction".into());
    }

    let _ = app.emit("bootstrapper-progress", BootstrapperProgress {
        stage: "Complete".into(),
        package: String::new(),
        package_index: total,
        total_packages: total,
        percent: 100,
        speed_kbps: 0,
        done: true,
        error: None,
    });

    Ok(())
}

#[cfg(windows)]
fn bootstrapper_register_protocol_internal(exe_path: &str) -> Result<(), String> {
    use winreg::{
        enums::HKEY_CURRENT_USER,
        RegKey,
    };
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (proto_key, _) = hkcu
        .create_subkey(r"Software\Classes\roblox-player")
        .map_err(|e| e.to_string())?;
    proto_key.set_value("", &"URL:Roblox Protocol").map_err(|e| e.to_string())?;
    proto_key.set_value("URL Protocol", &"").map_err(|e| e.to_string())?;

    let (cmd_key, _) = hkcu
        .create_subkey(r"Software\Classes\roblox-player\shell\open\command")
        .map_err(|e| e.to_string())?;
    let cmd_val = format!("\"{}\" \"%1\"", exe_path);
    cmd_key.set_value("", &cmd_val).map_err(|e| e.to_string())?;

    drop(cmd_key);
    drop(proto_key);

    // Also handle roblox: (without -player)
    let (roblox_key, _) = hkcu
        .create_subkey(r"Software\Classes\roblox")
        .map_err(|e| e.to_string())?;
    roblox_key.set_value("", &"URL:Roblox Protocol").map_err(|e| e.to_string())?;
    roblox_key.set_value("URL Protocol", &"").map_err(|e| e.to_string())?;
    let (roblox_cmd_key, _) = hkcu
        .create_subkey(r"Software\Classes\roblox\shell\open\command")
        .map_err(|e| e.to_string())?;
    roblox_cmd_key.set_value("", &cmd_val).map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(not(windows))]
fn bootstrapper_register_protocol_internal(_exe_path: &str) -> Result<(), String> {
    Err("Protocol registration is only supported on Windows".into())
}

#[tauri::command]
fn bootstrapper_register_protocol() -> Result<(), String> {
    let installed = read_installed_version().ok_or("No version installed yet")?;
    let exe = version_dir(&installed).join("RobloxPlayerBeta.exe");
    if !exe.exists() {
        return Err("RobloxPlayerBeta.exe not found in installed version directory".into());
    }
    bootstrapper_register_protocol_internal(&exe.to_string_lossy())
}

// ── FastFlags ──────────────────────────────────────────────────────────────────

fn fastflags_path() -> PathBuf {
    bootstrapper_root().join("fastflags.json")
}

fn client_app_settings_path() -> Option<PathBuf> {
    let ver = read_installed_version()?;
    let p = version_dir(&ver).join("ClientSettings").join("ClientAppSettings.json");
    Some(p)
}

#[tauri::command]
fn get_fastflags() -> serde_json::Value {
    let path = fastflags_path();
    if !path.exists() {
        return serde_json::json!({});
    }
    fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}))
}

#[tauri::command]
fn save_fastflags(flags: serde_json::Value) -> Result<(), String> {
    // Save master copy
    let s = serde_json::to_string_pretty(&flags).map_err(|e| e.to_string())?;
    fs::write(fastflags_path(), &s).map_err(|e| e.to_string())?;

    // Also write directly into the active Roblox version's ClientSettings folder
    if let Some(client_settings) = client_app_settings_path() {
        if let Some(parent) = client_settings.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&client_settings, &s);
    }

    Ok(())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct FastFlagPreset {
    pub id: String,
    pub name: String,
    pub description: String,
    pub category: String,
    pub flags: serde_json::Value,
}

#[tauri::command]
fn get_fastflag_presets() -> Vec<FastFlagPreset> {
    vec![
        FastFlagPreset {
            id: "fps_unlock".into(),
            name: "Unlock FPS".into(),
            description: "Removes the 60 FPS cap so Roblox can run at your monitor's refresh rate.".into(),
            category: "Performance".into(),
            flags: serde_json::json!({
                "FFlagTaskSchedulerLimitTargetFps": false,
                "DFIntTaskSchedulerTargetFps": 0
            }),
        },
        FastFlagPreset {
            id: "performance_mode".into(),
            name: "Performance Mode".into(),
            description: "Disables heavy rendering features to maximize FPS on lower-end hardware.".into(),
            category: "Performance".into(),
            flags: serde_json::json!({
                "DFFlagDisableDPIScale": true,
                "FIntRenderShadowIntensity": 0,
                "DFIntCSGLevelOfDetailSwitchingDistance": 0,
                "DFIntCSGLevelOfDetailSwitchingDistanceFull": 0,
                "FIntDebugForceMSAASamples": 0,
                "DFIntDebugFRMQualityLevelOverride": 1
            }),
        },
        FastFlagPreset {
            id: "graphics_quality".into(),
            name: "Max Graphics Quality".into(),
            description: "Enables high-quality rendering settings for the best visual experience.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "FIntDebugForceMSAASamples": 4,
                "DFIntDebugFRMQualityLevelOverride": 21,
                "FFlagDebugGraphicsPreferD3D11FL10": true
            }),
        },
        FastFlagPreset {
            id: "disable_telemetry".into(),
            name: "Disable Telemetry".into(),
            description: "Disables Roblox's background analytics and telemetry reporting.".into(),
            category: "Privacy".into(),
            flags: serde_json::json!({
                "FFlagDebugDisableTelemetryEphemeralCounter": true,
                "FFlagDebugDisableTelemetryEphemeralStat": true,
                "FFlagDebugDisableTelemetryEventIngest": true,
                "FFlagDebugDisableTelemetryPoint": true,
                "FFlagDebugDisableTelemetryV2Counter": true,
                "FFlagDebugDisableTelemetryV2Event": true,
                "FFlagDebugDisableTelemetryV2Stat": true
            }),
        },
        FastFlagPreset {
            id: "reduce_render_distance".into(),
            name: "Reduce Render Distance".into(),
            description: "Lowers the distance at which objects render for a significant FPS boost.".into(),
            category: "Performance".into(),
            flags: serde_json::json!({
                "DFIntRenderLocalLightFadeMax": 1,
                "DFIntCSGLevelOfDetailSwitchingDistance": 250,
                "DFIntCSGLevelOfDetailSwitchingDistanceFull": 500
            }),
        },
        FastFlagPreset {
            id: "disable_vc".into(),
            name: "Disable Voice Chat".into(),
            description: "Fully disables the Roblox spatial voice chat system.".into(),
            category: "Misc".into(),
            flags: serde_json::json!({
                "DFFlagVoiceChatEnabledForAllUsers": false,
                "FFlagEnableVoiceChat": false
            }),
        },
        FastFlagPreset {
            id: "old_lighting".into(),
            name: "Legacy Lighting (Voxel)".into(),
            description: "Forces Roblox to use the classic voxel-based lighting engine.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "DFFlagDebugForceFutureIsBrightPhase2": false,
                "FFlagDebugForceFutureLighting": false
            }),
        },
        FastFlagPreset {
            id: "no_shadows".into(),
            name: "Disable Shadows".into(),
            description: "Turns off all shadow rendering for maximum performance.".into(),
            category: "Performance".into(),
            flags: serde_json::json!({
                "FIntRenderShadowIntensity": 0,
                "DFIntCullFactorPixelThresholdShadowMapHighQuality": 2147483647,
                "DFIntCullFactorPixelThresholdShadowMapLowQuality": 2147483647
            }),
        },
        FastFlagPreset {
            id: "potato_mode".into(),
            name: "Potato Mode".into(),
            description: "Every performance optimization combined — lowest possible quality for maximum FPS on weak hardware.".into(),
            category: "Performance".into(),
            flags: serde_json::json!({
                "FFlagTaskSchedulerLimitTargetFps": false,
                "DFIntTaskSchedulerTargetFps": 9999,
                "DFIntDebugFRMQualityLevelOverride": 1,
                "FIntRenderShadowIntensity": 0,
                "DFIntCSGLevelOfDetailSwitchingDistance": 0,
                "DFIntCSGLevelOfDetailSwitchingDistanceFull": 0,
                "FIntDebugForceMSAASamples": 0,
                "DFFlagDisablePostFx": true,
                "DFIntRenderLocalLightFadeMax": 1,
                "DFIntCullFactorPixelThresholdShadowMapHighQuality": 2147483647,
                "DFIntCullFactorPixelThresholdShadowMapLowQuality": 2147483647,
                "DFFlagDebugForceFutureIsBrightPhase2": false,
                "FFlagDebugForceFutureLighting": false,
                "FFlagDebugDisableTelemetryEphemeralCounter": true,
                "FFlagDebugDisableTelemetryEphemeralStat": true,
                "FFlagDebugDisableTelemetryEventIngest": true,
                "FFlagDebugDisableTelemetryPoint": true,
                "FFlagDebugDisableTelemetryV2Counter": true,
                "FFlagDebugDisableTelemetryV2Event": true,
                "FFlagDebugDisableTelemetryV2Stat": true
            }),
        },
        FastFlagPreset {
            id: "disable_post_fx".into(),
            name: "No Post-Processing Effects".into(),
            description: "Disables bloom, depth-of-field, and motion blur without changing other graphics settings.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "DFFlagDisablePostFx": true
            }),
        },
        FastFlagPreset {
            id: "high_fps".into(),
            name: "Max FPS (9999 Target)".into(),
            description: "Removes the FPS cap entirely and sets the scheduler target to 9999 for maximum smoothness.".into(),
            category: "Performance".into(),
            flags: serde_json::json!({
                "FFlagTaskSchedulerLimitTargetFps": false,
                "DFIntTaskSchedulerTargetFps": 9999
            }),
        },
        FastFlagPreset {
            id: "hardware_cursor".into(),
            name: "Hardware Cursor".into(),
            description: "Uses the OS hardware cursor instead of Roblox's software-rendered cursor — reduces click latency.".into(),
            category: "Misc".into(),
            flags: serde_json::json!({
                "FFlagEnableHardwareCursor": true
            }),
        },
        FastFlagPreset {
            id: "full_privacy".into(),
            name: "Full Privacy Mode".into(),
            description: "Disables all telemetry, analytics, and voice chat — nothing is sent to Roblox's data collection.".into(),
            category: "Privacy".into(),
            flags: serde_json::json!({
                "FFlagDebugDisableTelemetryEphemeralCounter": true,
                "FFlagDebugDisableTelemetryEphemeralStat": true,
                "FFlagDebugDisableTelemetryEventIngest": true,
                "FFlagDebugDisableTelemetryPoint": true,
                "FFlagDebugDisableTelemetryV2Counter": true,
                "FFlagDebugDisableTelemetryV2Event": true,
                "FFlagDebugDisableTelemetryV2Stat": true,
                "DFFlagVoiceChatEnabledForAllUsers": false,
                "FFlagEnableVoiceChat": false
            }),
        },
        FastFlagPreset {
            id: "no_msaa".into(),
            name: "No Anti-Aliasing (MSAA Off)".into(),
            description: "Disables MSAA anti-aliasing for better performance at the cost of jagged edges.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "FIntDebugForceMSAASamples": 0
            }),
        },
        FastFlagPreset {
            id: "msaa_8x".into(),
            name: "Maximum Anti-Aliasing (MSAA 8x)".into(),
            description: "Enables 8x MSAA for the smoothest possible edges — requires a powerful GPU.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "FIntDebugForceMSAASamples": 8
            }),
        },
        FastFlagPreset {
            id: "minimal_lighting".into(),
            name: "Minimal Lighting".into(),
            description: "Combines legacy voxel lighting and all shadow options disabled — big FPS boost in lit environments.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "FIntRenderShadowIntensity": 0,
                "DFIntCullFactorPixelThresholdShadowMapHighQuality": 2147483647,
                "DFIntCullFactorPixelThresholdShadowMapLowQuality": 2147483647,
                "DFFlagDebugForceFutureIsBrightPhase2": false,
                "FFlagDebugForceFutureLighting": false
            }),
        },
        FastFlagPreset {
            id: "low_texture_quality".into(),
            name: "Low Texture Quality".into(),
            description: "Forces lower-resolution textures to save VRAM and reduce stutters on low-end GPUs.".into(),
            category: "Performance".into(),
            flags: serde_json::json!({
                "FIntDebugTextureManagerSkipMips": 8
            }),
        },
        FastFlagPreset {
            id: "high_texture_quality".into(),
            name: "High Texture Quality".into(),
            description: "Loads full-resolution textures for crisper visuals — requires ample VRAM.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "FIntDebugTextureManagerSkipMips": 0
            }),
        },
        FastFlagPreset {
            id: "disable_ads".into(),
            name: "Disable In-Experience Ads".into(),
            description: "Prevents Roblox from loading video and banner advertisements inside games.".into(),
            category: "Privacy".into(),
            flags: serde_json::json!({
                "FFlagAdServiceEnabled": false
            }),
        },
        FastFlagPreset {
            id: "smooth_terrain".into(),
            name: "High Quality Terrain".into(),
            description: "Raises terrain LOD distances so details remain crisp at far distances.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "DFIntCSGLevelOfDetailSwitchingDistance": 1000,
                "DFIntCSGLevelOfDetailSwitchingDistanceFull": 2000
            }),
        },
        FastFlagPreset {
            id: "reduce_local_lights".into(),
            name: "Reduce Dynamic Lighting".into(),
            description: "Fades out local dynamic lights more aggressively to improve frame times.".into(),
            category: "Performance".into(),
            flags: serde_json::json!({
                "DFIntRenderLocalLightFadeMax": 1,
                "DFIntRenderLocalLightFadeMin": 0,
                "DFIntRenderLocalLightUpdateDistanceMax": 20,
                "DFIntRenderLocalLightUpdateDistanceMin": 10
            }),
        },
        FastFlagPreset {
            id: "d3d11".into(),
            name: "Force DirectX 11".into(),
            description: "Forces Roblox to use the DirectX 11 renderer — more stable on some older GPU drivers.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "FFlagDebugGraphicsPreferD3D11": true,
                "FFlagDebugGraphicsPreferD3D11FL10": false
            }),
        },
        FastFlagPreset {
            id: "4x_msaa".into(),
            name: "4x Anti-Aliasing (MSAA 4x)".into(),
            description: "Forces 4x MSAA for smooth edges on all geometry — best paired with Max Graphics.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "FIntDebugForceMSAASamples": 4
            }),
        },
        FastFlagPreset {
            id: "future_lighting".into(),
            name: "Future Lighting (Force On)".into(),
            description: "Forces the Future lighting engine even in games that use lower quality lighting modes.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "DFFlagDebugForceFutureIsBrightPhase2": true,
                "FFlagDebugForceFutureLighting": true
            }),
        },
        FastFlagPreset {
            id: "network_optimize".into(),
            name: "Network Optimization".into(),
            description: "Tunes physics replication send rates to reduce jitter and perceived network lag.".into(),
            category: "Network".into(),
            flags: serde_json::json!({
                "DFIntS2PhysicsSenderRate": 30,
                "DFIntDataSendRate": 30
            }),
        },
        // ── FPS Caps ──────────────────────────────────────────────────
        FastFlagPreset {
            id: "fps_30".into(),
            name: "Cap FPS at 30".into(),
            description: "Limits to 30 FPS — maximum battery saving for laptops or thermal throttled machines.".into(),
            category: "Performance".into(),
            flags: serde_json::json!({
                "FFlagTaskSchedulerLimitTargetFps": true,
                "DFIntTaskSchedulerTargetFps": 30
            }),
        },
        FastFlagPreset {
            id: "fps_60".into(),
            name: "Cap FPS at 60".into(),
            description: "Hard-locks to 60 FPS for consistent frame pacing and lower GPU temperature.".into(),
            category: "Performance".into(),
            flags: serde_json::json!({
                "FFlagTaskSchedulerLimitTargetFps": true,
                "DFIntTaskSchedulerTargetFps": 60
            }),
        },
        FastFlagPreset {
            id: "fps_144".into(),
            name: "Cap FPS at 144".into(),
            description: "Targets 144 FPS for high-refresh-rate monitors without going to uncapped 9999.".into(),
            category: "Performance".into(),
            flags: serde_json::json!({
                "FFlagTaskSchedulerLimitTargetFps": true,
                "DFIntTaskSchedulerTargetFps": 144
            }),
        },
        FastFlagPreset {
            id: "fps_240".into(),
            name: "Cap FPS at 240".into(),
            description: "Targets 240 FPS for 240 Hz monitors — good balance between performance and GPU load.".into(),
            category: "Performance".into(),
            flags: serde_json::json!({
                "FFlagTaskSchedulerLimitTargetFps": true,
                "DFIntTaskSchedulerTargetFps": 240
            }),
        },
        // ── Renderer ──────────────────────────────────────────────────
        FastFlagPreset {
            id: "vulkan".into(),
            name: "Force Vulkan Renderer".into(),
            description: "Switches to the Vulkan rendering backend — lower CPU overhead on supported GPUs (AMD/NVIDIA).".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "FFlagDebugGraphicsPreferVulkan": true
            }),
        },
        FastFlagPreset {
            id: "opengl".into(),
            name: "Force OpenGL Renderer".into(),
            description: "Falls back to the OpenGL renderer — useful if DX11 or Vulkan causes issues.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "FFlagDebugGraphicsPreferOpenGL": true
            }),
        },
        FastFlagPreset {
            id: "shadowmap_lighting".into(),
            name: "ShadowMap Lighting Engine".into(),
            description: "Forces the ShadowMap lighting engine — a middle ground between Legacy and Future lighting.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "FFlagDebugForceShadowMapLighting": true,
                "DFFlagDebugForceFutureIsBrightPhase2": false,
                "FFlagDebugForceFutureLighting": false
            }),
        },
        // ── Grass & Terrain ───────────────────────────────────────────
        FastFlagPreset {
            id: "no_grass".into(),
            name: "Disable Grass Rendering".into(),
            description: "Completely removes grass strands from terrain — notable FPS improvement in open-world games.".into(),
            category: "Performance".into(),
            flags: serde_json::json!({
                "FIntFRMMinGrassDistance": 0,
                "FIntFRMMaxGrassDistance": 0,
                "FIntRenderGrassDetailStrands": 0,
                "DFIntRenderGrassHeightScaler": 0
            }),
        },
        FastFlagPreset {
            id: "max_grass".into(),
            name: "Maximum Grass Detail".into(),
            description: "Extends grass render distance and density for lush terrain visuals.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "FIntFRMMinGrassDistance": 100,
                "FIntFRMMaxGrassDistance": 500,
                "FIntRenderGrassDetailStrands": 50
            }),
        },
        // ── Post-FX ───────────────────────────────────────────────────
        FastFlagPreset {
            id: "no_depth_of_field".into(),
            name: "Disable Depth of Field".into(),
            description: "Removes the depth-of-field blur effect in games that use it.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "FFlagRenderDepthOfFieldEnabled": false
            }),
        },
        FastFlagPreset {
            id: "no_sun_rays".into(),
            name: "Disable Sun Rays / God Rays".into(),
            description: "Turns off the volumetric sun ray effect for a cleaner look and slight performance gain.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "FFlagRenderSunRaysEnabled": false
            }),
        },
        FastFlagPreset {
            id: "no_color_correction".into(),
            name: "Disable Color Correction".into(),
            description: "Removes color grading / color correction PostFX applied by the game.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "FFlagRenderColorCorrectionEnabled": false
            }),
        },
        // ── Physics ───────────────────────────────────────────────────
        FastFlagPreset {
            id: "high_physics_rate".into(),
            name: "High Physics Send Rate (120 Hz)".into(),
            description: "Doubles physics replication frequency for smoother character movement in competitive play.".into(),
            category: "Network".into(),
            flags: serde_json::json!({
                "DFIntS2PhysicsSenderRate": 120,
                "DFIntDataSendRate": 60
            }),
        },
        FastFlagPreset {
            id: "low_network_quality".into(),
            name: "Low Bandwidth Mode".into(),
            description: "Reduces physics and data send rates to save bandwidth on metered connections.".into(),
            category: "Network".into(),
            flags: serde_json::json!({
                "DFIntS2PhysicsSenderRate": 15,
                "DFIntDataSendRate": 15
            }),
        },
        // ── Privacy / Crash ───────────────────────────────────────────
        FastFlagPreset {
            id: "no_crash_reporting".into(),
            name: "Disable Crash Reporting".into(),
            description: "Prevents crash dumps and error reports from being uploaded to Roblox servers.".into(),
            category: "Privacy".into(),
            flags: serde_json::json!({
                "FFlagCrashReportingEnabled": false
            }),
        },
        // ── UI / Misc ─────────────────────────────────────────────────
        FastFlagPreset {
            id: "no_gui_blur".into(),
            name: "Disable Menu Blur".into(),
            description: "Removes the background blur effect applied when the in-game menu or UI overlays open.".into(),
            category: "Misc".into(),
            flags: serde_json::json!({
                "FIntBgBlurRadius": 0,
                "FIntBgBlurIterations": 0
            }),
        },
        FastFlagPreset {
            id: "show_fps_counter".into(),
            name: "Always Show FPS Counter".into(),
            description: "Forces Roblox's built-in FPS counter to always be visible without needing Shift+F5.".into(),
            category: "Misc".into(),
            flags: serde_json::json!({
                "FFlagDebugDisplayFPS": true
            }),
        },
        FastFlagPreset {
            id: "disable_layered_clothing".into(),
            name: "Disable Layered Clothing".into(),
            description: "Skips rendering layered clothing (jackets, hoodies) — boosts FPS in crowded servers.".into(),
            category: "Performance".into(),
            flags: serde_json::json!({
                "FFlagLayeredClothingEnabled": false,
                "DFFlagLayeredClothingEnabledForAll": false
            }),
        },
        FastFlagPreset {
            id: "disable_player_avatars".into(),
            name: "Low-Detail Player Characters".into(),
            description: "Reduces character mesh detail and skips accessory loading — large FPS gain in populated servers.".into(),
            category: "Performance".into(),
            flags: serde_json::json!({
                "FFlagAvatarSelfViewEnabled": false,
                "DFIntLodAvatarMinThreshold": 0,
                "DFIntLodAvatarMaxThreshold": 1
            }),
        },
        FastFlagPreset {
            id: "reduced_loading_screen".into(),
            name: "Faster Game Loading".into(),
            description: "Skips loading screen delays and reduces asset prefetch pauses to get into games faster.".into(),
            category: "Misc".into(),
            flags: serde_json::json!({
                "DFIntNumAssetsMaxToPreload": 0,
                "DFIntAssetPreloading": 0
            }),
        },
        FastFlagPreset {
            id: "ultra_quality".into(),
            name: "Ultra Quality Preset".into(),
            description: "Combines max MSAA, max texture quality, high terrain LOD, and Future lighting for the best possible visuals.".into(),
            category: "Graphics".into(),
            flags: serde_json::json!({
                "FIntDebugForceMSAASamples": 8,
                "DFIntDebugFRMQualityLevelOverride": 21,
                "FIntDebugTextureManagerSkipMips": 0,
                "DFIntCSGLevelOfDetailSwitchingDistance": 1000,
                "DFIntCSGLevelOfDetailSwitchingDistanceFull": 2000,
                "DFFlagDebugForceFutureIsBrightPhase2": true,
                "FFlagDebugForceFutureLighting": true
            }),
        },
        FastFlagPreset {
            id: "competitive".into(),
            name: "Competitive / Low-Latency".into(),
            description: "Maximizes FPS, disables all visual fluff, and tunes physics rate for the lowest possible latency in PvP games.".into(),
            category: "Performance".into(),
            flags: serde_json::json!({
                "FFlagTaskSchedulerLimitTargetFps": false,
                "DFIntTaskSchedulerTargetFps": 9999,
                "DFIntDebugFRMQualityLevelOverride": 1,
                "FIntRenderShadowIntensity": 0,
                "FIntDebugForceMSAASamples": 0,
                "DFFlagDisablePostFx": true,
                "FFlagEnableHardwareCursor": true,
                "FFlagLayeredClothingEnabled": false,
                "DFFlagLayeredClothingEnabledForAll": false,
                "FIntFRMMinGrassDistance": 0,
                "FIntFRMMaxGrassDistance": 0,
                "FIntRenderGrassDetailStrands": 0,
                "DFIntS2PhysicsSenderRate": 120,
                "DFIntDataSendRate": 60,
                "FFlagDebugDisableTelemetryEphemeralCounter": true,
                "FFlagDebugDisableTelemetryEphemeralStat": true,
                "FFlagDebugDisableTelemetryEventIngest": true,
                "FFlagDebugDisableTelemetryPoint": true,
                "FFlagDebugDisableTelemetryV2Counter": true,
                "FFlagDebugDisableTelemetryV2Event": true,
                "FFlagDebugDisableTelemetryV2Stat": true
            }),
        },
    ]
}

// ── Roblox Install Detection ──────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone)]
pub struct RobloxInstall {
    pub name: String,           // e.g. "Roblox (Official)", "Bloxstrap", "Fishstrap", "Reiya"
    pub kind: String,           // "official" | "bloxstrap" | "fishstrap" | "reiya"
    pub exe_path: Option<String>,
    pub version: Option<String>,
    pub install_dir: String,
    pub found: bool,
    pub is_protocol_handler: bool, // Is this what roblox-player:// opens?
}

#[derive(Serialize, Deserialize)]
pub struct DetectedInstalls {
    pub installs: Vec<RobloxInstall>,
    pub protocol_handler_path: Option<String>, // Raw registry value
}

// ── Tray Notifications ────────────────────────────────────────────────────────

fn should_notify() -> bool {
    let path = data_dir().join("settings.json");
    if let Ok(content) = fs::read_to_string(&path) {
        let trimmed = clean_bom(&content).trim().to_string();
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&trimmed) {
            return val.get("ToastNotificationsEnabled").and_then(|v| v.as_bool()).unwrap_or(true);
        }
    }
    true
}

fn send_notification(app: &tauri::AppHandle, title: &str, body: &str) {
    if !should_notify() { return; }
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

// ── Account Import / Export ───────────────────────────────────────────────────

#[tauri::command]
async fn export_accounts(app: tauri::AppHandle, password: String) -> Result<String, String> {
    use tauri_plugin_dialog::DialogExt;
    use aes_gcm::{Aes256Gcm, KeyInit, aead::{Aead, AeadCore, OsRng as AeadOsRng}};

    let accounts_path = data_dir().join("accounts.json");
    let content = fs::read_to_string(&accounts_path).map_err(|e| e.to_string())?;

    // Derive key from password
    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    let key_bytes = hasher.finalize();

    let cipher = Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| e.to_string())?;
    let nonce = Aes256Gcm::generate_nonce(&mut AeadOsRng);
    let encrypted = cipher.encrypt(&nonce, content.as_bytes()).map_err(|_| "Encryption failed".to_string())?;

    let mut bundle = nonce.to_vec();
    bundle.extend_from_slice(&encrypted);
    let encoded = base64::engine::general_purpose::STANDARD.encode(&bundle);

    let export_json = serde_json::json!({
        "version": 1,
        "app": "reiya",
        "data": encoded
    });

    let file_path = app.dialog()
        .file()
        .add_filter("Reiya Backup", &["reiya"])
        .set_file_name("reiya-backup.reiya")
        .blocking_save_file();

    match file_path {
        Some(path) => {
            let path_str = path.to_string();
            fs::write(&path_str, serde_json::to_string_pretty(&export_json).unwrap())
                .map_err(|e| e.to_string())?;
            Ok(path_str)
        }
        None => Err("cancelled".into()),
    }
}

#[tauri::command]
async fn import_accounts(app: tauri::AppHandle, password: String) -> Result<usize, String> {
    use tauri_plugin_dialog::DialogExt;
    use aes_gcm::{Aes256Gcm, KeyInit, aead::Aead, Nonce};

    let file_path = app.dialog()
        .file()
        .add_filter("Reiya Backup", &["reiya"])
        .blocking_pick_file();

    let Some(path) = file_path else { return Err("cancelled".into()); };
    let path_str = path.to_string();

    let file_content = fs::read_to_string(&path_str).map_err(|e| e.to_string())?;
    let envelope: serde_json::Value = serde_json::from_str(&file_content)
        .map_err(|_| "Invalid backup file".to_string())?;

    let encoded = envelope["data"].as_str().ok_or("Invalid backup format")?;
    let bundle = base64::engine::general_purpose::STANDARD.decode(encoded)
        .map_err(|_| "Invalid backup data".to_string())?;

    if bundle.len() < 12 { return Err("Corrupt backup".into()); }
    let (nonce_bytes, encrypted) = bundle.split_at(12);

    let mut hasher = Sha256::new();
    hasher.update(password.as_bytes());
    let key_bytes = hasher.finalize();

    let cipher = Aes256Gcm::new_from_slice(&key_bytes).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let decrypted = cipher.decrypt(nonce, encrypted)
        .map_err(|_| "Wrong password or corrupt file".to_string())?;
    let accounts_json = String::from_utf8(decrypted).map_err(|_| "Invalid data in backup".to_string())?;

    let imported: Vec<serde_json::Value> = serde_json::from_str(&accounts_json)
        .map_err(|_| "Invalid accounts data".to_string())?;

    let accounts_path = data_dir().join("accounts.json");
    let existing_content = fs::read_to_string(&accounts_path).unwrap_or_else(|_| "[]".into());
    let mut existing: Vec<serde_json::Value> = serde_json::from_str(&existing_content).unwrap_or_default();

    let existing_ids: std::collections::HashSet<i64> = existing.iter()
        .filter_map(|a| a["UserId"].as_i64())
        .collect();

    let mut added = 0usize;
    for acc in imported {
        let uid = acc["UserId"].as_i64().unwrap_or(0);
        if uid > 0 && !existing_ids.contains(&uid) {
            existing.push(acc);
            added += 1;
        }
    }

    fs::write(&accounts_path, serde_json::to_string_pretty(&existing).unwrap())
        .map_err(|e| e.to_string())?;

    let _ = app;
    Ok(added)
}

#[tauri::command]
fn detect_roblox_installs() -> DetectedInstalls {
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    let local = PathBuf::from(&local);

    // Read current roblox-player:// registry value
    let protocol_handler_path = read_protocol_handler();

    let mut installs: Vec<RobloxInstall> = Vec::new();

    // 1. Official Roblox
    {
        let dir = local.join("Roblox");
        let exe = find_exe_in_versions(&dir);
        let version = exe.as_ref().and_then(|p| version_from_path(p));
        let is_handler = exe.as_ref().map_or(false, |p| path_matches_handler(p, &protocol_handler_path));
        installs.push(RobloxInstall {
            name: "Roblox (Official)".into(),
            kind: "official".into(),
            found: exe.is_some(),
            exe_path: exe.map(|p| p.to_string_lossy().to_string()),
            version,
            install_dir: dir.to_string_lossy().to_string(),
            is_protocol_handler: is_handler,
        });
    }

    // 2. Bloxstrap
    {
        let dir = local.join("Bloxstrap");
        // Bloxstrap launcher exe sits directly in the install dir
        let launcher = dir.join("Bloxstrap.exe");
        let exe_in_versions = find_exe_in_versions(&dir);
        let found = launcher.exists() || exe_in_versions.is_some();
        let exe_path = if launcher.exists() { Some(launcher.clone()) } else { exe_in_versions.clone() };
        let is_handler = exe_path.as_ref().map_or(false, |p| path_matches_handler(p, &protocol_handler_path))
            || protocol_handler_path.as_deref().map_or(false, |h| h.to_lowercase().contains("bloxstrap"));
        let version = exe_in_versions.as_ref().and_then(|p| version_from_path(p));
        installs.push(RobloxInstall {
            name: "Bloxstrap".into(),
            kind: "bloxstrap".into(),
            found,
            exe_path: exe_path.map(|p| p.to_string_lossy().to_string()),
            version,
            install_dir: dir.to_string_lossy().to_string(),
            is_protocol_handler: is_handler,
        });
    }

    // 3. Fishstrap / Fishtrap (check both spellings)
    {
        let dir1 = local.join("Fishstrap");
        let dir2 = local.join("Fishtrap");
        let dir = if dir1.exists() { dir1.clone() } else { dir2.clone() };
        let launcher1 = dir1.join("Fishstrap.exe");
        let launcher2 = dir2.join("Fishtrap.exe");
        let launcher3 = dir1.join("Fishtrap.exe");
        let launcher4 = dir2.join("Fishstrap.exe");
        let launcher_found = launcher1.exists() || launcher2.exists() || launcher3.exists() || launcher4.exists();
        let exe_in_versions = find_exe_in_versions(&dir1).or_else(|| find_exe_in_versions(&dir2));
        let found = launcher_found || exe_in_versions.is_some();
        let exe_path = [&launcher1, &launcher2, &launcher3, &launcher4]
            .iter().find(|p| p.exists()).map(|p| p.to_path_buf())
            .or_else(|| exe_in_versions.clone());
        let is_handler = protocol_handler_path.as_deref().map_or(false, |h| {
            let h = h.to_lowercase();
            h.contains("fishstrap") || h.contains("fishtrap")
        });
        let version = exe_in_versions.as_ref().and_then(|p| version_from_path(p));
        installs.push(RobloxInstall {
            name: "Fishstrap".into(),
            kind: "fishstrap".into(),
            found,
            exe_path: exe_path.map(|p| p.to_string_lossy().to_string()),
            version,
            install_dir: dir.to_string_lossy().to_string(),
            is_protocol_handler: is_handler,
        });
    }

    // 4. Reiya's own install
    {
        let dir = bootstrapper_root();
        let installed_ver = read_installed_version();
        let exe = installed_ver.as_ref().map(|v| version_dir(v).join("RobloxPlayerBeta.exe"));
        let exe_exists = exe.as_ref().map_or(false, |p| p.exists());
        let is_handler = exe.as_ref().map_or(false, |p| path_matches_handler(p, &protocol_handler_path))
            || protocol_handler_path.as_deref().map_or(false, |h| h.to_lowercase().contains("seistem"));
        installs.push(RobloxInstall {
            name: "Reiya (Built-in)".into(),
            kind: "reiya".into(),
            found: exe_exists,
            exe_path: exe.filter(|_| exe_exists).map(|p| p.to_string_lossy().to_string()),
            version: installed_ver,
            install_dir: dir.to_string_lossy().to_string(),
            is_protocol_handler: is_handler,
        });
    }

    DetectedInstalls { installs, protocol_handler_path }
}

/// Reads HKCU\Software\Classes\roblox-player\shell\open\command default value.
fn read_protocol_handler() -> Option<String> {
    #[cfg(windows)]
    {
        use winreg::{enums::HKEY_CURRENT_USER, RegKey};
        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        if let Ok(key) = hkcu.open_subkey(r"Software\Classes\roblox-player\shell\open\command") {
            if let Ok(val) = key.get_value::<String, _>("") {
                return Some(val);
            }
        }
        None
    }
    #[cfg(not(windows))]
    None
}

/// Find the newest RobloxPlayerBeta.exe inside a Versions subfolder.
fn find_exe_in_versions(install_dir: &PathBuf) -> Option<PathBuf> {
    search_versions_dir(&install_dir.join("Versions"))
}

/// Extract a short version label from the parent directory name of the exe.
fn version_from_path(exe: &PathBuf) -> Option<String> {
    exe.parent()?.file_name().map(|n| n.to_string_lossy().to_string())
}

/// Check whether an exe path matches the current protocol handler command.
fn path_matches_handler(exe: &PathBuf, handler: &Option<String>) -> bool {
    let h = match handler { Some(h) => h.to_lowercase(), None => return false };
    let e = exe.to_string_lossy().to_lowercase();
    h.contains(&e)
}

fn load_multi_instance_from_settings() -> bool {
    let settings_path = data_dir().join("settings.json");
    if settings_path.exists() {
        if let Ok(content) = fs::read_to_string(settings_path) {
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&clean_bom(&content)) {
                if let Some(multi) = val.get("MultiRoblox").and_then(|v| v.as_bool()) {
                    return multi;
                }
            }
        }
    }
    true
}

fn read_minimize_to_tray() -> bool {
    let settings_path = data_dir().join("settings.json");
    if let Ok(content) = fs::read_to_string(settings_path) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(clean_bom(&content)) {
            if let Some(v) = val.get("MinimizeToTray").and_then(|v| v.as_bool()) {
                return v;
            }
        }
    }
    true // default: minimize to tray
}

#[cfg(windows)]
fn sync_run_on_startup(enable: bool) {
    use winreg::{enums::{HKEY_CURRENT_USER, KEY_WRITE}, RegKey};
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    if let Ok(run_key) = hkcu.open_subkey_with_flags(r"Software\Microsoft\Windows\CurrentVersion\Run", KEY_WRITE) {
        if enable {
            if let Ok(exe_path) = std::env::current_exe() {
                // Quote the path so Windows handles spaces in directory names correctly
                let path_str = format!("\"{}\"", exe_path.to_string_lossy());
                let _ = run_key.set_value("ReiyaAccountManager", &path_str);
            }
        } else {
            let _ = run_key.delete_value("ReiyaAccountManager");
        }
    }
}

// ── Entry point ───────────────────────────────────────────────────────────────
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(SessionTracker(std::sync::Arc::new(Mutex::new(load_session_tracker_data()))))
        .manage(MultiState::new(load_multi_instance_from_settings()))
        .setup(|app| {
            // ── System tray ───────────────────────────────────────────────
            {
                use tauri::menu::{MenuBuilder, MenuItemBuilder, PredefinedMenuItem};
                use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
                use tauri::Manager;

                let accounts = load_stored();
                let mut menu_builder = MenuBuilder::new(app)
                    .item(&MenuItemBuilder::with_id("show", "Show Reiya").build(app)?)
                    .item(&PredefinedMenuItem::separator(app)?);

                for acc in accounts.iter().take(8) {
                    let label = format!("▶  {}", acc.username);
                    let item = MenuItemBuilder::with_id(
                        format!("launch_{}", acc.user_id),
                        label,
                    ).build(app)?;
                    menu_builder = menu_builder.item(&item);
                }

                let menu = menu_builder
                    .item(&PredefinedMenuItem::separator(app)?)
                    .item(&MenuItemBuilder::with_id("quit", "Quit Reiya").build(app)?)
                    .build()?;

                let app_handle_tray = app.handle().clone();
                TrayIconBuilder::new()
                    .icon(app.default_window_icon().unwrap().clone())
                    .menu(&menu)
                    .tooltip("Reiya Account Manager")
                    .on_menu_event(move |app, event| {
                        let id = event.id().as_ref();
                        if id == "show" {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        } else if id == "quit" {
                            app.exit(0);
                        } else if let Some(uid_str) = id.strip_prefix("launch_") {
                            if let Ok(uid) = uid_str.parse::<i64>() {
                                let _ = app.emit("tray-account-selected", uid);
                                if let Some(win) = app.get_webview_window("main") {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                }
                            }
                        }
                        let _ = app_handle_tray;
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                            if let Some(win) = tray.app_handle().get_webview_window("main") {
                                if win.is_visible().unwrap_or(false) {
                                    let _ = win.hide();
                                } else {
                                    let _ = win.show();
                                    let _ = win.set_focus();
                                    let _ = tray.app_handle().emit("window-restored-from-tray", ());
                                }
                            }
                        }
                    })
                    .build(app)?;
            }

            // ── Close-to-tray for main window ─────────────────────────────
            {
                use tauri::Manager;
                if let Some(win) = app.get_webview_window("main") {
                    let win_clone = win.clone();
                    win.on_window_event(move |event| {
                        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                            if read_minimize_to_tray() {
                                api.prevent_close();
                                let _ = win_clone.hide();
                            }
                        }
                    });
                }
            }

            // ── Refresh Run-on-Startup registry entry on every boot ────────
            // This ensures the registry always points to the current exe path
            // even after reinstalls or updates that move the binary.
            #[cfg(windows)]
            {
                let settings_path = data_dir().join("settings.json");
                let run_on_startup = settings_path.exists()
                    .then(|| fs::read_to_string(&settings_path).ok())
                    .flatten()
                    .and_then(|s| serde_json::from_str::<serde_json::Value>(&clean_bom(&s)).ok())
                    .and_then(|v| v.get("RunOnStartup").and_then(|b| b.as_bool()))
                    .unwrap_or(false);
                sync_run_on_startup(run_on_startup);
            }

            let tracker = app.state::<SessionTracker>().inner().clone();
            let app_handle = app.handle().clone();

            tauri::async_runtime::spawn(async move {
                let mut window_states: HashMap<u32, (bool, u32)> = HashMap::new();
                loop {
                    tokio::time::sleep(std::time::Duration::from_secs(3)).await;

                    let sys = System::new_all();

                    let mut running_tracker_ids = HashMap::new();
                    for proc in sys.processes().values() {
                        let name = proc.name().to_string_lossy().to_lowercase();
                        if name == "robloxplayerbeta.exe" || name == "roblox" {
                            let cmd = proc.cmd();
                            if let Some(bt_id) = extract_browser_tracker_id(cmd) {
                                running_tracker_ids.insert(bt_id, proc.pid().as_u32());
                            }
                        }
                    }

                    let mut exited_sessions = Vec::new();
                    let now = Utc::now();

                    {
                        let mut map = tracker.0.lock().unwrap();
                        let mut keys_to_remove = Vec::new();

                        for (&bt_id, (opt_pid, info)) in map.iter_mut() {
                            if let Some(pid) = *opt_pid {
                                let sysinfo_pid = sysinfo::Pid::from_u32(pid);
                                let mut is_running = false;
                                if let Some(proc) = sys.processes().get(&sysinfo_pid) {
                                    let name = proc.name().to_string_lossy().to_lowercase();
                                    if name == "robloxplayerbeta.exe" || name == "roblox" {
                                        is_running = true;
                                    }
                                }
                                if !is_running {
                                    keys_to_remove.push(bt_id);
                                    exited_sessions.push((pid, info.clone()));
                                    window_states.remove(&pid);
                                } else {
                                    // Process is running, check window status to detect hung/zombie close
                                    let has_win = process_has_window(pid);
                                    let state = window_states.entry(pid).or_insert((false, 0));
                                    if has_win {
                                        *state = (true, 0);
                                    } else if state.0 {
                                        // It previously had a window, but doesn't now.
                                        state.1 += 1;
                                        if state.1 >= 2 {
                                            // Closed for >= 6 seconds, kill hung process
                                            if let Some(proc) = sys.processes().get(&sysinfo_pid) {
                                                proc.kill();
                                            }
                                            keys_to_remove.push(bt_id);
                                            exited_sessions.push((pid, info.clone()));
                                            window_states.remove(&pid);
                                        }
                                    }
                                }
                            } else {
                                if let Some(&running_pid) = running_tracker_ids.get(&bt_id) {
                                    *opt_pid = Some(running_pid);
                                } else {
                                    let start_time_parsed = DateTime::parse_from_rfc3339(&info.start_time)
                                        .map(|dt| dt.with_timezone(&Utc))
                                        .unwrap_or(now);
                                    // Give 120s for the game to start before removing the entry
                                    if now.signed_duration_since(start_time_parsed).num_seconds() > 120 {
                                        keys_to_remove.push(bt_id);
                                    }
                                }
                            }
                        }

                        for key in keys_to_remove {
                            map.remove(&key);
                        }

                        // ── Time-based PID fallback ────────────────────────────────
                        // When browserTrackerId extraction fails (Roblox bootstrapper
                        // may replace our id), match unmatched tracker entries to
                        // unmatched Roblox processes by launch time order.
                        let already_matched: std::collections::HashSet<u32> = map.values()
                            .filter_map(|(opt_pid, _)| *opt_pid)
                            .collect();

                        let mut free_pids: Vec<u32> = sys.processes().values()
                            .filter(|p| {
                                let n = p.name().to_string_lossy().to_lowercase();
                                (n == "robloxplayerbeta.exe" || n == "roblox")
                                    && !already_matched.contains(&p.pid().as_u32())
                            })
                            .map(|p| p.pid().as_u32())
                            .collect();
                        free_pids.sort_unstable();

                        if !free_pids.is_empty() {
                            let mut fi = 0;
                            for (opt_pid, info) in map.values_mut() {
                                if fi >= free_pids.len() { break; }
                                if opt_pid.is_none() {
                                    let start = DateTime::parse_from_rfc3339(&info.start_time)
                                        .map(|dt| dt.with_timezone(&Utc))
                                        .unwrap_or(now);
                                    if now.signed_duration_since(start).num_seconds() <= 120 {
                                        *opt_pid = Some(free_pids[fi]);
                                        fi += 1;
                                    }
                                }
                            }
                        }
                    }

                    for (pid, info) in exited_sessions {
                        let end_time = Utc::now();
                        let start_time_parsed = DateTime::parse_from_rfc3339(&info.start_time)
                            .map(|dt| dt.with_timezone(&Utc))
                            .unwrap_or(Utc::now());
                        let duration = end_time.signed_duration_since(start_time_parsed);
                        let duration_minutes = duration.num_minutes();

                        let record = SessionRecord {
                            username: info.username.clone(),
                            user_id: info.user_id,
                            avatar_url: info.avatar_url.clone(),
                            game_name: info.game_name.clone(),
                            place_id: info.place_id.clone(),
                            start_time: info.start_time.clone(),
                            end_time: end_time.to_rfc3339(),
                            duration_minutes,
                        };

                        append_session_record(record);

                        append_event(EventEntry {
                            timestamp: end_time.to_rfc3339(),
                            kind: "killed".into(),
                            user_id: Some(info.user_id),
                            username: Some(info.username.clone()),
                            avatar_url: Some(info.avatar_url.clone()),
                            detail: format!(
                                "Session for '{}' on '{}' ended after {} minutes (PID {})",
                                info.username, info.game_name, duration_minutes, pid
                            ),
                        });

                        let _ = app_handle.emit("session-status-changed", ());
                        send_notification(
                            &app_handle,
                            "Session Ended",
                            &format!("{} finished playing {} ({} min)", info.username, info.game_name, duration_minutes),
                        );
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_accounts,
            add_account,
            add_accounts_bulk,
            remove_account,
            toggle_favorite,
            validate_cookie,
            launch_account,
            get_live_sessions,
            kill_session,
            kill_all_sessions,
            fetch_thumbnails,
            fetch_place_thumbnails,
            get_event_log,
            get_session_history,
            open_login_window,
            set_display_name,
            change_password,
            sign_out_all_sessions,
            send_friend_request,
            block_user,
            search_roblox_games,
            fetch_active_servers,
            fetch_place_details,
            get_multi_instance,
            set_multi_instance,
            get_legacy_favorites,
            get_recent_games,
            save_favorites,
            set_private_server,
            remove_recent_game,
            add_recent_game,
            get_settings,
            save_settings,
            get_account_cookie,
            save_account_password,
            set_account_group,
            check_account_health,
            check_license,
            validate_license_key,
            clear_license,
            open_key_website,
            get_hwid,
            verify_pin,
            send_discord_webhook,
            export_accounts,
            import_accounts,
            check_for_update,
            download_and_install_update,
            get_app_version,
            edit_account,
            get_auth_ticket_command,
            bootstrapper_check_update,
            bootstrapper_get_status,
            bootstrapper_install,
            bootstrapper_register_protocol,
            get_fastflags,
            save_fastflags,
            get_fastflag_presets,
            detect_roblox_installs,
            get_launcher_preference,
            set_launcher_preference,
            login_with_credentials,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_get_auth_ticket() {
        let accounts = load_stored();
        let valid_acc = accounts.iter().find(|a| a.cookie_status == "Valid");
        if let Some(acc) = valid_acc {
            let cookie = decrypt_cookie(&acc.encrypted_cookie).expect("Decrypt failed");
            println!("Testing get_auth_ticket for {}", acc.username);
            
            let client = reqwest::Client::builder()
                .user_agent("RobloxAccountManagerCore")
                .build()
                .unwrap();

            let resp = client
                .post("https://auth.roblox.com/v1/authentication-ticket")
                .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
                .header("Referer", "https://www.roblox.com/")
                .header("Content-Type", "application/json")
                .body("")
                .send()
                .await
                .unwrap();

            println!("First response status: {}", resp.status());
            println!("First headers: {:?}", resp.headers());

            let csrf = resp
                .headers()
                .get("x-csrf-token")
                .and_then(|v| v.to_str().ok())
                .map(|s| s.to_string());

            println!("CSRF token: {:?}", csrf);

            if let Some(csrf_token) = csrf {
                let resp2 = client
                    .post("https://auth.roblox.com/v1/authentication-ticket")
                    .header("Cookie", format!(".ROBLOSECURITY={}", cookie))
                    .header("Referer", "https://www.roblox.com/")
                    .header("x-csrf-token", csrf_token)
                    .header("Content-Type", "application/json")
                    .body("")
                    .send()
                    .await
                    .unwrap();

                println!("Second response status: {}", resp2.status());
                println!("Second headers: {:?}", resp2.headers());
                if let Some(ticket) = resp2.headers().get("rbx-authentication-ticket") {
                    println!("TICKET: {:?}", ticket);
                } else {
                    println!("No ticket in second response! Body: {}", resp2.text().await.unwrap());
                }
            }
        } else {
            println!("No valid accounts found to test.");
        }
    }

    #[tokio::test]
    async fn test_manual_launch() {
        let accounts = load_stored();
        let acc = accounts.iter().find(|a| a.cookie_status == "Valid")
            .expect("No valid account found to test launch");
        println!("Launching with account: {}", acc.username);
        let cookie = decrypt_cookie(&acc.encrypted_cookie).expect("Decrypt failed");
        let ticket = get_auth_ticket(&cookie).await.expect("Failed to get ticket");
        println!("Ticket length: {}, Ticket: {}", ticket.len(), ticket);

        let timestamp = chrono::Utc::now().timestamp_millis().to_string();
        let browser_tracker_id = 9876543210u64;
        let place_id = "97598239454123"; // Grow a Garden 2
        let launcher_url = format!(
            "https://assetgame.roblox.com/game/PlaceLauncher.ashx?request=RequestGame&placeId={}&isPlayTogetherGame=false",
            place_id
        );
        let encoded_url = urlencoding::encode(&launcher_url).into_owned();

        let launch_args = format!(
            "roblox-player:1+launchmode:play+gameinfo:{}+launchtime:{}+platform:Windows+placelauncherurl:{}+browserTrackerId:{}",
            ticket, timestamp, encoded_url, browser_tracker_id
        );

        let installed_ver = read_installed_version().expect("Reiya version not installed");
        let exe = version_dir(&installed_ver).join("RobloxPlayerBeta.exe");
        println!("Executable: {}", exe.display());

        let mut cmd = std::process::Command::new(&exe);
        cmd.current_dir(exe.parent().unwrap());
        cmd.arg(&launch_args);

        println!("Spawning: {:?}", cmd);
        let output = cmd.output().expect("Failed to execute RobloxPlayerBeta.exe");
        println!("Exit status: {:?}", output.status);
        println!("Exit code: {:?}", output.status.code());
        println!("Stdout: {}", String::from_utf8_lossy(&output.stdout));
        println!("Stderr: {}", String::from_utf8_lossy(&output.stderr));
    }

    #[test]
    fn test_parse_accounts() {
        let path = accounts_path();
        println!("Accounts path: {:?}", path);
        let s = fs::read_to_string(&path).expect("Could not read accounts.json");
        
        let bytes = s.as_bytes();
        println!("First 20 bytes of accounts.json: {:?}", &bytes[..std::cmp::min(20, bytes.len())]);
        
        let clean = s.strip_prefix("\u{feff}").unwrap_or(&s);
        let res: Result<Vec<StoredAccount>, _> = serde_json::from_str(clean);
        match res {
            Ok(accounts) => {
                println!("Successfully parsed {} accounts", accounts.len());
            }
            Err(e) => {
                panic!("Failed to parse accounts: {}", e);
            }
        }
    }

    #[test]
    fn test_parse_session_history() {
        let path = session_history_path();
        println!("Session history path: {:?}", path);
        let s = fs::read_to_string(&path).expect("Could not read session_history.json");
        
        let bytes = s.as_bytes();
        println!("First 20 bytes of session_history.json: {:?}", &bytes[..std::cmp::min(20, bytes.len())]);
        
        let clean = s.strip_prefix("\u{feff}").unwrap_or(&s);
        let res: Result<Vec<SessionRecord>, _> = serde_json::from_str(clean);
        match res {
            Ok(hist) => {
                println!("Successfully parsed {} history entries", hist.len());
            }
            Err(e) => {
                panic!("Failed to parse session history: {}", e);
            }
        }
    }

    #[test]
    fn test_extract_browser_tracker_id() {
        // Test split arguments
        let cmd1 = vec![
            "C:\\Roblox\\RobloxPlayerBeta.exe".to_string(),
            "-b".to_string(),
            "123456789".to_string(),
            "-t".to_string(),
            "987654321".to_string(),
        ];
        assert_eq!(extract_browser_tracker_id(&cmd1), Some(123456789));

        // Test space-joined arguments (single string in cmd[0])
        let cmd2 = vec![
            "\"C:\\Roblox\\RobloxPlayerBeta.exe\" -b 9876543210 -t 111".to_string()
        ];
        assert_eq!(extract_browser_tracker_id(&cmd2), Some(9876543210));

        // Test browserTrackerId format
        let cmd3 = vec![
            "roblox-player:1+launchmode:play+browserTrackerId:55555+launchtime:222".to_string()
        ];
        assert_eq!(extract_browser_tracker_id(&cmd3), Some(55555));

        // Test browserTrackerId with equals
        let cmd4 = vec![
            "roblox-player:1+launchmode:play+browserTrackerId=77777".to_string()
        ];
        assert_eq!(extract_browser_tracker_id(&cmd4), Some(77777));

        // Test avoid matching prefix words like -bootstrap
        let cmd5 = vec![
            "-bootstrap".to_string(),
            "1234".to_string(),
            "-b".to_string(),
            "6666".to_string()
        ];
        assert_eq!(extract_browser_tracker_id(&cmd5), Some(6666));

        // Test no tracker ID
        let cmd6 = vec![
            "C:\\Roblox\\RobloxPlayerBeta.exe".to_string(),
            "-t".to_string(),
            "9999".to_string(),
        ];
        assert_eq!(extract_browser_tracker_id(&cmd6), None);
    }
}
