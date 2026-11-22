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
                let request: [String: Any] = ["files": [["path": "main.cpp", "content": code], ["path": "other-solution.cpp", "content": "int main(){return 99;}"]], "entryFile": "main.cpp", "stdin": "20 22\n", "inputFile": "BAI.INP", "outputFile": "BAI.OUT", "timeLimitMs": 3000]
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
        if ProcessInfo.processInfo.arguments.contains("--pocket-keyboard-test") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.probeKeyboard(stage: 0, attempt: 0) }
        }
        #endif
    }

    #if targetEnvironment(simulator)
    // Runs in the real WKWebView with the system software keyboard, never in device builds.
    private func probeKeyboard(stage: Int, attempt: Int) {
        let script = stage == 0 ? """
        (() => { const editor = document.querySelector('.cm-content');
          if (!editor || !document.querySelector('.bottom-nav')) return null;
          window.__pocketInitialHeight = innerHeight;
          editor.focus(); return 'focused'; })()
        """ : """
        (() => {
          const open = document.documentElement.dataset.keyboard === 'open';
          if (open !== \(stage == 1 ? "true" : "false")) return null;
          const bar = document.querySelector('.coding-keys').getBoundingClientRect();
          const nav = document.querySelector('.bottom-nav').getBoundingClientRect();
          return JSON.stringify({ open, scale: visualViewport.scale, scrollX, scrollY,
            height: innerHeight, initialHeight: window.__pocketInitialHeight,
            width: innerWidth, documentWidth: document.documentElement.scrollWidth,
            shellBottom: document.querySelector('.workspace').getBoundingClientRect().bottom,
            headerTop: document.querySelector('.topbar').getBoundingClientRect().top,
            barBottom: bar.bottom, navHeight: nav.height,
            fontSize: parseFloat(getComputedStyle(document.querySelector('.cm-content')).fontSize) });
        })()
        """
        webView?.evaluateJavaScript(script) { value, error in
            guard let result = value as? String, error == nil else {
                if attempt < 100 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.probeKeyboard(stage: stage, attempt: attempt + 1) }
                } else { NSLog("Pocket keyboard test timed out at stage %d: %@", stage, String(describing: error)) }
                return
            }
            if stage == 0 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.probeKeyboard(stage: 1, attempt: 0) }
            } else {
                do {
                    let folder = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("PocketMinGW")
                    try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
                    try result.write(to: folder.appendingPathComponent(stage == 1 ? "keyboard-open.json" : "keyboard-closed.json"), atomically: true, encoding: .utf8)
                } catch { NSLog("Pocket keyboard test: %@", String(describing: error)) }
                if stage == 1 {
                    // Leave time for simctl to capture the visible keyboard before checking dismissal.
                    DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                        self.webView?.evaluateJavaScript("document.querySelector('.keyboard-dismiss').click()") { _, _ in
                            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.probeKeyboard(stage: 2, attempt: 0) }
                        }
                    }
                }
            }
        }
    }
    #endif
}
