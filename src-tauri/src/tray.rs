//! The menu bar item (macOS only). The frontend already knows how to expand
//! the timetable, so it sends a ready-made title and list of lines here and
//! this side only draws them; on other platforms the command is a no-op.

use serde::Deserialize;

#[derive(Deserialize)]
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub struct TrayState {
    /// Text shown in the menu bar itself.
    pub title: String,
    /// Disabled, informational rows in the dropdown.
    pub lines: Vec<String>,
}

#[cfg(target_os = "macos")]
#[tauri::command]
pub fn set_tray(app: tauri::AppHandle, state: TrayState) -> Result<(), String> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::TrayIconBuilder;
    use tauri::Manager;

    const ID: &str = "timetable";
    let handle = app.clone();

    // Menus and status items must be touched from the main thread.
    app.run_on_main_thread(move || {
        let build = || -> tauri::Result<Menu<tauri::Wry>> {
            let menu = Menu::new(&handle)?;
            for line in &state.lines {
                menu.append(&MenuItem::new(&handle, line, false, None::<&str>)?)?;
            }
            if !state.lines.is_empty() {
                menu.append(&PredefinedMenuItem::separator(&handle)?)?;
            }
            menu.append(&MenuItem::with_id(&handle, "open", "Open Uni Schedule", true, None::<&str>)?)?;
            menu.append(&PredefinedMenuItem::quit(&handle, None)?)?;
            Ok(menu)
        };
        let Ok(menu) = build() else { return };

        if let Some(tray) = handle.tray_by_id(ID) {
            let _ = tray.set_menu(Some(menu));
            let _ = tray.set_title(Some(&state.title));
        } else {
            let _ = TrayIconBuilder::with_id(ID)
                .title(&state.title)
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id().as_ref() == "open" {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.unminimize();
                            let _ = w.set_focus();
                        }
                    }
                })
                .build(&handle);
        }
    })
    .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn set_tray(_state: TrayState) {}
