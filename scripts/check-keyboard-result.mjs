import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
for (const state of ['open', 'closed']) {
  const r = JSON.parse(await readFile(`artifacts/ios-keyboard-${state}.json`, 'utf8'));
  console.log(`iPhone keyboard ${state}`, r);
  assert.equal(r.scale, 1, 'Focusing input must not zoom the app');
  assert.equal(r.scrollX, 0, 'Outer shell must not pan horizontally');
  assert.equal(r.scrollY, 0, 'Outer shell must not pan vertically');
  assert.equal(r.headerTop, 0, 'Header must stay at the top');
  assert.ok(r.documentWidth <= r.width, 'No document horizontal overflow');
  assert.ok(Math.abs(r.shellBottom - r.height) < 2, 'Shell must fill the native WebView');
  assert.ok(r.fontSize >= 16, 'Editor must avoid iOS input auto zoom');
  if (state === 'open') {
    assert.equal(r.open, true);
    assert.ok(r.initialHeight - r.height > 100, 'The system keyboard must actually resize the WebView');
    assert.equal(r.navHeight, 0, 'App navigation must hide while typing');
    assert.ok(Math.abs(r.barBottom - r.height) < 2, 'Coding keys must dock immediately above the keyboard');
  } else {
    assert.equal(r.open, false);
    assert.ok(r.navHeight >= 44, 'Navigation must return after dismissal');
    assert.ok(Math.abs(r.height - r.initialHeight) < 2, 'Full viewport height must return');
  }
}
