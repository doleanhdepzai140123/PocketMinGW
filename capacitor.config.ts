import type { CapacitorConfig } from '@capacitor/cli';
import { KeyboardResize, KeyboardStyle } from '@capacitor/keyboard';
const config: CapacitorConfig = {
  appId: 'com.pocketmingw.ide', appName: 'PocketMinGW', webDir: 'dist',
  backgroundColor: '#14171b',
  ios: { contentInset: 'never', zoomEnabled: false, scrollEnabled: false },
  android: { zoomEnabled: false },
  plugins: { Keyboard: { resize: KeyboardResize.Native, style: KeyboardStyle.Dark, autoBackdropColor: 'auto' } },
};
export default config;
