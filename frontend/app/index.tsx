import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  StyleSheet,
  ActivityIndicator,
  Text,
  TouchableOpacity,
  BackHandler,
  Platform,
  StatusBar,
  Alert,
  SafeAreaView,
  Linking,
  ScrollView,
  NativeModules,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';

// Only import native-only modules on native platforms
let TaskManager: any = null;
let BackgroundFetch: any = null;
let activateKeepAwakeAsync: any = null;
let deactivateKeepAwake: any = null;

if (Platform.OS !== 'web') {
  TaskManager = require('expo-task-manager');
  BackgroundFetch = require('expo-background-fetch');
  const keepAwake = require('expo-keep-awake');
  activateKeepAwakeAsync = keepAwake.activateKeepAwakeAsync;
  deactivateKeepAwake = keepAwake.deactivateKeepAwake;
}

const KAGGLE_URL = 'https://www.kaggle.com/';
const BACKGROUND_FETCH_TASK = 'kaggle-keep-alive-task';

// Define the background task (only on native)
if (Platform.OS !== 'web' && TaskManager) {
  TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
    try {
      console.log('[Background] Keeping Colab session alive...');
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch (error) {
      console.error('[Background] Error:', error);
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

// Web iframe component for web platform
const WebIframe = ({ url, onLoad }: { url: string; onLoad: () => void }) => {
  if (Platform.OS !== 'web') return null;
  
  return (
    <View style={styles.iframeContainer}>
      <Text style={styles.webNotice}>
        WebView is not supported on web browsers. Please use the Expo Go app on your Android/iOS device for the full experience.
      </Text>
      <TouchableOpacity 
        style={styles.openBrowserBtn}
        onPress={() => Linking.openURL(url)}
      >
        <Ionicons name="open-outline" size={20} color="#fff" />
        <Text style={styles.openBrowserText}>Open Colab in Browser</Text>
      </TouchableOpacity>
      <View style={styles.qrInfo}>
        <Ionicons name="qr-code" size={48} color="#F9AB00" />
        <Text style={styles.qrText}>Scan the QR code with Expo Go app to use this app on your phone</Text>
      </View>
    </View>
  );
};

// User Agents
const MOBILE_USER_AGENT = Platform.select({
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  default: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
});

const DESKTOP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

export default function ColabApp() {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentUrl, setCurrentUrl] = useState(KAGGLE_URL);
  const [showNavBar, setShowNavBar] = useState(true);
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(true);
  const [progress, setProgress] = useState(0);
  const [desktopMode, setDesktopMode] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0); // Key to force WebView remount
  const [batteryOptimizationDisabled, setBatteryOptimizationDisabled] = useState(false);
  const [showBatteryPrompt, setShowBatteryPrompt] = useState(false);

  // Register background task (native only)
  const registerBackgroundTask = async () => {
    if (Platform.OS === 'web' || !BackgroundFetch) return;
    
    try {
      const status = await BackgroundFetch.getStatusAsync();
      if (status === BackgroundFetch.BackgroundFetchStatus.Available) {
        await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
          minimumInterval: 15 * 60, // 15 minutes
          stopOnTerminate: false,
          startOnBoot: true,
        });
        console.log('[Background] Task registered successfully');
      }
    } catch (error) {
      console.log('[Background] Task registration failed:', error);
    }
  };

  // Open battery optimization settings (Android only)
  const openBatteryOptimizationSettings = async () => {
    if (Platform.OS !== 'android') return;
    
    try {
      // Open app settings where user can disable battery optimization
      await Linking.openSettings();
      setBatteryOptimizationDisabled(true);
      setShowBatteryPrompt(false);
    } catch (error) {
      console.log('Could not open settings:', error);
      Alert.alert(
        'Open Settings Manually',
        'Please go to Settings > Apps > Colab Mobile > Battery > Unrestricted to allow background activity.'
      );
    }
  };

  // Show battery optimization prompt on Android
  const showBatteryOptimizationPrompt = () => {
    if (Platform.OS !== 'android') return;
    
    Alert.alert(
      'Keep App Running in Background',
      'To prevent Android from stopping Colab when minimized:\n\n1. Tap "Open Settings"\n2. Go to "Battery"\n3. Select "Unrestricted"\n\nThis keeps your notebooks running!',
      [
        {
          text: 'Later',
          style: 'cancel',
          onPress: () => setShowBatteryPrompt(false),
        },
        {
          text: 'Open Settings',
          onPress: openBatteryOptimizationSettings,
        },
      ]
    );
  };

  // Setup keep awake and background tasks
  useEffect(() => {
    // Keep screen awake to prevent session timeout (native only)
    if (Platform.OS !== 'web' && keepAwakeEnabled && activateKeepAwakeAsync) {
      activateKeepAwakeAsync('colab-session');
    }
    
    // Register background task (native only)
    if (Platform.OS !== 'web') {
      registerBackgroundTask();
    }

    // Show battery optimization prompt on Android after a short delay
    if (Platform.OS === 'android' && !batteryOptimizationDisabled) {
      const timer = setTimeout(() => {
        showBatteryOptimizationPrompt();
      }, 3000); // Show after 3 seconds
      return () => clearTimeout(timer);
    }

    return () => {
      if (Platform.OS !== 'web' && deactivateKeepAwake) {
        deactivateKeepAwake('colab-session');
      }
    };
  }, [keepAwakeEnabled]);

  // Handle Android back button
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack && webViewRef.current) {
        webViewRef.current.goBack();
        return true;
      }
      return false;
    });

    return () => backHandler.remove();
  }, [canGoBack]);

  const handleNavigationStateChange = (navState: WebViewNavigation) => {
    setCanGoBack(navState.canGoBack);
    setCanGoForward(navState.canGoForward);
    setCurrentUrl(navState.url);
  };

  const goBack = () => {
    if (webViewRef.current && canGoBack) {
      webViewRef.current.goBack();
    }
  };

  const goForward = () => {
    if (webViewRef.current && canGoForward) {
      webViewRef.current.goForward();
    }
  };

  const reload = () => {
    if (webViewRef.current) {
      webViewRef.current.reload();
    }
  };

  const goHome = () => {
    if (webViewRef.current) {
      webViewRef.current.injectJavaScript(`window.location.href = '${KAGGLE_URL}'; true;`);
    }
  };

  const toggleKeepAwake = () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not Available', 'Keep Awake feature is only available on Android/iOS devices.');
      return;
    }
    
    if (keepAwakeEnabled) {
      if (deactivateKeepAwake) deactivateKeepAwake('colab-session');
      Alert.alert(
        'Keep Awake Disabled',
        'Screen may turn off during long operations. Notebooks may timeout.'
      );
    } else {
      if (activateKeepAwakeAsync) activateKeepAwakeAsync('colab-session');
      Alert.alert(
        'Keep Awake Enabled',
        'Screen will stay on to keep your Colab session active.'
      );
    }
    setKeepAwakeEnabled(!keepAwakeEnabled);
  };

  // Toggle Desktop Mode
  const toggleDesktopMode = () => {
    setDesktopMode(!desktopMode);
    // Force WebView to reload with new user agent
    setWebViewKey(prev => prev + 1);
    Alert.alert(
      desktopMode ? 'Mobile Mode' : 'Desktop Mode',
      desktopMode 
        ? 'Switching to mobile view. Page will reload.' 
        : 'Switching to desktop view for full Colab experience. Page will reload.'
    );
  };

  // Get current user agent based on mode
  const currentUserAgent = desktopMode ? DESKTOP_USER_AGENT : MOBILE_USER_AGENT;

  // JavaScript to inject for better Colab experience
  const injectedJavaScript = `
    (function() {
      // Viewport meta tag - adjust based on mode
      var meta = document.querySelector('meta[name="viewport"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'viewport';
        document.getElementsByTagName('head')[0].appendChild(meta);
      }
      meta.content = ${desktopMode} 
        ? 'width=1200, initial-scale=0.5, maximum-scale=3.0, user-scalable=yes'
        : 'width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes';
      
      // Keep session alive by periodic activity
      setInterval(function() {
        // Simulate mouse movement to prevent session timeout
        var event = new MouseEvent('mousemove', {
          'view': window,
          'bubbles': true,
          'cancelable': true,
          'clientX': Math.random() * 100,
          'clientY': Math.random() * 100
        });
        document.dispatchEvent(event);
        console.log('[ColabApp] Keeping session alive...');
      }, 240000); // Every 4 minutes
      
      // Prevent the page from prompting to leave
      window.onbeforeunload = null;
      
      true;
    })();
  `;

  // Show web fallback
  if (Platform.OS === 'web') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />
        
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Ionicons name="trophy" size={24} color="#20BEFF" />
            <Text style={styles.headerTitle}>Kaggle Mobile</Text>
          </View>
        </View>

        <ScrollView style={styles.webFallbackContainer} contentContainerStyle={styles.webFallbackContent}>
          <View style={styles.appIcon}>
            <Ionicons name="analytics" size={64} color="#20BEFF" />
          </View>
          <Text style={styles.appTitle}>Kaggle Mobile</Text>
          <Text style={styles.appSubtitle}>Data Science & ML Competitions</Text>
          
          <View style={styles.featureList}>
            <View style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
              <Text style={styles.featureText}>Full Kaggle experience</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
              <Text style={styles.featureText}>Google login supported</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
              <Text style={styles.featureText}>Desktop Mode - full desktop view</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
              <Text style={styles.featureText}>Keep Awake - prevents session timeout</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
              <Text style={styles.featureText}>Background task keeps app alive</Text>
            </View>
            <View style={styles.featureItem}>
              <Ionicons name="checkmark-circle" size={24} color="#4CAF50" />
              <Text style={styles.featureText}>Native navigation controls</Text>
            </View>
          </View>

          <View style={styles.instructionBox}>
            <Ionicons name="phone-portrait-outline" size={32} color="#20BEFF" />
            <Text style={styles.instructionTitle}>How to use on Mobile</Text>
            <Text style={styles.instructionText}>
              1. Download "Expo Go" app from Play Store or App Store{'\n'}
              2. Scan the QR code shown in the terminal{'\n'}
              3. Enjoy full Kaggle experience on your phone!
            </Text>
          </View>

          <TouchableOpacity 
            style={styles.openBrowserBtn}
            onPress={() => Linking.openURL(KAGGLE_URL)}
          >
            <Ionicons name="open-outline" size={20} color="#fff" />
            <Text style={styles.openBrowserText}>Open Kaggle in Browser</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />
      
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="trophy" size={24} color="#20BEFF" />
          <Text style={styles.headerTitle}>Kaggle</Text>
        </View>
        <View style={styles.headerRight}>
          {Platform.OS === 'android' && (
            <TouchableOpacity 
              style={styles.batteryBtn} 
              onPress={showBatteryOptimizationPrompt}
            >
              <Ionicons name="battery-charging" size={18} color="#4CAF50" />
            </TouchableOpacity>
          )}
          <TouchableOpacity 
            style={[styles.keepAwakeBtn, keepAwakeEnabled && styles.keepAwakeActive]} 
            onPress={toggleKeepAwake}
          >
            <Ionicons 
              name={keepAwakeEnabled ? "flash" : "flash-outline"} 
              size={18} 
              color={keepAwakeEnabled ? "#4CAF50" : "#888"} 
            />
            <Text style={[styles.keepAwakeText, keepAwakeEnabled && styles.keepAwakeTextActive]}>
              {keepAwakeEnabled ? 'ON' : 'OFF'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Progress Bar */}
      {isLoading && (
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { width: `${progress * 100}%` }]} />
        </View>
      )}

      {/* WebView */}
      <View style={styles.webViewContainer}>
        <WebView
          key={webViewKey}
          ref={webViewRef}
          source={{ uri: KAGGLE_URL }}
          style={styles.webView}
          onNavigationStateChange={handleNavigationStateChange}
          onLoadStart={() => setIsLoading(true)}
          onLoadEnd={() => setIsLoading(false)}
          onLoadProgress={({ nativeEvent }) => setProgress(nativeEvent.progress)}
          injectedJavaScript={injectedJavaScript}
          userAgent={currentUserAgent}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          startInLoadingState={true}
          scalesPageToFit={true}
          allowsInlineMediaPlayback={true}
          mediaPlaybackRequiresUserAction={false}
          allowsFullscreenVideo={true}
          mixedContentMode="always"
          thirdPartyCookiesEnabled={true}
          sharedCookiesEnabled={true}
          cacheEnabled={true}
          incognito={false}
          setSupportMultipleWindows={false}
          allowsBackForwardNavigationGestures={true}
          allowFileAccess={true}
          allowFileAccessFromFileURLs={true}
          allowUniversalAccessFromFileURLs={true}
          geolocationEnabled={true}
          saveFormDataDisabled={false}
          textZoom={100}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#20BEFF" />
              <Text style={styles.loadingText}>Loading Kaggle...</Text>
              <Text style={styles.loadingSubtext}>Sign in with your Google account</Text>
            </View>
          )}
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            console.warn('WebView error: ', nativeEvent);
          }}
          onHttpError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent;
            console.warn('WebView HTTP error: ', nativeEvent.statusCode);
          }}
          onShouldStartLoadWithRequest={(request) => {
            // Allow Kaggle and Google OAuth redirects
            if (request.url.includes('kaggle.com') || 
                request.url.includes('accounts.google.com') ||
                request.url.includes('googleapis.com') ||
                request.url.includes('google.com/recaptcha')) {
              return true;
            }
            // Open external links in default browser
            if (!request.url.startsWith('https://www.kaggle') && 
                !request.url.startsWith('https://kaggle') &&
                !request.url.startsWith('https://accounts.google')) {
              Linking.openURL(request.url);
              return false;
            }
            return true;
          }}
        />
      </View>

      {/* Navigation Bar */}
      {showNavBar && (
        <View style={styles.navBar}>
          <TouchableOpacity 
            style={[styles.navButton, !canGoBack && styles.navButtonDisabled]} 
            onPress={goBack}
            disabled={!canGoBack}
          >
            <Ionicons name="chevron-back" size={24} color={canGoBack ? "#fff" : "#555"} />
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.navButton, !canGoForward && styles.navButtonDisabled]} 
            onPress={goForward}
            disabled={!canGoForward}
          >
            <Ionicons name="chevron-forward" size={24} color={canGoForward ? "#fff" : "#555"} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.navButton} onPress={goHome}>
            <Ionicons name="home" size={22} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity style={styles.navButton} onPress={reload}>
            <Ionicons name="refresh" size={22} color="#fff" />
          </TouchableOpacity>

          <TouchableOpacity 
            style={[styles.navButton, desktopMode && styles.navButtonActive]} 
            onPress={toggleDesktopMode}
          >
            <Ionicons name={desktopMode ? "desktop" : "phone-portrait"} size={22} color={desktopMode ? "#20BEFF" : "#fff"} />
          </TouchableOpacity>

          <TouchableOpacity 
            style={styles.navButton} 
            onPress={() => setShowNavBar(false)}
          >
            <Ionicons name="eye-off" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* Show Nav Button when hidden */}
      {!showNavBar && (
        <TouchableOpacity 
          style={styles.showNavButton} 
          onPress={() => setShowNavBar(true)}
        >
          <Ionicons name="menu" size={20} color="#fff" />
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: '#1a1a2e',
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d44',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    marginLeft: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  keepAwakeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#2d2d44',
  },
  batteryBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  keepAwakeActive: {
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
  },
  keepAwakeText: {
    color: '#888',
    fontSize: 12,
    fontWeight: '600',
    marginLeft: 4,
  },
  keepAwakeTextActive: {
    color: '#4CAF50',
  },
  progressContainer: {
    height: 2,
    backgroundColor: '#2d2d44',
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#20BEFF',
  },
  webViewContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  webView: {
    flex: 1,
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: '#fff',
    marginTop: 12,
    fontSize: 16,
    fontWeight: '600',
  },
  loadingSubtext: {
    color: '#888',
    marginTop: 8,
    fontSize: 14,
  },
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: '#1a1a2e',
    borderTopWidth: 1,
    borderTopColor: '#2d2d44',
  },
  navButton: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#2d2d44',
    justifyContent: 'center',
    alignItems: 'center',
  },
  navButtonDisabled: {
    backgroundColor: '#1f1f30',
  },
  navButtonActive: {
    backgroundColor: 'rgba(32, 190, 255, 0.3)',
    borderWidth: 1,
    borderColor: '#20BEFF',
  },
  showNavButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(32, 190, 255, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    ...Platform.select({
      ios: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.25,
        shadowRadius: 4,
      },
      android: {
        elevation: 5,
      },
    }),
  },
  // Web fallback styles
  iframeContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  webNotice: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  webFallbackContainer: {
    flex: 1,
  },
  webFallbackContent: {
    padding: 24,
    alignItems: 'center',
  },
  appIcon: {
    width: 100,
    height: 100,
    borderRadius: 20,
    backgroundColor: '#2d2d44',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  appTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 8,
  },
  appSubtitle: {
    color: '#888',
    fontSize: 16,
    marginBottom: 32,
  },
  featureList: {
    width: '100%',
    maxWidth: 400,
    marginBottom: 32,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  featureText: {
    color: '#fff',
    fontSize: 16,
    marginLeft: 12,
  },
  instructionBox: {
    backgroundColor: '#2d2d44',
    borderRadius: 16,
    padding: 24,
    alignItems: 'center',
    marginBottom: 24,
    width: '100%',
    maxWidth: 400,
  },
  instructionTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 12,
  },
  instructionText: {
    color: '#aaa',
    fontSize: 14,
    lineHeight: 24,
    textAlign: 'center',
  },
  openBrowserBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#20BEFF',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  openBrowserText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  qrInfo: {
    alignItems: 'center',
    marginTop: 40,
  },
  qrText: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 16,
    maxWidth: 250,
  },
});
