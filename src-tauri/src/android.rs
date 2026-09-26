//! Android glue: give cpal (via ndk-context) the JVM and application Context.

use jni::objects::{JClass, JObject};
use jni::JNIEnv;

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
