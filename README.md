# AuraCast

Stream audio between your devices over Wi-Fi. One device **sends** (its microphone, or everything it is playing) and any number of other devices **listen** and play it through their speakers.

AuraCast runs on **macOS, Windows and Android**, built with [Tauri 2](https://tauri.app), Rust and React.

## Download

Grab the latest build from [Releases](https://github.com/struckchure/aura-cast/releases/latest):

| Platform | File | Notes |
| --- | --- | --- |
| Android 7+ | `AuraCast-universal-release.apk` | Sideload it; allow installs from your browser or file manager when asked |
| Windows 10/11 | `AuraCast_x.y.z_x64-setup.exe` or `.msi` | Allow AuraCast through the firewall on private networks when asked |
| macOS (Apple Silicon & Intel) | `AuraCast_x.y.z_universal.dmg` | Drag to Applications. Not notarized yet: right-click > **Open** the first time |

## Using it

1. Put the devices on the same Wi-Fi or local network.
2. On the device that has the audio, open **Send**, pick a source and tap **Start broadcasting**.
3. On the other devices, open **Listen** and tap the sender under *Devices broadcasting nearby*.

If a sender does not show up (some routers block the discovery traffic), type the address the sender displays, e.g. `192.168.1.20:47800`, into **Connect by address**.

While listening you can change the volume, the speaker it plays through, and the buffering: **Low delay** (50 ms) to **Weak Wi-Fi** (500 ms). More buffering means fewer dropouts on a busy network, at the cost of delay. A device can send and listen at the same time.

### What you can send

| Source | macOS | Windows | Android |
| --- | --- | --- | --- |
| Microphone / audio inputs | ✅ | ✅ | ✅ |
| System audio (everything playing) | ✅ macOS 14.2+ | ✅ | ✅ Android 10+ |
| Test tone (440 Hz) | ✅ | ✅ | ✅ |

- **macOS** asks once for *Microphone* or *System Audio Recording* permission. AuraCast's own playback is excluded from system audio, so a Mac that is also listening does not echo.
- **Android** asks for the microphone when you first broadcast, and shows the system *Start recording or casting* screen before sharing system audio. A notification stays up while sharing. Apps can opt out of being captured, so some (and phone calls) stay silent.
- The **test tone** is handy for checking a connection without playing anything.

## How it works

```
 Sender                                           Listener(s)
 ───────────────────────────────                  ──────────────────────────────────
 capture (cpal / Core Audio tap /                 UDP ─► jitter buffer (reorder,
 Android playback capture)                               loss concealment, drift control)
   ─► resample to 48 kHz stereo                        ─► Opus decode ─► resample
   ─► Opus encode, 20 ms frames  ── UDP :47800 ──►     ─► speaker (cpal)
 mDNS: _auracast._udp  ◄──────── discovery ───────  browse
```

- **Discovery:** senders advertise `_auracast._udp.local.` over mDNS while broadcasting ([discovery.rs](src-tauri/src/discovery.rs)).
- **Transport:** listeners send a `Subscribe` packet to the sender every second; the sender streams to every listener heard from in the last 5 s. Each packet carries a 20-byte header (magic, stream id, sequence number, sample position) and one Opus frame at 128 kb/s ([protocol.rs](src-tauri/src/protocol.rs)).
- **Playback:** the receiver keeps a jitter buffer at the chosen latency, conceals lost packets with Opus PLC, and skips ahead if packets pile up because the two devices' clocks drift apart ([receiver.rs](src-tauri/src/receiver.rs)).
- **Capture:** [sender.rs](src-tauri/src/sender.rs) handles cpal inputs and WASAPI loopback, [macos_tap.rs](src-tauri/src/macos_tap.rs) handles Core Audio process taps, and [SystemAudioService.kt](src-tauri/gen/android/app/src/main/java/com/auracast/speaker/SystemAudioService.kt) handles Android playback capture.

Multiple listeners play at roughly the same time but are not sample-synchronised.

## Building from source

Requirements: [Node.js 24](https://nodejs.org), [pnpm 10](https://pnpm.io), [Rust](https://rustup.rs) (stable), plus the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS.

```bash
pnpm install
pnpm tauri dev          # run the desktop app with hot reload
pnpm tauri build        # installers in src-tauri/target/release/bundle/
```

For a universal macOS build, add both targets first:

```bash
rustup target add aarch64-apple-darwin x86_64-apple-darwin
pnpm tauri build --target universal-apple-darwin
```

### Android

Install the Android SDK, NDK and the Rust Android targets, then point the build at the NDK. `ANDROID_NDK_ROOT` is needed so CMake can cross-compile libopus.

```bash
rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
export ANDROID_HOME=~/Library/Android/sdk
export NDK_HOME=$ANDROID_HOME/ndk/<version>
export ANDROID_NDK_ROOT=$NDK_HOME
pnpm tauri android build --apk
```

The Android project lives in `src-tauri/gen/android` and is committed: it carries the permissions, the Wi-Fi multicast lock for discovery, and the system-audio service. Do not regenerate it with `tauri android init`.

### Tests

```bash
cd src-tauri
cargo test                                      # unit tests
cargo test streams_end_to_end -- --ignored      # full localhost stream (needs an audio output)
```

There are also manual tools, run with `-- --ignored --nocapture`: `manual_send_tone` broadcasts the test tone, and `manual_listen` (with `AURACAST_ADDR=ip:port`) prints live receiver stats.

## Releases and CI

Every push to `main` builds Windows, macOS and Android in [GitHub Actions](.github/workflows/build-and-release.yml) and publishes a GitHub release. The Android APK is signed with a release keystore stored in these repository secrets:

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the `.keystore` file, base64-encoded |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_ALIAS` | key alias |
| `ANDROID_KEY_PASSWORD` | key password |

Keep a backup of the keystore: Android only installs updates signed with the same key.

macOS builds are ad-hoc signed, so macOS asks for permissions again after each update and warns about an unidentified developer. Signing with an Apple Developer ID and notarizing would remove both.

## Known limitations

- Listeners are not clock-synchronised, so several speakers in one room can be slightly out of step.
- On Android, playback may stop if the app is in the background while *listening*. Sending system audio keeps running thanks to its foreground service.
- Discovery needs multicast; on networks that block it, connect by address.
