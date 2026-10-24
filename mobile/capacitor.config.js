/**
 * השלד הנייטיב טוען את האתר החי, לא עותק ארוז של ה-HTML.
 * www/ הוא רק מסך הפתיחה ומסך "אין רשת". שינוי באתר מגיע לאפליקציה
 * בלי גרסה חדשה בחנות. הדומיינים ברשימה נטענים בתוך ה-WebView עם הגשר
 * הנייטיב; כל השאר (וואטסאפ, מפות, Google) נפתח בחוץ.
 */
const config = {
  appId: 'co.shuknadlan.app',
  appName: 'שוק נדל״ן',
  webDir: 'www',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    hostname: 'localhost',
    allowNavigation: ['shuknadlan.co.il', '*.shuknadlan.co.il'],
  },
  android: {
    appendUserAgent: 'ShukNadlanApp/1.0',
    allowMixedContent: false,
  },
  ios: {
    appendUserAgent: 'ShukNadlanApp/1.0',
    contentInset: 'automatic',
    scheme: 'https',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2500,
      launchAutoHide: true,
      backgroundColor: '#0e2a6b',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: false,
    },
    StatusBar: {
      style: 'LIGHT',
      backgroundColor: '#0e2a6b',
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
};

module.exports = config;
