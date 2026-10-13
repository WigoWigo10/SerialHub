#[tauri::command]
pub fn display_refresh_rate(window: tauri::Window) -> Option<u32> {
    #[cfg(windows)]
    {
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::Graphics::Gdi::*;
        let hwnd = HWND(window.hwnd().ok()?.0);
        // Read the active mode of the monitor containing this window.
        // No display setting is changed.
        unsafe {
            let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFOEXW::default();
            info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
            if !GetMonitorInfoW(monitor, &mut info.monitorInfo).as_bool() {
                return None;
            }
            let mut mode = DEVMODEW::default();
            mode.dmSize = std::mem::size_of::<DEVMODEW>() as u16;
            if !EnumDisplaySettingsW(
                PCWSTR(info.szDevice.as_ptr()),
                ENUM_CURRENT_SETTINGS,
                &mut mode,
            )
            .as_bool()
            {
                return None;
            }
            (mode.dmDisplayFrequency > 1).then_some(mode.dmDisplayFrequency)
        }
    }
    #[cfg(not(windows))]
    {
        let _ = window;
        None
    }
}
