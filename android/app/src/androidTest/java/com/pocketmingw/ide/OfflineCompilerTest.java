package com.pocketmingw.ide;

import android.webkit.JavascriptInterface;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class OfflineCompilerTest {
    public static class Probe {
        final CountDownLatch done = new CountDownLatch(1);
        volatile String response;
        @JavascriptInterface public void finish(String value) { response=value; done.countDown(); }
    }
    @Test public void cpp17AndFileIOThroughNativeBridge() throws Exception {
        String code="#include <bits/stdc++.h>\nusing namespace std;int main(){freopen(\"BAI.INP\",\"r\",stdin);freopen(\"BAI.OUT\",\"w\",stdout);int a,b;cin>>a>>b;vector<int>v={b,a};sort(v.begin(),v.end());auto[x,y]=pair{v[0],v[1]};optional<int>s=x+y;cout<<*s<<\"\\n\";}";
        JSONObject request=new JSONObject().put("files",new JSONArray().put(new JSONObject().put("path","main.cpp").put("content",code))).put("stdin","20 22\n").put("inputFile","BAI.INP").put("outputFile","BAI.OUT").put("timeLimitMs",3000);
        Probe probe=new Probe();
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            // The callback belongs only to the instrumentation process, never production.
            scenario.onActivity(activity->{activity.getBridge().getWebView().addJavascriptInterface(probe,"PocketTestProbe");activity.getBridge().getWebView().reload();});
            String js="(function wait(){if(!window.Capacitor||!window.Capacitor.nativePromise){setTimeout(wait,100);return;}window.Capacitor.nativePromise('PocketRuntime','run',{request:"+JSONObject.quote(request.toString())+"}).then(r=>PocketTestProbe.finish(r.result)).catch(e=>PocketTestProbe.finish(JSON.stringify({error:String(e)})));})()";
            // Wait for the bundled document; evaluateJavascript before navigation is discarded.
            for(int i=0;i<100;i++) {
                final CountDownLatch checked=new CountDownLatch(1); final boolean[] ready={false};
                scenario.onActivity(activity->activity.getBridge().getWebView().evaluateJavascript("document.readyState==='complete' && !!window.Capacitor && !!window.PocketTestProbe && !!document.querySelector('.workspace .cm-content')",value->{ready[0]="true".equals(value);checked.countDown();}));
                assertTrue(checked.await(5,TimeUnit.SECONDS)); if(ready[0])break; if(i==99)fail("App editor did not start on the device WebView"); Thread.sleep(100);
            }
            // Run the default sum example through the actual app button as well as the bridge.
            scenario.onActivity(activity->activity.getBridge().getWebView().evaluateJavascript("document.querySelector('.run-button').click()",null));
            for(int i=0;i<240;i++) {
                final CountDownLatch checked=new CountDownLatch(1); final boolean[] passed={false};
                scenario.onActivity(activity->activity.getBridge().getWebView().evaluateJavascript("document.querySelector('.terminal-output')?.textContent.trim()==='15' && !document.querySelector('.running-message')",value->{passed[0]="true".equals(value);checked.countDown();}));
                assertTrue(checked.await(5,TimeUnit.SECONDS)); if(passed[0])break; if(i==239)fail("Run button did not produce 15 in the app"); Thread.sleep(1000);
            }
            scenario.onActivity(activity->activity.getBridge().getWebView().evaluateJavascript(js,null));
            assertTrue("Native compiler timed out",probe.done.await(240,TimeUnit.SECONDS));
            JSONObject result=new JSONObject(probe.response);
            assertEquals(result.toString(),"",result.optString("error"));
            assertEquals(0,result.getInt("exitCode"));
            assertEquals("42\n",result.getJSONObject("files").getString("BAI.OUT"));
            assertTrue(result.getString("engine").contains("no JIT"));
        }
    }
}
