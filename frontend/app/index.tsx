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
  Image,
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

// App configurations
const APPS = {
  colab: {
    name: 'Google Colab',
    url: 'https://colab.research.google.com/',
    color: '#F9AB00',
    icon: 'code-working',
    description: 'Jupyter Notebooks in the Cloud',
  },
  kaggle: {
    name: 'Kaggle',
    url: 'https://www.kaggle.com/',
    color: '#20BEFF',
    icon: 'trophy',
    description: 'Data Science & ML Competitions',
  },
};

const BACKGROUND_FETCH_TASK = 'app-keep-alive-task';

// Define the background task (only on native)
if (Platform.OS !== 'web' && TaskManager) {
  TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
    try {
      console.log('[Background] Keeping session alive...');
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch (error) {
      console.error('[Background] Error:', error);
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

// User Agents
const MOBILE_USER_AGENT = Platform.select({
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
  ios: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  default: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36'
});

const DESKTOP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

type AppType = 'colab' | 'kaggle';

export default function MainApp() {
  const [selectedApp, setSelectedApp] = useState<AppType | null>(null);
  
  if (!selectedApp) {
    return <AppSelector onSelect={setSelectedApp} />;
  }
  
  return <WebViewApp appType={selectedApp} onBack={() => setSelectedApp(null)} />;
}

// App Selector Screen
function AppSelector({ onSelect }: { onSelect: (app: AppType) => void }) {
  return (
    <SafeAreaView style={styles.selectorContainer}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />
      
      <View style={styles.selectorHeader}>
        <Text style={styles.selectorTitle}>Choose Your App</Text>
        <Text style={styles.selectorSubtitle}>Select a platform to continue</Text>
      </View>
      
      <View style={styles.appCards}>
        {/* Colab Card */}
        <TouchableOpacity 
          style={[styles.appCard, { borderColor: APPS.colab.color }]}
          onPress={() => onSelect('colab')}
        >
          <View style={[styles.appIconContainer, { backgroundColor: APPS.colab.color + '20' }]}>
            <Image 
              source={require('../assets/images/colab_logo.png')} 
              style={styles.appLogo}
              resizeMode="contain"
            />
          </View>
          <Text style={styles.appCardTitle}>{APPS.colab.name}</Text>
          <Text style={styles.appCardDesc}>{APPS.colab.description}</Text>
          <View style={[styles.openButton, { backgroundColor: APPS.colab.color }]}>
            <Text style={styles.openButtonText}>Open</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </View>
        </TouchableOpacity>
        
        {/* Kaggle Card */}
        <TouchableOpacity 
          style={[styles.appCard, { borderColor: APPS.kaggle.color }]}
          onPress={() => onSelect('kaggle')}
        >
          <View style={[styles.appIconContainer, { backgroundColor: APPS.kaggle.color + '20' }]}>
            <Ionicons name="trophy" size={48} color={APPS.kaggle.color} />
          </View>
          <Text style={styles.appCardTitle}>{APPS.kaggle.name}</Text>
          <Text style={styles.appCardDesc}>{APPS.kaggle.description}</Text>
          <View style={[styles.openButton, { backgroundColor: APPS.kaggle.color }]}>
            <Text style={styles.openButtonText}>Open</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </View>
        </TouchableOpacity>
      </View>
      
      <View style={styles.featuresBox}>
        <Text style={styles.featuresTitle}>Features</Text>
        <View style={styles.featureRow}>
          <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
          <Text style={styles.featureText}>Full website experience</Text>
        </View>
        <View style={styles.featureRow}>
          <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
          <Text style={styles.featureText}>Google login supported</Text>
        </View>
        <View style={styles.featureRow}>
          <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
          <Text style={styles.featureText}>Desktop mode toggle</Text>
        </View>
        <View style={styles.featureRow}>
          <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
          <Text style={styles.featureText}>Background keep-alive</Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

// WebView App Component
function WebViewApp({ appType, onBack }: { appType: AppType; onBack: () => void }) {
  const app = APPS[appType];
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showNavBar, setShowNavBar] = useState(true);
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(true);
  const [progress, setProgress] = useState(0);
  const [desktopMode, setDesktopMode] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);

  // Register background task (native only)
  const registerBackgroundTask = async () => {
    if (Platform.OS === 'web' || !BackgroundFetch) return;
    
    try {
      const status = await BackgroundFetch.getStatusAsync();
      if (status === BackgroundFetch.BackgroundFetchStatus.Available) {
        await BackgroundFetch.registerTaskAsync(BACKGROUND_FETCH_TASK, {
          minimumInterval: 15 * 60,
          stopOnTerminate: false,
          startOnBoot: true,
        });
      }
    } catch (error) {
      console.log('[Background] Task registration failed:', error);
    }
  };

  // Open battery optimization settings
  const openBatterySettings = async () => {
    if (Platform.OS !== 'android') return;
    
    Alert.alert(
      'Keep App Running',
      'To prevent Android from stopping the app:\n\n1. Tap "Open Settings"\n2. Go to "Battery"\n3. Select "Unrestricted"',
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]
    );
  };

  useEffect(() => {
    if (Platform.OS !== 'web' && keepAwakeEnabled && activateKeepAwakeAsync) {
      activateKeepAwakeAsync('app-session');
    }
    
    if (Platform.OS !== 'web') {
      registerBackgroundTask();
    }

    if (Platform.OS === 'android') {
      setTimeout(openBatterySettings, 3000);
    }

    return () => {
      if (Platform.OS !== 'web' && deactivateKeepAwake) {
        deactivateKeepAwake('app-session');
      }
    };
  }, [keepAwakeEnabled]);

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
  };

  const goBack = () => webViewRef.current?.goBack();
  const goForward = () => webViewRef.current?.goForward();
  const reload = () => webViewRef.current?.reload();
  const goHome = () => webViewRef.current?.injectJavaScript(`window.location.href = '${app.url}'; true;`);

  const toggleKeepAwake = () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not Available', 'Keep Awake is only available on mobile devices.');
      return;
    }
    
    if (keepAwakeEnabled && deactivateKeepAwake) {
      deactivateKeepAwake('app-session');
    } else if (activateKeepAwakeAsync) {
      activateKeepAwakeAsync('app-session');
    }
    setKeepAwakeEnabled(!keepAwakeEnabled);
  };

  const toggleDesktopMode = () => {
    setDesktopMode(!desktopMode);
    setWebViewKey(prev => prev + 1);
    Alert.alert(
      desktopMode ? 'Mobile Mode' : 'Desktop Mode',
      'Page will reload with new view.'
    );
  };

  const currentUserAgent = desktopMode ? DESKTOP_USER_AGENT : MOBILE_USER_AGENT;

  const injectedJavaScript = `
    (function() {
      var meta = document.querySelector('meta[name="viewport"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'viewport';
        document.getElementsByTagName('head')[0].appendChild(meta);
      }
      meta.content = ${desktopMode} 
        ? 'width=1200, initial-scale=0.5, maximum-scale=3.0, user-scalable=yes'
        : 'width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes';
      
      setInterval(function() {
        var event = new MouseEvent('mousemove', {
          'view': window,
          'bubbles': true,
          'cancelable': true,
          'clientX': Math.random() * 100,
          'clientY': Math.random() * 100
        });
        document.dispatchEvent(event);
      }, 240000);
      
      window.onbeforeunload = null;
      true;
    })();
  `;

  // Web fallback
  if (Platform.OS === 'web') {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <View style={styles.headerLeft}>
            <Ionicons name={app.icon as any} size={24} color={app.color} />
            <Text style={styles.headerTitle}>{app.name}</Text>
          </View>
        </View>
        <ScrollView style={styles.webFallbackContainer} contentContainerStyle={styles.webFallbackContent}>
          <Ionicons name={app.icon as any} size={80} color={app.color} />
          <Text style={styles.appTitle}>{app.name} Mobile</Text>
          <Text style={styles.appSubtitle}>{app.description}</Text>
          <Text style={styles.webNotice}>
            WebView only works on Android/iOS devices.{'\n'}
            Use Expo Go app to test on your phone!
          </Text>
          <TouchableOpacity 
            style={[styles.openBrowserBtn, { backgroundColor: app.color }]}
            onPress={() => Linking.openURL(app.url)}
          >
            <Ionicons name="open-outline" size={20} color="#fff" />
            <Text style={styles.openBrowserText}>Open in Browser</Text>
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
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="apps" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerLeft}>
          <Ionicons name={app.icon as any} size={24} color={app.color} />
          <Text style={styles.headerTitle}>{app.name}</Text>
        </View>
        <View style={styles.headerRight}>
          {Platform.OS === 'android' && (
            <TouchableOpacity style={styles.batteryBtn} onPress={openBatterySettings}>
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
          <View style={[styles.progressBar, { width: `${progress * 100}%`, backgroundColor: app.color }]} />
        </View>
      )}

      {/* WebView */}
      <View style={styles.webViewContainer}>
        <WebView
          key={webViewKey}
          ref={webViewRef}
          source={{ uri: app.url }}
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
          allowsBackForwardNavigationGestures={true}
          allowFileAccess={true}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={app.color} />
              <Text style={styles.loadingText}>Loading {app.name}...</Text>
            </View>
          )}
          onShouldStartLoadWithRequest={(request) => {
            if (request.url.includes('accounts.google.com') || 
                request.url.includes('googleapis.com') ||
                request.url.includes('google.com/recaptcha') ||
                request.url.includes(appType === 'colab' ? 'colab.research.google.com' : 'kaggle.com') ||
                request.url.includes('drive.google.com')) {
              return true;
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
            style={[styles.navButton, desktopMode && { backgroundColor: app.color + '40', borderWidth: 1, borderColor: app.color }]} 
            onPress={toggleDesktopMode}
          >
            <Ionicons name={desktopMode ? "desktop" : "phone-portrait"} size={22} color={desktopMode ? app.color : "#fff"} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.navButton} onPress={() => setShowNavBar(false)}>
            <Ionicons name="eye-off" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* Show Nav Button */}
      {!showNavBar && (
        <TouchableOpacity 
          style={[styles.showNavButton, { backgroundColor: app.color }]} 
          onPress={() => setShowNavBar(true)}
        >
          <Ionicons name="menu" size={20} color="#fff" />
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // Selector Styles
  selectorContainer: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  selectorHeader: {
    paddingTop: 40,
    paddingBottom: 20,
    alignItems: 'center',
  },
  selectorTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
  },
  selectorSubtitle: {
    color: '#888',
    fontSize: 16,
    marginTop: 8,
  },
  appCards: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    gap: 12,
  },
  appCard: {
    flex: 1,
    backgroundColor: '#2d2d44',
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 2,
  },
  appIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  appLogo: {
    width: 50,
    height: 50,
  },
  appCardTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  appCardDesc: {
    color: '#888',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 16,
  },
  openButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
    gap: 6,
  },
  openButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  featuresBox: {
    margin: 16,
    backgroundColor: '#2d2d44',
    borderRadius: 16,
    padding: 20,
  },
  featuresTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 16,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 10,
  },
  featureText: {
    color: '#ccc',
    fontSize: 14,
  },
  
  // App Styles
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#1a1a2e',
    borderBottomWidth: 1,
    borderBottomColor: '#2d2d44',
  },
  backButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2d2d44',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  navBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: '#1a1a2e',
    borderTopWidth: 1,
    borderTopColor: '#2d2d44',
  },
  navButton: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: '#2d2d44',
    justifyContent: 'center',
    alignItems: 'center',
  },
  navButtonDisabled: {
    backgroundColor: '#1f1f30',
  },
  showNavButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
  },
  
  // Web Fallback
  webFallbackContainer: {
    flex: 1,
  },
  webFallbackContent: {
    padding: 24,
    alignItems: 'center',
  },
  appTitle: {
    color: '#fff',
    fontSize: 28,
    fontWeight: '700',
    marginTop: 16,
    marginBottom: 8,
  },
  appSubtitle: {
    color: '#888',
    fontSize: 16,
    marginBottom: 24,
  },
  webNotice: {
    color: '#888',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 22,
  },
  openBrowserBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
    gap: 8,
  },
  openBrowserText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
