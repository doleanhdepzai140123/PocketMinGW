import Foundation
import Capacitor
import PocketCore

@objc(PocketRuntimePlugin)
public class PocketRuntimePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "PocketRuntimePlugin"
    public let jsName = "PocketRuntime"
    public let pluginMethods: [CAPPluginMethod] = [CAPPluginMethod(name: "run", returnType: CAPPluginReturnPromise), CAPPluginMethod(name: "cancel", returnType: CAPPluginReturnPromise)]
    private let worker = DispatchQueue(label: "com.pocketmingw.interpreter", qos: .userInitiated)
    private let lock = NSLock()
    private var running = false

    @objc func run(_ call: CAPPluginCall) {
        guard let request = call.getString("request"), request.utf8.count <= 20 * 1024 * 1024 else { call.reject("Invalid request size"); return }
        lock.lock()
        if running { lock.unlock(); call.reject("Compiler is already running"); return }
        running = true; lock.unlock()
        worker.async {
            defer { self.lock.lock(); self.running = false; self.lock.unlock() }
            guard let assets = Bundle.main.resourceURL?.appendingPathComponent("public/toolchain") else { call.reject("Bundled compiler missing"); return }
            let pointer = assets.path.withCString { directory in request.withCString { json in pocket_run(directory, json) } }
            guard let pointer else { call.reject("Interpreter allocation failed"); return }
            let result = String(cString: pointer); pocket_free(pointer)
            call.resolve(["result": result])
        }
    }
    @objc func cancel(_ call: CAPPluginCall) { pocket_cancel(); call.resolve() }
}

@objc(PocketViewController)
public class PocketViewController: CAPBridgeViewController {
    public override func capacitorDidLoad() { bridge?.registerPluginInstance(PocketRuntimePlugin()) }
}
