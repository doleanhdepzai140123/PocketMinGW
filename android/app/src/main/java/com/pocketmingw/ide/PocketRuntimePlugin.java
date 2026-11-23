package com.pocketmingw.ide;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "PocketRuntime")
public class PocketRuntimePlugin extends Plugin {
    static { System.loadLibrary("pocket-jni"); }
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicBoolean running = new AtomicBoolean(false);
    private native byte[] executeNative(byte[] directory, byte[] request);
    private native void cancelNative();

    @PluginMethod public void run(PluginCall call) {
        String request = call.getString("request");
        if (request == null || request.length() > 20 * 1024 * 1024) { call.reject("Invalid request size"); return; }
        if (!running.compareAndSet(false, true)) { call.reject("Compiler is already running"); return; }
        worker.execute(() -> {
            try {
                File directory = new File(getContext().getFilesDir(), "PocketMinGW/toolchain/v2");
                if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Cannot prepare bundled compiler");
                for (String name : new String[]{"clang.wasm", "lld.wasm", "memfs.wasm", "sysroot.tar", "stdc++.h", "stdc++.pch"}) {
                    File file = new File(directory, name);
                    if (!file.exists()) {
                        File temporary = new File(directory, name + ".pending");
                        try (InputStream in = getContext().getAssets().open("public/toolchain/" + name); FileOutputStream out = new FileOutputStream(temporary)) {
                            byte[] buffer = new byte[65536]; int size;
                            while ((size = in.read(buffer)) != -1) out.write(buffer, 0, size);
                            out.getFD().sync();
                        }
                        if (!temporary.renameTo(file)) throw new Exception("Cannot install bundled asset " + name);
                    }
                }
                byte[] bytes = executeNative(directory.getAbsolutePath().getBytes(StandardCharsets.UTF_8), request.getBytes(StandardCharsets.UTF_8));
                if (bytes == null) throw new Exception("Interpreter allocation failed");
                JSObject result = new JSObject(); result.put("result", new String(bytes, StandardCharsets.UTF_8)); call.resolve(result);
            } catch (Exception error) { call.reject(error.getMessage(), error); }
            finally { running.set(false); }
        });
    }
    @PluginMethod public void cancel(PluginCall call) { cancelNative(); call.resolve(); }
    @Override protected void handleOnDestroy() { cancelNative(); worker.shutdown(); }
}
