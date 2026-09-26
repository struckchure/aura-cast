//! Android glue: give cpal (via ndk-context) the JVM and application Context,
//! and receive system audio captured by `SystemAudioService` (Kotlin).

use jni::objects::{JClass, JFloatArray, JObject};
use jni::sys::jint;
use jni::JNIEnv;
use std::ffi::{c_char, c_int, CStr};
use std::sync::mpsc::SyncSender;
use std::sync::Mutex;

/// Where captured system audio goes while a "system audio" broadcast is running.
static SYSTEM_AUDIO_SINK: Mutex<Option<SyncSender<Vec<f32>>>> = Mutex::new(None);

pub fn set_system_audio_sink(sink: Option<SyncSender<Vec<f32>>>) {
    *SYSTEM_AUDIO_SINK.lock().unwrap_or_else(|p| p.into_inner()) = sink;
}

/// Called by `SystemAudioService` with 48 kHz interleaved stereo samples.
#[no_mangle]
pub extern "system" fn Java_com_auracast_speaker_SystemAudioService_pushAudio(
    env: JNIEnv,
    _this: JObject,
    samples: JFloatArray,
    len: jint,
) {
    let sink = SYSTEM_AUDIO_SINK.lock().unwrap_or_else(|p| p.into_inner());
    let Some(tx) = sink.as_ref() else { return };
    let mut chunk = vec![0f32; len.max(0) as usize];
    if env.get_float_array_region(&samples, 0, &mut chunk).is_ok() {
        // Drop audio rather than block the capture thread if the encoder falls behind
        let _ = tx.try_send(chunk);
    }
}

/// Capturing other apps' audio needs Android 10 (API 29) or later.
pub fn supports_playback_capture() -> bool {
    extern "C" {
        fn __system_property_get(name: *const c_char, value: *mut c_char) -> c_int;
    }
    let mut value = [0 as c_char; 92];
    unsafe { __system_property_get(c"ro.build.version.sdk".as_ptr(), value.as_mut_ptr()) };
    let sdk: i32 = unsafe { CStr::from_ptr(value.as_ptr()) }
        .to_str()
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    sdk >= 29
}

/// Called from `MainActivity.onCreate` before any audio device is touched.
#[no_mangle]
pub extern "system" fn Java_com_auracast_speaker_MainActivity_initAudioContext(
    env: JNIEnv,
    _class: JClass,
    context: JObject,
) {
    static INIT: std::sync::Once = std::sync::Once::new();
    INIT.call_once(|| {
        let vm = match env.get_java_vm() {
            Ok(vm) => vm,
            Err(e) => return eprintln!("[auracast] could not get JavaVM: {e}"),
        };
        // ndk-context keeps the raw pointer for the life of the process, so the
        // global reference is intentionally leaked
        let context = match env.new_global_ref(context) {
            Ok(global) => global,
            Err(e) => return eprintln!("[auracast] could not reference Context: {e}"),
        };
        let raw = context.as_obj().as_raw();
        std::mem::forget(context);
        unsafe {
            ndk_context::initialize_android_context(vm.get_java_vm_pointer().cast(), raw.cast())
        };
    });
}
