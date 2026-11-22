// swift-tools-version: 5.9
import PackageDescription
let package = Package(
    name: "PocketRuntime",
    platforms: [.iOS(.v16)],
    products: [.library(name: "PocketRuntime", targets: ["PocketRuntime"])],
    dependencies: [.package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.6.2")],
    targets: [
        .target(name: "PocketCore", path: ".", sources: ["pocket.c", "vendor/cjson/cJSON.c", "vendor/wasm3/source"], publicHeadersPath: "include", cSettings: [.headerSearchPath("."), .headerSearchPath("vendor/cjson"), .headerSearchPath("vendor/wasm3/source"), .define("d_m3GuardedMemory", to: "0"), .define("d_m3SkipMemoryBoundsCheck", to: "0")]),
        .target(name: "PocketRuntime", dependencies: ["PocketCore", .product(name: "Capacitor", package: "capacitor-swift-pm")], path: "swift")
    ], cLanguageStandard: .c11
)
