// Hide the console window on Windows (debug and release builds)
#![windows_subsystem = "windows"]

fn main() {
    tauri_app_lib::run()
}
