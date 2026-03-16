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

const APP_URL = 'https://www.kaggle.com/';
const APP_NAME = 'Kaggle';
const APP_COLOR = '#20BEFF';
const BACKGROUND_FETCH_TASK = 'kaggle-keep-alive-task';

// Define the background task (only on native)
if (Platform.OS !== 'web' && TaskManager) {
  TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
    try {
      console.log('[Background] Keeping Kaggle session alive...');
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

export default function KaggleApp() {
  const webViewRef = useRef<WebView>(null);
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showNavBar, setShowNavBar] = useState(true);
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(true);
  const [progress, setProgress] = useState(0);
  const [desktopMode, setDesktopMode] = useState(false);
  const [webViewKey, setWebViewKey] = useState(0);

  // Register background task
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

  // Battery optimization
  const openBatterySettings = () => {
    if (Platform.OS !== 'android') return;
    Alert.alert(
      'Keep App Running',
      'To prevent Android from stopping Kaggle:\n\n1. Tap "Open Settings"\n2. Go to "Battery"\n3. Select "Unrestricted"',
      [
        { text: 'Later', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]
    );
  };

  useEffect(() => {
    if (Platform.OS !== 'web' && keepAwakeEnabled && activateKeepAwakeAsync) {
      activateKeepAwakeAsync('kaggle-session');
    }
    if (Platform.OS !== 'web') registerBackgroundTask();
    if (Platform.OS === 'android') setTimeout(openBatterySettings, 3000);
    return () => {
      if (Platform.OS !== 'web' && deactivateKeepAwake) deactivateKeepAwake('kaggle-session');
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
  const goHome = () => webViewRef.current?.injectJavaScript(`window.location.href = '${APP_URL}'; true;`);

  const toggleKeepAwake = () => {
    if (Platform.OS === 'web') {
      Alert.alert('Not Available', 'Keep Awake is only available on mobile devices.');
      return;
    }
    if (keepAwakeEnabled && deactivateKeepAwake) deactivateKeepAwake('kaggle-session');
    else if (activateKeepAwakeAsync) activateKeepAwakeAsync('kaggle-session');
    setKeepAwakeEnabled(!keepAwakeEnabled);
  };

  const toggleDesktopMode = () => {
    setDesktopMode(!desktopMode);
    setWebViewKey(prev => prev + 1);
    Alert.alert(desktopMode ? 'Mobile Mode' : 'Desktop Mode', 'Page will reload.');
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
        var event = new MouseEvent('mousemove', { 'view': window, 'bubbles': true, 'cancelable': true, 'clientX': Math.random() * 100, 'clientY': Math.random() * 100 });
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
          <Ionicons name="trophy" size={24} color={APP_COLOR} />
          <Text style={styles.headerTitle}>{APP_NAME}</Text>
        </View>
        <ScrollView contentContainerStyle={styles.webFallback}>
          <Ionicons name="trophy" size={80} color={APP_COLOR} />
          <Text style={styles.appTitle}>{APP_NAME} Mobile</Text>
          <Text style={styles.webNotice}>Use Expo Go app on your phone to test!</Text>
          <TouchableOpacity style={[styles.openBtn, { backgroundColor: APP_COLOR }]} onPress={() => Linking.openURL(APP_URL)}>
            <Ionicons name="open-outline" size={20} color="#fff" />
            <Text style={styles.openBtnText}>Open in Browser</Text>
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
          <Ionicons name="trophy" size={24} color={APP_COLOR} />
          <Text style={styles.headerTitle}>{APP_NAME}</Text>
        </View>
        <View style={styles.headerRight}>
          {Platform.OS === 'android' && (
            <TouchableOpacity style={styles.batteryBtn} onPress={openBatterySettings}>
              <Ionicons name="battery-charging" size={18} color="#4CAF50" />
            </TouchableOpacity>
          )}
          <TouchableOpacity style={[styles.keepAwakeBtn, keepAwakeEnabled && styles.keepAwakeActive]} onPress={toggleKeepAwake}>
            <Ionicons name={keepAwakeEnabled ? "flash" : "flash-outline"} size={18} color={keepAwakeEnabled ? "#4CAF50" : "#888"} />
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
          source={{ uri: APP_URL }}
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
          allowsInlineMediaPlayback={true}
          mixedContentMode="always"
          thirdPartyCookiesEnabled={true}
          sharedCookiesEnabled={true}
          cacheEnabled={true}
          allowsBackForwardNavigationGestures={true}
          renderLoading={() => (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={APP_COLOR} />
              <Text style={styles.loadingText}>Loading {APP_NAME}...</Text>
            </View>
          )}
        />
      </View>

      {/* Navigation Bar */}
      {showNavBar && (
        <View style={styles.navBar}>
          <TouchableOpacity style={[styles.navButton, !canGoBack && styles.navButtonDisabled]} onPress={goBack} disabled={!canGoBack}>
            <Ionicons name="chevron-back" size={24} color={canGoBack ? "#fff" : "#555"} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.navButton, !canGoForward && styles.navButtonDisabled]} onPress={goForward} disabled={!canGoForward}>
            <Ionicons name="chevron-forward" size={24} color={canGoForward ? "#fff" : "#555"} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.navButton} onPress={goHome}>
            <Ionicons name="home" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.navButton} onPress={reload}>
            <Ionicons name="refresh" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.navButton, desktopMode && styles.navButtonActive]} onPress={toggleDesktopMode}>
            <Ionicons name={desktopMode ? "desktop" : "phone-portrait"} size={22} color={desktopMode ? APP_COLOR : "#fff"} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.navButton} onPress={() => setShowNavBar(false)}>
            <Ionicons name="eye-off" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {!showNavBar && (
        <TouchableOpacity style={styles.showNavButton} onPress={() => setShowNavBar(true)}>
          <Ionicons name="menu" size={20} color="#fff" />
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: '#1a1a2e', borderBottomWidth: 1, borderBottomColor: '#2d2d44' },
  headerLeft: { flexDirection: 'row', alignItems: 'center' },
  headerTitle: { color: '#fff', fontSize: 20, fontWeight: '700', marginLeft: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  keepAwakeBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: '#2d2d44' },
  batteryBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(76, 175, 80, 0.2)', justifyContent: 'center', alignItems: 'center' },
  keepAwakeActive: { backgroundColor: 'rgba(76, 175, 80, 0.2)' },
  keepAwakeText: { color: '#888', fontSize: 12, fontWeight: '600', marginLeft: 4 },
  keepAwakeTextActive: { color: '#4CAF50' },
  progressContainer: { height: 2, backgroundColor: '#2d2d44' },
  progressBar: { height: '100%', backgroundColor: '#20BEFF' },
  webViewContainer: { flex: 1, backgroundColor: '#fff' },
  webView: { flex: 1 },
  loadingContainer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#fff', marginTop: 12, fontSize: 16, fontWeight: '600' },
  navBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingVertical: 10, paddingHorizontal: 12, backgroundColor: '#1a1a2e', borderTopWidth: 1, borderTopColor: '#2d2d44' },
  navButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#2d2d44', justifyContent: 'center', alignItems: 'center' },
  navButtonDisabled: { backgroundColor: '#1f1f30' },
  navButtonActive: { backgroundColor: 'rgba(32, 190, 255, 0.3)', borderWidth: 1, borderColor: '#20BEFF' },
  showNavButton: { position: 'absolute', bottom: 20, right: 20, width: 44, height: 44, borderRadius: 22, backgroundColor: '#20BEFF', justifyContent: 'center', alignItems: 'center', elevation: 5 },
  webFallback: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' },
  appTitle: { color: '#fff', fontSize: 28, fontWeight: '700', marginTop: 16, marginBottom: 8 },
  webNotice: { color: '#888', fontSize: 14, textAlign: 'center', marginBottom: 24 },
  openBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12, gap: 8 },
  openBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
