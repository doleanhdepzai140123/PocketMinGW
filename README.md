# PocketMinGW

An offline mobile C++17 workbench for HSG / competitive-programming practice. Android 12+ (API 31), iOS 16+. Development release, not yet a Code::Blocks replacement.

**The compiler is Clang 8 + libc++, not Windows MinGW.** The user-selected scope is C++17, STL, `bits/stdc++.h` and `.INP`/`.OUT`; Windows APIs and `.exe` execution are excluded. A bundled convenience `bits/stdc++.h` includes standard libc++ headers. GNU PBDS and GCC-specific ABI/extension parity are not claimed.

**No JIT for the compiler or user programs.** Both Clang/LLD and generated WebAssembly execute inside a native wasm3 interpreter on Android and iOS. There is no WebView WebAssembly fallback, executable-memory allocation for guest code, downloaded runtime, shell subprocess or JIT entitlement. The WebView displays the editor only.

## Current functionality

- C++ highlighting, bracket completion, undo/redo, search/replace, multiple tabs.
- Multiple projects, file creation/rename/delete with undo, nested paths, ZIP import/export.
- Autosave in `PocketMinGW` under the app's private Android files directory or iOS Documents. External imports are copied into this workspace.
- Multi-file C++17 builds, compiler diagnostics with source navigation.
- Supplied stdin, named INP/OUT files, test cases with token-based comparison.
- Stop, execution timeout, bounded output and guest linear memory. No host filesystem/network access for compiled code.
- Hallmark Console design, 44px touch targets, phone bottom navigation, coding key row, keyboard viewport handling.

## 0.1.1 fixes

- Fixed `memory allocation failed` on physical iPhones: disabled wasm3's automatic 1 TiB virtual guard arena. Both native builds use bounded heap allocation and explicit memory bounds checks. No JIT or extra entitlements are needed.
- Locked the outer app shell against zoom/panning. Editors and file panels retain their own scrolling; editor text starts at 16px to avoid iOS focus zoom.
- Workspace/project/test creation works on Android 12's original WebView, including versions without `crypto.randomUUID`.
- Native keyboard resize has a single owner. The coding key row docks above the keyboard, navigation hides while typing, and a dismiss button restores the full view.
- CI covers compiler execution under a 1 GiB virtual-address ceiling, out-of-bounds traps, and actual iPhone simulator keyboard open/close geometry. Physical-device retesting is still required for this correction.

## Build

Requires Node 24, CMake and a C compiler. Android additionally requires JDK 21 and Android SDK/NDK; iOS requires macOS/Xcode.

```sh
npm ci
npm run toolchain   # downloads pinned/checksummed assets at BUILD time
npm run check
npm run build
npx cap sync
node scripts/configure-native.mjs
```

`npm run dev` opens the editor preview. The browser preview deliberately does not execute C++; install a native build to run the interpreter.

Native compiler smoke tests (no JIT):

```sh
cmake -S native -B native/build -DCMAKE_BUILD_TYPE=Release
cmake --build native/build --config Release
node scripts/test-native.mjs
```

GitHub Actions builds a debug-signed Android APK and an **unsigned iPhone IPA**. The unsigned IPA is a build artifact, not an installable distribution: it must be signed/provisioned with the owner's Apple credentials. No signing keys belong in Git.

## Limits of this development release

- Not yet verified on physical Android 12 or iOS 16 hardware; inspect CI and test reports for actual evidence.
- A bundled 2019 Clang/WASI toolchain is used as a starting point. It is not a current hardened compiler distribution. Do not treat this development build as a sandbox for hostile third-party source.
- Compilation in an interpreter is slower than native GCC. Test timings are not comparable with a contest judge's CPU limits.
- No GDB debugger, breakpoints/watches, Code::Blocks plugins, native third-party libraries, Windows UI, threads, sockets or full desktop IDE parity.
- stdin is entered before running. Interactive terminal input while a program is paused is not implemented.
- 100 files/project; 2 MiB/file; 20 MiB/project input; 1 MiB stdout/stderr; 128 MiB guest program linear memory. Runtime bookkeeping/compiler memory is additional.
- Output-file retrieval currently uses the configured OUT filename. Arbitrarily named generated files are not automatically imported.
- Packaging is not App Store approval. iOS distribution still needs signing and device validation.

See [requirements](docs/requirements.md) and [third-party notices](THIRD_PARTY_NOTICES.md).
