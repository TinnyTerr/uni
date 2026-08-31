//! Persistence: the whole app state is a single JSON document written
//! atomically to the platform app-data directory.

use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no app data dir: {e}"))?;
    fs::create_dir_all(&dir).map_err(|e| format!("cannot create {}: {e}", dir.display()))?;
    Ok(dir)
}

fn data_file(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(data_dir(app)?.join("data.json"))
}

#[tauri::command]
pub fn data_location(app: AppHandle) -> Result<String, String> {
    Ok(data_file(&app)?.display().to_string())
}

/// Returns `null` when nothing has been saved yet, so the UI can seed defaults.
#[tauri::command]
pub fn load_state(app: AppHandle) -> Result<serde_json::Value, String> {
    let path = data_file(&app)?;
    if !path.exists() {
        return Ok(serde_json::Value::Null);
    }
    let raw = fs::read_to_string(&path).map_err(|e| format!("read {}: {e}", path.display()))?;
    serde_json::from_str(&raw).map_err(|e| format!("{} is not valid JSON: {e}", path.display()))
}

/// Write to a sibling temp file and rename, so a crash mid-write cannot
/// truncate an existing good save.
#[tauri::command]
pub fn save_state(app: AppHandle, state: serde_json::Value) -> Result<String, String> {
    let path = data_file(&app)?;
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?;
    fs::write(&tmp, body).map_err(|e| format!("write {}: {e}", tmp.display()))?;
    fs::rename(&tmp, &path).map_err(|e| format!("replace {}: {e}", path.display()))?;
    Ok(path.display().to_string())
}

/// Timestamped copy of the current save, for the "Back up now" button.
#[tauri::command]
pub fn backup_state(app: AppHandle, stamp: String) -> Result<String, String> {
    let path = data_file(&app)?;
    if !path.exists() {
        return Err("nothing saved yet".into());
    }
    let backups = data_dir(&app)?.join("backups");
    fs::create_dir_all(&backups).map_err(|e| e.to_string())?;
    let safe: String = stamp
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    let dest = backups.join(format!("data-{safe}.json"));
    fs::copy(&path, &dest).map_err(|e| format!("copy to {}: {e}", dest.display()))?;
    Ok(dest.display().to_string())
}
