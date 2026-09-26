//! macOS system-audio capture with Core Audio process taps (macOS 14.2+).
//!
//! A tap mirrors everything the Mac is playing. It is read through a private
//! aggregate device with our own IOProc, not through an input AudioUnit (as
//! cpal would): that path counts as microphone use and triggers the
//! microphone prompt, while this one only needs "System Audio Recording".
//!
//! The tap APIs are looked up at runtime so the app still launches on older
//! macOS versions; there this source is simply not offered.

use core_foundation::array::CFArray;
use core_foundation::base::{CFType, TCFType};
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::number::CFNumber;
use core_foundation::string::{CFString, CFStringRef};
use objc2::msg_send;
use objc2::rc::{Allocated, Retained};
use objc2::runtime::{AnyClass, AnyObject};
use std::ffi::{c_char, c_void};
use std::sync::mpsc::SyncSender;

type AudioObjectID = u32;
type OSStatus = i32;

#[repr(C)]
struct AudioObjectPropertyAddress {
    selector: u32,
    scope: u32,
    element: u32,
}

const fn fourcc(code: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*code)
}

const SYSTEM_OBJECT: AudioObjectID = 1;
const SCOPE_GLOBAL: u32 = fourcc(b"glob");
const ELEMENT_MAIN: u32 = 0;
const PROP_TRANSLATE_PID: u32 = fourcc(b"id2p");
const PROP_DEFAULT_OUTPUT: u32 = fourcc(b"dOut");
const PROP_DEVICE_UID: u32 = fourcc(b"uid ");
const PROP_TAP_FORMAT: u32 = fourcc(b"tfmt");

const DEVICE_NAME: &str = "AuraCast System Audio";

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyData(
        object: AudioObjectID,
        address: *const AudioObjectPropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        data_size: *mut u32,
        data: *mut c_void,
    ) -> OSStatus;
    fn AudioHardwareCreateAggregateDevice(
        description: *const c_void,
        device: *mut AudioObjectID,
    ) -> OSStatus;
    fn AudioHardwareDestroyAggregateDevice(device: AudioObjectID) -> OSStatus;
    fn AudioDeviceCreateIOProcID(
        device: AudioObjectID,
        proc_: IOProc,
        client_data: *mut c_void,
        proc_id: *mut *mut c_void,
    ) -> OSStatus;
    fn AudioDeviceDestroyIOProcID(device: AudioObjectID, proc_id: *mut c_void) -> OSStatus;
    fn AudioDeviceStart(device: AudioObjectID, proc_id: *mut c_void) -> OSStatus;
    fn AudioDeviceStop(device: AudioObjectID, proc_id: *mut c_void) -> OSStatus;
}

#[repr(C)]
struct AudioBuffer {
    channels: u32,
    byte_size: u32,
    data: *mut c_void,
}

#[repr(C)]
struct AudioBufferList {
    count: u32,
    buffers: [AudioBuffer; 1], // variable length
}

#[repr(C)]
#[derive(Default)]
struct StreamDescription {
    sample_rate: f64,
    format_id: u32,
    format_flags: u32,
    bytes_per_packet: u32,
    frames_per_packet: u32,
    bytes_per_frame: u32,
    channels_per_frame: u32,
    bits_per_channel: u32,
    reserved: u32,
}

const FORMAT_FLAG_FLOAT: u32 = 1;

type IOProc = unsafe extern "C" fn(
    device: AudioObjectID,
    now: *const c_void,
    input: *const AudioBufferList,
    input_time: *const c_void,
    output: *mut AudioBufferList,
    output_time: *const c_void,
    client_data: *mut c_void,
) -> OSStatus;

extern "C" {
    fn dlsym(handle: *mut c_void, symbol: *const c_char) -> *mut c_void;
}
const RTLD_DEFAULT: *mut c_void = -2isize as *mut c_void;

type CreateTapFn =
    unsafe extern "C" fn(description: *mut AnyObject, tap: *mut AudioObjectID) -> OSStatus;
