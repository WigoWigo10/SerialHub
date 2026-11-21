use serde::Serialize;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub struct PowerStatus {
    pub ac_online: Option<bool>,
    pub battery_present: Option<bool>,
    pub charging: Option<bool>,
    pub percent: Option<u8>,
    pub remaining_seconds: Option<u32>,
    pub battery_saver: Option<bool>,
}

#[cfg(windows)]
fn decode(status: windows::Win32::System::Power::SYSTEM_POWER_STATUS) -> PowerStatus {
    const UNKNOWN: u8 = 255;
    const NO_BATTERY: u8 = 128;
    const CHARGING: u8 = 8;

    let ac_online = match status.ACLineStatus {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    };
    let flags = status.BatteryFlag;
    let percent = (status.BatteryLifePercent <= 100
        && (flags == UNKNOWN || flags & NO_BATTERY == 0))
        .then_some(status.BatteryLifePercent);
    let battery_present = if flags == UNKNOWN {
        percent.map(|_| true)
    } else {
        Some(flags & NO_BATTERY == 0)
    };
    let charging =
        (battery_present == Some(true) && flags != UNKNOWN).then_some(flags & CHARGING != 0);

    PowerStatus {
        ac_online,
        battery_present,
        charging,
        percent,
        remaining_seconds: (battery_present == Some(true)
            && ac_online == Some(false)
            && charging != Some(true)
            && status.BatteryLifeTime != u32::MAX)
            .then_some(status.BatteryLifeTime),
        battery_saver: match status.SystemStatusFlag {
            0 => Some(false),
            1 => Some(true),
            _ => None,
        },
    }
}

#[cfg(windows)]
pub fn read_status() -> Option<PowerStatus> {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    let mut status = SYSTEM_POWER_STATUS::default();
    // The pointer is writable and remains valid for the duration of the call.
    unsafe { GetSystemPowerStatus(&mut status) }.ok()?;
    Some(decode(status))
}

#[cfg(not(windows))]
pub fn read_status() -> Option<PowerStatus> {
    None
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use windows::Win32::System::Power::SYSTEM_POWER_STATUS;

    fn status(ac: u8, flags: u8, percent: u8, seconds: u32) -> PowerStatus {
        decode(SYSTEM_POWER_STATUS {
            ACLineStatus: ac,
            BatteryFlag: flags,
            BatteryLifePercent: percent,
            BatteryLifeTime: seconds,
            SystemStatusFlag: 1,
            ..Default::default()
        })
    }

    #[test]
    fn distinguishes_external_power_from_active_charging() {
        let plugged_in = status(1, 1, 68, u32::MAX);
        assert_eq!(plugged_in.ac_online, Some(true));
        assert_eq!(plugged_in.charging, Some(false));
        assert_eq!(plugged_in.percent, Some(68));
        assert_eq!(plugged_in.remaining_seconds, None);
        assert_eq!(status(1, 9, 68, u32::MAX).charging, Some(true));
    }

    #[test]
    fn reads_remaining_life_only_when_on_battery() {
        let unplugged = status(0, 2, 20, 3600);
        assert_eq!(unplugged.ac_online, Some(false));
        assert_eq!(unplugged.remaining_seconds, Some(3600));
        assert_eq!(unplugged.battery_saver, Some(true));
        assert_eq!(status(0, 2, 20, u32::MAX).remaining_seconds, None);
    }

    #[test]
    fn distinguishes_an_absent_battery_from_unknown_telemetry() {
        let desktop = status(1, 128, 255, u32::MAX);
        assert_eq!(desktop.battery_present, Some(false));
        assert_eq!(desktop.percent, None);
        let unknown = status(255, 255, 255, u32::MAX);
        assert_eq!(unknown.battery_present, None);
        assert_eq!(unknown.charging, None);
        assert_eq!(unknown.ac_online, None);
        assert_eq!(status(1, 255, 62, u32::MAX).battery_present, Some(true));
    }
}
