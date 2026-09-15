// Prevents an extra console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // WebKitGTK's DMA-BUF/EGL renderer aborts with EGL_BAD_PARAMETER on some
    // Intel/Mesa setups instead of falling back to software rendering.
    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");

    uni_schedule_lib::run()
}
