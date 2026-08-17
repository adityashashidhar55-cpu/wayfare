import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.wayfare.app',
  appName: 'Wayfare',
  webDir: 'dist/public',
  server: {
    // Serve the bundled app over https://localhost so secure-context APIs
    // (service workers, clipboard, geolocation) keep working in the WebView.
    androidScheme: 'https',
    // API calls leave the WebView for the user's saved deployment origin -
    // allow the WebView to navigate anywhere (OAuth providers included).
    allowNavigation: ['*'],
  },
};

export default config;
