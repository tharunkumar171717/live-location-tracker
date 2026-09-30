// Dynamic config so build-time secrets come from env, not source.
export default {
  expo: {
    name: 'G-Map',
    slug: 'g-map',
    version: '1.0.0',
    // Deep link scheme: OAuth returns to gmap://auth/callback
    scheme: 'gmap',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.gmap.tracking',
    },
    android: {
      package: 'com.gmap.tracking',
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      'expo-router',
      'expo-web-browser',
      'expo-secure-store',
      'expo-splash-screen',
      [
        'expo-location',
        {
          locationWhenInUsePermission: 'G-Map shares your location with members of tracking sessions you join.',
          isAndroidBackgroundLocationEnabled: false,
        },
      ],
      [
        'react-native-maps',
        { androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY },
      ],
    ],
  },
};