type DestroyTapFn = unsafe extern "C" fn(tap: AudioObjectID) -> OSStatus;

struct TapApi {
    create: CreateTapFn,
    destroy: DestroyTapFn,
    description_class: &'static AnyClass,
}

fn tap_api() -> Option<TapApi> {
    unsafe {
        let create = dlsym(RTLD_DEFAULT, c"AudioHardwareCreateProcessTap".as_ptr());
        let destroy = dlsym(RTLD_DEFAULT, c"AudioHardwareDestroyProcessTap".as_ptr());
        if create.is_null() || destroy.is_null() {
            return None;
        }
        Some(TapApi {
            create: std::mem::transmute::<*mut c_void, CreateTapFn>(create),
            destroy: std::mem::transmute::<*mut c_void, DestroyTapFn>(destroy),
            description_class: AnyClass::get(c"CATapDescription")?,
        })
    }
}

/// Whether this Mac supports system-audio taps (macOS 14.2 or later).
pub fn is_supported() -> bool {
    tap_api().is_some()
}

pub struct SystemTap {
    tap: AudioObjectID,
    aggregate: AudioObjectID,
    destroy_tap: DestroyTapFn,
}

// The IDs are plain integers owned by the Core Audio server
unsafe impl Send for SystemTap {}

impl SystemTap {
    pub fn create() -> Result<Self, String> {
        let api = tap_api().ok_or("Sharing system audio needs macOS 14.2 or later")?;
        unsafe {
            // Leave AuraCast's own playback out, so a Mac that is also listening does not echo
            let excluded: Vec<CFNumber> = own_process_object()
                .map(|id| CFNumber::from(id as i64))
                .into_iter()
                .collect();
            let excluded = CFArray::from_CFTypes(&excluded);

            let description: Allocated<AnyObject> = msg_send![api.description_class, alloc];
            let description: Option<Retained<AnyObject>> = msg_send![
                description,
                initStereoGlobalTapButExcludeProcesses: excluded.as_concrete_TypeRef() as *const AnyObject
            ];
            let description = description.ok_or("Could not describe the system audio tap")?;
            let name = CFString::new("AuraCast");
            let _: () =
                msg_send![&*description, setName: name.as_concrete_TypeRef() as *const AnyObject];
            let _: () = msg_send![&*description, setPrivate: true];
            let uuid: Retained<AnyObject> = msg_send![&*description, UUID];
            let uuid: *const AnyObject = msg_send![&*uuid, UUIDString];
            let tap_uid = CFString::wrap_under_get_rule(uuid as CFStringRef).to_string();

            let mut tap: AudioObjectID = 0;
            let status = (api.create)(Retained::as_ptr(&description) as *mut AnyObject, &mut tap);
            if status != 0 || tap == 0 {
                return Err(format!(
                    "macOS refused to create the system audio tap (error {status})"
                ));
            }

            match create_aggregate(&tap_uid) {
                Ok(aggregate) => Ok(Self {
                    tap,
                    aggregate,
                    destroy_tap: api.destroy,
                }),
                Err(e) => {
                    (api.destroy)(tap);
                    Err(e)
                }
            }
        }
    }
}

struct CaptureState {
    tx: SyncSender<Vec<f32>>,
    interleaved: bool,
}

/// A running capture; stops when dropped.
pub struct TapCapture {
    device: AudioObjectID,
    proc_id: *mut c_void,
    state: *mut CaptureState,
}

unsafe impl Send for TapCapture {}

impl SystemTap {
    /// Sample rate and channel count of the audio `start` delivers (interleaved f32).
    pub fn format(&self) -> Result<(u32, usize), String> {
        let format = unsafe { get_property::<StreamDescription>(self.tap, PROP_TAP_FORMAT, None) }
            .ok_or("Could not read the system audio format")?;
        if format.format_flags & FORMAT_FLAG_FLOAT == 0 || format.bits_per_channel != 32 {
            return Err("Unsupported system audio format".into());
        }
        Ok((
            format.sample_rate as u32,
            format.channels_per_frame as usize,
        ))
    }

