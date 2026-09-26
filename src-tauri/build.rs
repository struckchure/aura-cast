fn main() {
    // Oboe (cpal's Android audio backend) is C++ and links libc++ statically, but
    // recent NDKs keep the C++ ABI runtime in a separate libc++abi. Without it the
    // app crashes at load time with `cannot locate symbol "__cxa_pure_virtual"`.
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-link-lib=c++abi");
    }
    tauri_build::build()
}
