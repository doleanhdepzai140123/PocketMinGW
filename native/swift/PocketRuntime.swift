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
    public override func capacitorDidLoad() {
        bridge?.registerPluginInstance(PocketRuntimePlugin())
        #if targetEnvironment(simulator)
        if ProcessInfo.processInfo.arguments.contains("--pocket-self-test") {
            DispatchQueue.global(qos: .userInitiated).async {
                let code = "#include <bits/stdc++.h>\nusing namespace std;int main(){freopen(\"BAI.INP\",\"r\",stdin);freopen(\"BAI.OUT\",\"w\",stdout);int a,b;cin>>a>>b;vector<int>v={b,a};sort(v.begin(),v.end());auto[x,y]=pair{v[0],v[1]};optional<int>s=x+y;cout<<*s<<\"\\n\";}"
                let request: [String: Any] = ["files": [["path": "main.cpp", "content": code]], "stdin": "20 22\n", "inputFile": "BAI.INP", "outputFile": "BAI.OUT", "timeLimitMs": 3000]
                do {
                    let json = String(data: try JSONSerialization.data(withJSONObject: request), encoding: .utf8)!
                    let assets = Bundle.main.resourceURL!.appendingPathComponent("public/toolchain").path
                    guard let pointer = assets.withCString({ dir in json.withCString { pocket_run(dir, $0) } }) else { return }
                    let result = String(cString: pointer); pocket_free(pointer)
                    let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("PocketMinGW")
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                    try result.write(to: folder.appendingPathComponent("simulator-result.json"), atomically: true, encoding: .utf8)
                } catch { NSLog("PocketMinGW simulator test: %@", String(describing: error)) }
            }
        }
        #endif
    }
}
