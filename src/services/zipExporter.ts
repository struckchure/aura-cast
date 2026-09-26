import JSZip from 'jszip';
import { tauriBridge } from '../services/tauriBridge';

export async function exportTauriProjectZip(): Promise<Blob> {
  const zip = new JSZip();
  const rustFiles = tauriBridge.getRustSourceCode();

  // Root files
  zip.file('README.md', `# AuraCast - Tauri Wireless Audio Speaker

Turn your Android phone, Windows PC, or Mac into a high-fidelity Bluetooth A2DP & Wi-Fi wireless speaker receiver and transmitter.

## Building Native Binaries

### Prerequisites
- Node.js 18+ & npm
- Rust toolchain: https://rustup.rs/

### Windows Desktop (.msi / .exe)
\`\`\`bash
npm install
npm run build
cargo tauri build
\`\`\`
The installer will be generated in \`src-tauri/target/release/bundle/msi/\`.

### macOS Desktop (.dmg / .app)
\`\`\`bash
npm install
npm run build
cargo tauri build --target universal-apple-darwin
\`\`\`
The disk image will be generated in \`src-tauri/target/universal-apple-darwin/bundle/dmg/\`.

### Android APK (.apk)
\`\`\`bash
cargo tauri android init
cargo tauri android build --apk
\`\`\`
The APK will be generated in \`gen/android/app/build/outputs/apk/release/app-universal-release.apk\`.
`);

  // src-tauri folder
  const srcTauri = zip.folder('src-tauri')!;
  srcTauri.file('Cargo.toml', rustFiles.cargoToml);
  srcTauri.file('tauri.conf.json', rustFiles.tauriConf);

  const srcDir = srcTauri.folder('src')!;
  srcDir.file('main.rs', rustFiles.mainRs);

  return await zip.generateAsync({ type: 'blob' });
}