    /// Start delivering interleaved f32 chunks to `tx`.
    pub fn start(&self, tx: SyncSender<Vec<f32>>) -> Result<TapCapture, String> {
        let format = unsafe { get_property::<StreamDescription>(self.tap, PROP_TAP_FORMAT, None) }
            .ok_or("Could not read the system audio format")?;
        let state = Box::into_raw(Box::new(CaptureState {
            tx,
            interleaved: format.format_flags & (1 << 5) == 0,
        }));
        unsafe {
            let mut proc_id: *mut c_void = std::ptr::null_mut();
            let status =
                AudioDeviceCreateIOProcID(self.aggregate, io_proc, state.cast(), &mut proc_id);
            if status != 0 {
                drop(Box::from_raw(state));
                return Err(format!(
                    "Could not start system audio capture (error {status})"
                ));
            }
            let status = AudioDeviceStart(self.aggregate, proc_id);
            if status != 0 {
                AudioDeviceDestroyIOProcID(self.aggregate, proc_id);
                drop(Box::from_raw(state));
                return Err(format!(
                    "Could not start system audio capture (error {status})"
                ));
            }
            Ok(TapCapture {
                device: self.aggregate,
                proc_id,
                state,
            })
        }
    }
}

impl Drop for TapCapture {
    fn drop(&mut self) {
        unsafe {
            // Stop and destroy wait for any in-flight callback, so freeing the state after is safe
            AudioDeviceStop(self.device, self.proc_id);
            AudioDeviceDestroyIOProcID(self.device, self.proc_id);
            drop(Box::from_raw(self.state));
        }
    }
}

unsafe extern "C" fn io_proc(
    _device: AudioObjectID,
    _now: *const c_void,
    input: *const AudioBufferList,
    _input_time: *const c_void,
    _output: *mut AudioBufferList,
    _output_time: *const c_void,
    client_data: *mut c_void,
) -> OSStatus {
    let state = &*(client_data as *const CaptureState);
    let Some(list) = input.as_ref() else { return 0 };
    let buffers = std::slice::from_raw_parts(list.buffers.as_ptr(), list.count as usize);

    let chunk = if state.interleaved || buffers.len() == 1 {
        let Some(buf) = buffers.first().filter(|b| !b.data.is_null()) else {
            return 0;
        };
        std::slice::from_raw_parts(buf.data as *const f32, buf.byte_size as usize / 4).to_vec()
    } else {
        // One buffer per channel: interleave them
        let planes: Vec<&[f32]> = buffers
            .iter()
            .filter(|b| !b.data.is_null())
            .map(|b| std::slice::from_raw_parts(b.data as *const f32, b.byte_size as usize / 4))
            .collect();
        let frames = planes.iter().map(|p| p.len()).min().unwrap_or(0);
        let mut out = Vec::with_capacity(frames * planes.len());
        for i in 0..frames {
            for plane in &planes {
                out.push(plane[i]);
            }
        }
        out
    };
    // Drop audio rather than block Core Audio's real-time thread
    let _ = state.tx.try_send(chunk);
    0
}

impl Drop for SystemTap {
    fn drop(&mut self) {
        unsafe {
            AudioHardwareDestroyAggregateDevice(self.aggregate);
            (self.destroy_tap)(self.tap);
        }
    }
}

