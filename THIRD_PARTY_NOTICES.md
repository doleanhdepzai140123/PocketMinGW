# Third-party components

- **binji/wasm-clang**, commit `648c4a89997a351eef75cdaec3ef5b89d4937dec`. Clang, LLD, libc++, WASI sysroot and MemFS from the author's CppCon 2019 demonstration. [Source](https://github.com/binji/wasm-clang), [build notes](https://gist.github.com/binji/b7541f9740c21d7c6dac95cbc9ea6fca). The corresponding Apache 2.0 and LLVM license texts are bundled under `public/toolchain`. `LICENSE.vasm` is unused and no 6502 assembler is shipped.
- **wasm3**, commit `28ecb9af6d2040e474a70f7cb7f43666740141fb`, MIT, [source](https://github.com/wasm3/wasm3). The build script patches its yield hook for cancellation and deadlines. The interpreter translates to internal threaded operations, not executable machine code.
- **cJSON** 1.7.19, MIT, [source](https://github.com/DaveGamble/cJSON). License downloaded alongside its source.
- **React**, **Capacitor**, **CodeMirror**, **Lucide**, **fflate** and bundled fonts: see their package license files in the pinned npm dependency tree. Host Grotesk and Atkinson Hyperlegible Mono font licenses are distributed through Fontsource.

`toolchain.lock.json` records exact asset URLs and SHA-256 checksums. Build preparation only retrieves these pinned resources. End users do not download toolchains at runtime.
