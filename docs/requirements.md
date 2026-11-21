# PocketMinGW requirements

User decisions, 2026-11-21:

- Android 12+ (API 31), iOS 16+.
- Completely offline after installation; bundle compiler and standard library.
- No JIT on iOS. Compiler and user code must execute in a native interpreter; never use WebView WebAssembly as an iOS fallback.
- HSG practice takes precedence over Windows ABI: C++17, STL, bits/stdc++.h, INP/OUT. Windows APIs and EXE are not required.
- MinGW is the product's original inspiration/name, not a false claim about the selected compiler. Describe Clang accurately.
- Multiple editor tabs, project/file access inside PocketMinGW's own folder.
- Hallmark-designed phone UI with usable keyboard, safe areas, compact navigation.
- Code::Blocks is the long-term feature benchmark; do not claim debugger, plugin, GNU extension or desktop parity until implemented and tested.
- All source goes into github.com/doleanhdepzai140123/PocketMinGW (private).

Distribution is separate from compilation: an unsigned iOS build cannot be installed on an iPhone without signing/provisioning. Device and simulator test results must be reported separately.