unsafe fn create_aggregate(tap_uid: &str) -> Result<AudioObjectID, String> {
    let key = |k: &str| CFString::new(k);
    let string = |s: &str| CFString::new(s).as_CFType();
    let yes = CFBoolean::true_value().as_CFType();
    let no = CFBoolean::false_value().as_CFType();

    let tap_entry: CFDictionary<CFString, CFType> = CFDictionary::from_CFType_pairs(&[
        (key("uid"), string(tap_uid)),
        (key("drift"), yes.clone()),
    ]);

    let mut pairs: Vec<(CFString, CFType)> = vec![
        (key("name"), string(DEVICE_NAME)),
        (
            key("uid"),
            string(&format!(
                "com.auracast.system-tap.{:016x}",
                crate::random_u64()
            )),
        ),
        (key("private"), yes.clone()),
        (key("stacked"), no),
        (key("tapautostart"), yes),
        (key("taps"), CFArray::from_CFTypes(&[tap_entry]).as_CFType()),
    ];
    // Clock the aggregate from the current output device, as Apple's sample code does
    if let Some(output_uid) = default_output_uid() {
        let sub: CFDictionary<CFString, CFType> =
            CFDictionary::from_CFType_pairs(&[(key("uid"), string(&output_uid))]);
        pairs.push((key("master"), string(&output_uid)));
        pairs.push((key("subdevices"), CFArray::from_CFTypes(&[sub]).as_CFType()));
    }
    let description = CFDictionary::from_CFType_pairs(&pairs);

    let mut device: AudioObjectID = 0;
    let status = AudioHardwareCreateAggregateDevice(
        description.as_concrete_TypeRef() as *const c_void,
        &mut device,
    );
    if status != 0 || device == 0 {
        return Err(format!(
            "Could not set up system audio capture (error {status})"
        ));
    }
    Ok(device)
}

unsafe fn get_property<T: Default>(
    object: AudioObjectID,
    selector: u32,
    qualifier: Option<&i32>,
) -> Option<T> {
    let address = AudioObjectPropertyAddress {
        selector,
        scope: SCOPE_GLOBAL,
        element: ELEMENT_MAIN,
    };
    let mut value = T::default();
    let mut size = std::mem::size_of::<T>() as u32;
    let (q_size, q_ptr) = match qualifier {
        Some(q) => (
            std::mem::size_of::<i32>() as u32,
            q as *const i32 as *const c_void,
        ),
        None => (0, std::ptr::null()),
    };
    let status = AudioObjectGetPropertyData(
        object,
        &address,
        q_size,
        q_ptr,
        &mut size,
        &mut value as *mut T as *mut c_void,
    );
    (status == 0).then_some(value)
}

unsafe fn own_process_object() -> Option<AudioObjectID> {
    let pid = std::process::id() as i32;
    get_property::<AudioObjectID>(SYSTEM_OBJECT, PROP_TRANSLATE_PID, Some(&pid))
        .filter(|id| *id != 0)
}

unsafe fn default_output_uid() -> Option<String> {
    let device = get_property::<AudioObjectID>(SYSTEM_OBJECT, PROP_DEFAULT_OUTPUT, None)
        .filter(|id| *id != 0)?;
    let uid =
        get_property::<usize>(device, PROP_DEVICE_UID, None).filter(|p| *p != 0)? as CFStringRef;
    // The UID is returned retained ("Copy" semantics)
    Some(CFString::wrap_under_create_rule(uid).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Manual: `cargo test tap_delivers_audio -- --ignored --nocapture` while audio plays.
    #[test]
    #[ignore = "manual tool; needs System Audio Recording permission"]
    fn tap_delivers_audio() {
        let tap = SystemTap::create().expect("tap");
        println!("format: {:?}", tap.format());
        let (tx, rx) = std::sync::mpsc::sync_channel(1024);
        let capture = tap.start(tx).expect("start");
        let (mut chunks, mut samples, mut peak) = (0usize, 0usize, 0f32);
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while std::time::Instant::now() < deadline {
            if let Ok(chunk) = rx.recv_timeout(std::time::Duration::from_millis(100)) {
                chunks += 1;
                samples += chunk.len();
                peak = chunk.iter().fold(peak, |p, s| p.max(s.abs()));
            }
        }
        drop(capture);
        println!("chunks={chunks} samples={samples} peak={peak}");
    }
}
