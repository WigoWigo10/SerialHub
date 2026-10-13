use serde::Serialize;

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum GpuKind {
    Integrated,
    Dedicated,
    Unknown,
}

#[derive(Clone, Debug, Serialize)]
pub struct GpuInfo {
    pub name: String,
    pub kind: GpuKind,
}

fn gpu_kind(integrated: Option<bool>) -> GpuKind {
    match integrated {
        Some(true) => GpuKind::Integrated,
        Some(false) => GpuKind::Dedicated,
        None => GpuKind::Unknown,
    }
}

pub(crate) fn merge_names(mut adapters: Vec<GpuInfo>, names: Vec<String>) -> Vec<GpuInfo> {
    for name in names {
        if !name.trim().is_empty()
            && !adapters
                .iter()
                .any(|gpu| gpu.name.eq_ignore_ascii_case(&name))
        {
            adapters.push(GpuInfo {
                name,
                kind: GpuKind::Unknown,
            });
        }
    }
    adapters
}

pub fn graphics_adapters(wmi_names: Vec<String>) -> Vec<GpuInfo> {
    merge_names(native_adapters(), wmi_names)
}

#[cfg(not(windows))]
fn native_adapters() -> Vec<GpuInfo> {
    Vec::new()
}

#[cfg(windows)]
fn native_adapters() -> Vec<GpuInfo> {
    use windows::core::{s, w, Interface, GUID};
    use windows::Win32::Foundation::FreeLibrary;
    use windows::Win32::Graphics::DXCore::*;
    use windows::Win32::System::LibraryLoader::{
        GetProcAddress, LoadLibraryExW, LOAD_LIBRARY_SEARCH_SYSTEM32,
    };

    // Load dynamically: older Windows without DXCore still use all WMI adapters.
    unsafe {
        let Ok(module) = LoadLibraryExW(w!("dxcore.dll"), None, LOAD_LIBRARY_SEARCH_SYSTEM32)
        else {
            return Vec::new();
        };
        let result = (|| -> windows::core::Result<Vec<GpuInfo>> {
            let Some(proc) = GetProcAddress(module, s!("DXCoreCreateAdapterFactory")) else {
                return Ok(Vec::new());
            };
            type CreateFactory = unsafe extern "system" fn(
                *const GUID,
                *mut *mut core::ffi::c_void,
            ) -> windows::core::HRESULT;
            let create: CreateFactory = std::mem::transmute(proc);
            let mut raw = std::ptr::null_mut();
            create(&IDXCoreAdapterFactory::IID, &mut raw).ok()?;
            let factory = IDXCoreAdapterFactory::from_raw(raw);
            let list: IDXCoreAdapterList =
                factory.CreateAdapterList(&[DXCORE_ADAPTER_ATTRIBUTE_D3D11_GRAPHICS])?;
            let mut adapters = Vec::new();
            for index in 0..list.GetAdapterCount() {
                let Ok(adapter) = list.GetAdapter::<IDXCoreAdapter>(index) else {
                    continue;
                };
                if !adapter.IsValid() || bool_property(&adapter, IsHardware) != Some(true) {
                    continue;
                }
                let Ok(size) = adapter.GetPropertySize(DriverDescription) else {
                    continue;
                };
                if size == 0 || size > 65536 {
                    continue;
                }
                let mut description = vec![0u8; size];
                if adapter
                    .GetProperty(DriverDescription, size, description.as_mut_ptr().cast())
                    .is_err()
                {
                    continue;
                }
                let end = description
                    .iter()
                    .position(|byte| *byte == 0)
                    .unwrap_or(size);
                let name = String::from_utf8_lossy(&description[..end]).into_owned();
                if !name.trim().is_empty() {
                    adapters.push(GpuInfo {
                        name,
                        kind: gpu_kind(bool_property(&adapter, IsIntegrated)),
                    });
                }
            }
            Ok(adapters)
        })();
        // All DXCore COM objects above are dropped before unloading the DLL.
        let _ = FreeLibrary(module);
        result.unwrap_or_default()
    }
}

#[cfg(windows)]
unsafe fn bool_property(
    adapter: &windows::Win32::Graphics::DXCore::IDXCoreAdapter,
    property: windows::Win32::Graphics::DXCore::DXCoreAdapterProperty,
) -> Option<bool> {
    if !adapter.IsPropertySupported(property) {
        return None;
    }
    let mut value = 0u8; // DXCore bool properties are one byte, not Win32 BOOL.
    adapter
        .GetProperty(property, 1, (&mut value as *mut u8).cast())
        .ok()?;
    match value {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    }
}

pub fn recognized_npu(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.contains("ai boost")
        || lower.contains("neural")
        || lower.contains("ryzen ai")
        || lower
            .split(|ch: char| !ch.is_alphanumeric())
            .any(|word| word == "npu" || word == "ipu")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integrated_and_dedicated_use_driver_property_not_vendor() {
        assert_eq!(gpu_kind(Some(true)), GpuKind::Integrated);
        assert_eq!(gpu_kind(Some(false)), GpuKind::Dedicated);
        assert_eq!(gpu_kind(None), GpuKind::Unknown);
    }

    #[test]
    fn fallback_preserves_all_adapters_without_inventing_classification() {
        let adapters = merge_names(
            vec![GpuInfo {
                name: "Intel Arc".into(),
                kind: GpuKind::Integrated,
            }],
            vec![
                "intel arc".into(),
                "NVIDIA GeForce".into(),
                "AMD Radeon".into(),
                "".into(),
            ],
        );
        assert_eq!(adapters.len(), 3);
        assert_eq!(adapters[0].kind, GpuKind::Integrated);
        assert_eq!(adapters[1].kind, GpuKind::Unknown);
        assert_eq!(merge_names(Vec::new(), Vec::new()).len(), 0);
    }

    #[test]
    fn npu_matching_does_not_mistake_input_devices_for_processors() {
        for name in [
            "Intel(R) AI Boost",
            "AMD IPU Device",
            "Qualcomm NPU",
            "Neural Processor",
            "AMD Ryzen AI",
        ] {
            assert!(recognized_npu(name));
        }
        assert!(!recognized_npu("Microsoft Input Configuration Device"));
        assert!(!recognized_npu(""));
    }
}
