mod notes;
mod store;
mod tray;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init());

    // The updater replaces the installed binary, which only means anything on
    // a desktop build; the mobile targets skip both plugins entirely.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    builder
        .invoke_handler(tauri::generate_handler![
            store::load_state,
            store::save_state,
            store::backup_state,
            store::data_location,
            store::write_text_file,
            notes::notes_index,
            notes::notes_read,
            notes::notes_search,
            notes::notes_git_info,
            tray::set_tray,
        ])
        .run(tauri::generate_context!())
        .expect("error while running uni-schedule");
}
