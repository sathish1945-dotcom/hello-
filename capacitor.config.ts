import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hello.ai',
  appName: 'Hello',
  webDir: 'dist',
  loggingBehavior: 'none',
  android: {
    loggingBehavior: 'none'
  },
  plugins: {
    CapacitorHttp: {
      enabled: true
    }
  }
};

export default config;


