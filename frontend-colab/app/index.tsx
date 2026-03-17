import React, { useEffect, useRef, useState, useCallback } from 'react';
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
  Linking,
  ScrollView,
  Modal,
  FlatList,
  AppState,
  AppStateStatus,
  PermissionsAndroid,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

let activateKeepAwakeAsync: any = null;
let deactivateKeepAwake: any = null;
let Audio: any = null;
let IntentLauncher: any = null;

if (Platform.OS !== 'web') {
  const keepAwake = require('expo-keep-awake');
  activateKeepAwakeAsync = keepAwake.activateKeepAwakeAsync;
  deactivateKeepAwake = keepAwake.deactivateKeepAwake;
  Audio = require('expo-av').Audio;
  IntentLauncher = require('expo-intent-launcher');
}

const PERMISSIONS_KEY = 'colab_permissions_done';

const APP_URL = 'https://colab.research.google.com/';
const APP_NAME = 'Google Colab';
const APP_COLOR = '#F9AB00';
const STORAGE_KEY = 'colab_app_state';

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36';

interface Tab { id: string; url: string; title: string; }
interface Bookmark { id: string; title: string; url: string; createdAt: number; }
interface AppSavedState {
  tabs: Tab[];
  activeTabId: string;
  desktopMode: boolean;
  keepAwake: boolean;
  antiIdle: boolean;
  zoomLevel: number;
  showNavBar: boolean;
  bookmarks: Bookmark[];
}

// JS injected BEFORE page loads - suppresses dialogs & locks visibility API
const EARLY_INJECT_JS = `
(function() {
  // Kill beforeunload dialogs completely
  Object.defineProperty(window, 'onbeforeunload', {
    get: function() { return null; },
    set: function() {}
  });
  window.addEventListener('beforeunload', function(e) {
    e.stopImmediatePropagation();
    e.preventDefault();
    delete e.returnValue;
  }, true);
  
  // Override confirm to auto-accept navigation confirmations
  var _origConfirm = window.confirm;
  window.confirm = function(msg) {
    if (msg && (msg.indexOf('navigate away') !== -1 || msg.indexOf('leave') !== -1 || msg.indexOf('Changes you made') !== -1)) {
      return true;
    }
    return _origConfirm.call(window, msg);
  };

  // === CRITICAL: Lock Page Visibility API BEFORE page loads ===
  try {
    Object.defineProperty(document, 'hidden', { get: function() { return false; }, configurable: true });
    Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; }, configurable: true });
  } catch(e) {}

  // Block visibilitychange, blur, pagehide, freeze events
  document.addEventListener('visibilitychange', function(e) { e.stopImmediatePropagation(); e.stopPropagation(); }, true);
  window.addEventListener('blur', function(e) { e.stopImmediatePropagation(); e.stopPropagation(); }, true);
  window.addEventListener('pagehide', function(e) { e.stopImmediatePropagation(); e.stopPropagation(); }, true);
  window.addEventListener('freeze', function(e) { e.stopImmediatePropagation(); e.stopPropagation(); }, true);

  true;
})();
`;

export default function ColabApp() {
  const insets = useSafeAreaInsets();
  const webViewRefs = useRef<{ [key: string]: WebView | null }>({});
  const appState = useRef(AppState.currentState);
  const stateLoaded = useRef(false);
  const saveTimeout = useRef<any>(null);
  const soundRef = useRef<any>(null);
  const periodicSaveRef = useRef<any>(null);
  
  const [tabs, setTabs] = useState<Tab[]>([{ id: '1', url: APP_URL, title: APP_NAME }]);
  const [activeTabId, setActiveTabId] = useState('1');
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showNavBar, setShowNavBar] = useState(true);
  const [keepAwake, setKeepAwake] = useState(true);
  const [progress, setProgress] = useState(0);
  const [desktopMode, setDesktopMode] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showBookmarks, setShowBookmarks] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [currentUrl, setCurrentUrl] = useState(APP_URL);
  const [currentTitle, setCurrentTitle] = useState(APP_NAME);
  const [antiIdle, setAntiIdle] = useState(true);
  const [bgActive, setBgActive] = useState(true);
  const [showPermSetup, setShowPermSetup] = useState(false);
  const [permBattery, setPermBattery] = useState(false);
  const [permNotif, setPermNotif] = useState(false);

  const statusBarHeight = Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 0;
  const topPadding = Math.max(insets.top, statusBarHeight, 24);
  const bottomPadding = Math.max(insets.bottom, 10);

  // ============================================
  // PERMISSION SETUP - Request on first launch
  // ============================================
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const checkPerms = async () => {
      try {
        const done = await AsyncStorage.getItem(PERMISSIONS_KEY);
        if (!done) {
          setTimeout(() => setShowPermSetup(true), 1500);
        }
      } catch (e) {}
    };
    checkPerms();
  }, []);

  const requestBatteryPermission = useCallback(() => {
    setPermBattery(true); // Mark done immediately so UI updates
    try {
      if (Platform.OS === 'android' && IntentLauncher) {
        IntentLauncher.startActivityAsync(
          IntentLauncher.ActivityAction.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
          { data: 'package:com.colab.mobile' }
        ).catch(() => {
          // Fallback: open general battery settings
          try {
            IntentLauncher.startActivityAsync(
              IntentLauncher.ActivityAction.IGNORE_BATTERY_OPTIMIZATION_SETTINGS
            ).catch(() => Linking.openSettings());
          } catch (e) { Linking.openSettings(); }
        });
      } else {
        Linking.openSettings();
      }
    } catch (e) {
      try { Linking.openSettings(); } catch (e2) {}
    }
  }, []);

  const requestNotificationPermission = useCallback(() => {
    setPermNotif(true); // Mark done immediately so UI updates
    try {
      if (Platform.OS === 'android' && PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS) {
        PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS,
          {
            title: `${APP_NAME} Notifications`,
            message: 'Allow notifications to keep your session running in the background.',
            buttonPositive: 'Allow',
            buttonNegative: 'Skip',
          }
        ).catch(() => {});
      }
    } catch (e) {
      // Older Android - no POST_NOTIFICATIONS permission needed
    }
  }, []);

  const finishPermSetup = useCallback(async () => {
    await AsyncStorage.setItem(PERMISSIONS_KEY, 'done');
    setShowPermSetup(false);
  }, []);

  // ============================================
  // SILENT AUDIO - Keeps app alive in background
  // Android won't kill a "media playing" app
  // ============================================
  useEffect(() => {
    if (Platform.OS === 'web' || !Audio || !bgActive) return;
    
    let mounted = true;
    const startSilentAudio = async () => {
      try {
        // Configure audio for background playback
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          staysActiveInBackground: true,
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          playThroughEarpieceAndroid: false,
        });

        // Create a silent audio - we generate a tiny silent WAV inline
        // Using a data URI for a minimal silent WAV file
        const silentWavBase64 = 'UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
        const { sound } = await Audio.Sound.createAsync(
          { uri: `data:audio/wav;base64,${silentWavBase64}` },
          { 
            isLooping: true, 
            volume: 0.01, // Nearly silent
            shouldPlay: true,
            isMuted: false,
          }
        );
        
        if (mounted) {
          soundRef.current = sound;
          await sound.playAsync();
        } else {
          await sound.unloadAsync();
        }
      } catch (e) {
        // Silent audio failed - app may still work but background survival is reduced
        console.log('[BG] Silent audio setup failed:', e);
      }
    };

    startSilentAudio();

    return () => {
      mounted = false;
      if (soundRef.current) {
        soundRef.current.stopAsync().then(() => soundRef.current?.unloadAsync()).catch(() => {});
        soundRef.current = null;
      }
    };
  }, [bgActive]);

  // ============================================
  // STATE PERSISTENCE
  // ============================================
  const saveState = useCallback(async () => {
    try {
      const persistTabs = tabs.map(t => ({id: t.id, url: t.url, title: t.title}));
      const state: AppSavedState = {
        tabs: persistTabs.length > 0 ? persistTabs : [{ id: '1', url: APP_URL, title: APP_NAME }],
        activeTabId: persistTabs.find(t => t.id === activeTabId) ? activeTabId : (persistTabs[0]?.id || '1'),
        desktopMode, keepAwake, antiIdle, zoomLevel, showNavBar, bookmarks,
      };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {}
  }, [tabs, activeTabId, desktopMode, keepAwake, antiIdle, zoomLevel, showNavBar, bookmarks]);

  const debouncedSave = useCallback(() => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    saveTimeout.current = setTimeout(() => {
      if (stateLoaded.current) saveState();
    }, 500);
  }, [saveState]);

  useEffect(() => { debouncedSave(); }, [tabs, activeTabId, desktopMode, keepAwake, antiIdle, zoomLevel, showNavBar, bookmarks, debouncedSave]);

  // Periodic state save every 10 seconds
  useEffect(() => {
    periodicSaveRef.current = setInterval(() => {
      if (stateLoaded.current) saveState();
    }, 10000);
    return () => { if (periodicSaveRef.current) clearInterval(periodicSaveRef.current); };
  }, [saveState]);

  useEffect(() => {
    const loadState = async () => {
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) {
          const state: AppSavedState = JSON.parse(saved);
          if (state.tabs && state.tabs.length > 0) setTabs(state.tabs);
          if (state.activeTabId) setActiveTabId(state.activeTabId);
          if (state.desktopMode !== undefined) setDesktopMode(state.desktopMode);
          if (state.keepAwake !== undefined) setKeepAwake(state.keepAwake);
          if (state.antiIdle !== undefined) setAntiIdle(state.antiIdle);
          if (state.zoomLevel !== undefined) setZoomLevel(state.zoomLevel);
          if (state.showNavBar !== undefined) setShowNavBar(state.showNavBar);
          if (state.bookmarks) setBookmarks(state.bookmarks);
        }
      } catch (e) {}
      stateLoaded.current = true;
    };
    loadState();
  }, []);

  // ============================================
  // LIGHTWEIGHT NATIVE ANTI-IDLE
  // Only pokes the ACTIVE tab every 45 seconds
  // ============================================
  useEffect(() => {
    if (!antiIdle || Platform.OS === 'web') return;
    
    const nativeAntiIdle = setInterval(() => {
      // Only inject into the active tab - not all tabs
      const ref = webViewRefs.current[activeTabId];
      if (ref) {
        ref.injectJavaScript(`
          (function() {
            var x = 200 + Math.floor(Math.random() * 400);
            var y = 300 + Math.floor(Math.random() * 400);
            document.dispatchEvent(new MouseEvent('mousemove', {clientX: x, clientY: y, bubbles: true}));
            window.dispatchEvent(new Event('focus'));
            try {
              Object.defineProperty(document, 'hidden', { get: function() { return false; }, configurable: true });
              Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; }, configurable: true });
            } catch(e) {}
            true;
          })();
        `);
      }
    }, 45000); // Every 45 seconds - gentle

    return () => clearInterval(nativeAntiIdle);
  }, [antiIdle, activeTabId]);

  // ============================================
  // APP STATE - Background/Foreground handling
  // ============================================
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        saveState();
      }
      
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        // COMING BACK FROM BACKGROUND - lightweight re-focus
        if (keepAwake && activateKeepAwakeAsync) activateKeepAwakeAsync('colab');
        
        // Only poke the ACTIVE tab with a small script
        const ref = webViewRefs.current[activeTabId];
        if (ref) {
          ref.injectJavaScript(`
            (function() {
              try {
                Object.defineProperty(document, 'hidden', { get: function() { return false; }, configurable: true });
                Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; }, configurable: true });
              } catch(e) {}
              window.dispatchEvent(new Event('focus'));
              document.dispatchEvent(new Event('focus'));
              window.dispatchEvent(new Event('online'));
              true;
            })();
          `);
          
          // Delayed reconnect check (only once, after 2 seconds)
          setTimeout(() => {
            ref.injectJavaScript(`
              (function() {
                var btns = document.querySelectorAll(
                  '[aria-label*="Reconnect"], colab-connect-button, #connect, ' +
                  'paper-button[id*="reconnect"], button[id*="reconnect"]'
                );
                btns.forEach(function(btn) { if (btn.offsetParent !== null) btn.click(); });
                var dialogs = document.querySelectorAll(
                  'paper-button[dialog-dismiss], paper-button[dialog-confirm], ' +
                  'mwc-button[slot="primaryAction"]'
                );
                dialogs.forEach(function(btn) {
                  var t = (btn.textContent || '').toLowerCase();
                  if (t.indexOf('reconnect') !== -1 || t.indexOf('ok') !== -1 || t.indexOf('connect') !== -1) btn.click();
                });
                true;
              })();
            `);
          }, 2000);
        }
      }
      
      appState.current = nextAppState;
    });
    return () => subscription.remove();
  }, [keepAwake, antiIdle, activeTabId, saveState]);

  // ============================================
  // BOOKMARKS
  // ============================================
  const saveBookmark = async () => {
    const bm: Bookmark = { id: Date.now().toString(), title: currentTitle, url: currentUrl, createdAt: Date.now() };
    setBookmarks(prev => [...prev, bm]);
    Alert.alert('Saved!', 'Bookmark added');
  };

  const deleteBookmark = async (id: string) => {
    setBookmarks(prev => prev.filter(b => b.id !== id));
  };

  // ============================================
  // KEEP AWAKE
  // ============================================
  useEffect(() => {
    if (Platform.OS !== 'web' && keepAwake && activateKeepAwakeAsync) activateKeepAwakeAsync('colab');
    return () => { if (Platform.OS !== 'web' && deactivateKeepAwake) deactivateKeepAwake('colab'); };
  }, [keepAwake]);

  // ============================================
  // BACK BUTTON HANDLER
  // ============================================
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) { webViewRefs.current[activeTabId]?.goBack(); return true; }
      return false;
    });
    return () => handler.remove();
  }, [canGoBack, activeTabId]);

  // ============================================
  // TAB MANAGEMENT
  // ============================================
  const addTab = () => {
    const t: Tab = { id: Date.now().toString(), url: APP_URL, title: 'New Tab' };
    setTabs(prev => [...prev, t]);
    setActiveTabId(t.id);
  };

  const closeTab = (id: string) => {
    if (tabs.length === 1) return;
    const newTabs = tabs.filter(t => t.id !== id);
    if (id === activeTabId) setActiveTabId(newTabs[0].id);
    setTabs(newTabs);
  };

  // ============================================
  // NAVIGATION
  // ============================================
  const goBack = () => webViewRefs.current[activeTabId]?.goBack();
  const goForward = () => webViewRefs.current[activeTabId]?.goForward();
  const reload = () => webViewRefs.current[activeTabId]?.reload();
  const goHome = () => webViewRefs.current[activeTabId]?.injectJavaScript(`window.location.href='${APP_URL}';true;`);

  const zoomIn = () => { const z = Math.min(zoomLevel + 25, 200); setZoomLevel(z); webViewRefs.current[activeTabId]?.injectJavaScript(`document.body.style.zoom='${z}%';true;`); };
  const zoomOut = () => { const z = Math.max(zoomLevel - 25, 50); setZoomLevel(z); webViewRefs.current[activeTabId]?.injectJavaScript(`document.body.style.zoom='${z}%';true;`); };
  const resetZoom = () => { setZoomLevel(100); webViewRefs.current[activeTabId]?.injectJavaScript(`document.body.style.zoom='100%';true;`); };

  const requestBatteryOptimization = useCallback(() => {
    if (Platform.OS === 'android') Linking.openSettings();
  }, []);

  // ============================================
  // WEBVIEW URL HANDLING
  // ============================================
  const handleShouldStartLoad = useCallback((request: any) => {
    const url = request.url || '';
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('about:') || url.startsWith('data:') || url.startsWith('blob:')) {
      return true;
    }
    if (url.startsWith('intent://')) {
      const fallbackMatch = url.match(/S\.browser_fallback_url=([^;]+)/);
      if (fallbackMatch) {
        webViewRefs.current[activeTabId]?.injectJavaScript(`window.location.href='${decodeURIComponent(fallbackMatch[1])}';true;`);
      }
      return false;
    }
    try { Linking.openURL(url); } catch (e) {}
    return false;
  }, [activeTabId]);

  // ============================================
  // HANDLE MESSAGES FROM WEBVIEW
  // ============================================
  const handleMessage = useCallback((event: any, tabId: string) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'OPEN_URL' && data.url) {
        webViewRefs.current[activeTabId]?.injectJavaScript(`window.location.href='${data.url}';true;`);
      }
    } catch (e) {}
  }, [activeTabId]);
  const getInjectedScript = () => `
    (function() {
      // Kill beforeunload dialogs
      window.onbeforeunload = null;
      Object.defineProperty(window, 'onbeforeunload', {
        get: function() { return null; },
        set: function() {}
      });
      window.addEventListener('beforeunload', function(e) {
        e.stopImmediatePropagation();
        e.preventDefault();
        delete e.returnValue;
      }, true);

      // ====== LIGHTWEIGHT ANTI-IDLE SYSTEM ======
        // 3 consolidated timers instead of 12 to prevent UI freezing
        
        // Clear previous timers
        if (window._aiTimers) window._aiTimers.forEach(function(t){ clearInterval(t); });
        window._aiTimers = [];

        if (${antiIdle}) {
          // --- Timer 1: Activity simulation every 30 seconds ---
          window._aiTimers.push(setInterval(function() {
            var x = 100 + Math.floor(Math.random() * (window.innerWidth - 200));
            var y = 100 + Math.floor(Math.random() * (window.innerHeight - 200));
            document.dispatchEvent(new MouseEvent('mousemove', {clientX: x, clientY: y, bubbles: true}));
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('focus'));
            try {
              Object.defineProperty(document, 'hidden', { get: function() { return false; }, configurable: true });
              Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; }, configurable: true });
            } catch(e) {}
            window.dispatchEvent(new Event('online'));
          }, 30000));

          // --- Timer 2: Colab auto-reconnect every 60 seconds ---
          window._aiTimers.push(setInterval(function() {
            var btns = document.querySelectorAll(
              'paper-button[id*="reconnect"], button[id*="reconnect"], ' +
              '[aria-label*="Reconnect"], colab-connect-button, #connect, ' +
              'paper-button[dialog-dismiss], paper-button[dialog-confirm], ' +
              'mwc-button[slot="primaryAction"]'
            );
            btns.forEach(function(btn) {
              if (btn.offsetParent !== null) {
                var t = (btn.textContent || '').toLowerCase();
                if (t.indexOf('reconnect') !== -1 || t.indexOf('ok') !== -1 || 
                    t.indexOf('connect') !== -1 || t.indexOf('yes') !== -1 || btn.id) {
                  btn.click();
                }
              }
            });
          }, 60000));

          // --- Timer 3: Block visibility/blur events (one-time setup) ---
          if (!window._eventsBlocked) {
            window._eventsBlocked = true;
            document.addEventListener('visibilitychange', function(e) { e.stopImmediatePropagation(); }, true);
            window.addEventListener('blur', function(e) { e.stopImmediatePropagation(); }, true);
          }

          // Lock visibility API once
          try {
            Object.defineProperty(document, 'hidden', { get: function() { return false; }, configurable: true });
            Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; }, configurable: true });
          } catch(e) {}
        }

        // Viewport
        var meta = document.querySelector('meta[name="viewport"]') || document.createElement('meta');
        meta.name = 'viewport';
        meta.content = ${desktopMode} 
          ? 'width=1200,initial-scale=0.5,maximum-scale=3,user-scalable=yes' 
          : 'width=device-width,initial-scale=1,maximum-scale=3,user-scalable=yes';
        if (!document.querySelector('meta[name="viewport"]')) document.head.appendChild(meta);
      
      true;
    })();
  `;

  // ============================================
  // WEBVIEW PROCESS DEATH HANDLER
  // If Android kills a WebView process, detect & reload
  // ============================================
  const handleRenderProcessGone = useCallback((tabId: string) => {
    webViewRefs.current[tabId]?.reload();
  }, []);

  const handleContentProcessDidTerminate = useCallback((tabId: string) => {
    // iOS equivalent - WebView content process terminated
    webViewRefs.current[tabId]?.reload();
  }, []);

  // ============================================
  // WEB FALLBACK
  // ============================================
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, {paddingTop: topPadding}]}>
        <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" translucent />
        <View style={styles.webFallback}>
          <Ionicons name="logo-google" size={80} color={APP_COLOR} />
          <Text style={styles.title}>{APP_NAME}</Text>
          <Text style={styles.subtitle}>Use Expo Go on your phone!</Text>
          <TouchableOpacity style={[styles.btn, {backgroundColor: APP_COLOR}]} onPress={() => Linking.openURL(APP_URL)}>
            <Text style={styles.btnText}>Open in Browser</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ============================================
  // MAIN RENDER
  // ============================================
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" translucent />
      
      <View style={[styles.header, {paddingTop: topPadding}]}>
        <View style={styles.headerLeft}>
          <Ionicons name="logo-google" size={24} color={APP_COLOR} />
          <Text style={styles.headerTitle}>{APP_NAME}</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.hBtn} onPress={() => setBgActive(!bgActive)}>
            <Ionicons name={bgActive ? "moon" : "moon-outline"} size={20} color={bgActive ? "#4CAF50" : "#888"} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.hBtn} onPress={() => setAntiIdle(!antiIdle)}>
            <Ionicons name={antiIdle ? "shield-checkmark" : "shield-outline"} size={20} color={antiIdle ? "#4CAF50" : "#888"} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.hBtn, keepAwake && styles.hBtnActive]} onPress={() => setKeepAwake(!keepAwake)}>
            <Ionicons name="flash" size={20} color={keepAwake ? "#4CAF50" : "#888"} />
          </TouchableOpacity>
        </View>
      </View>

      {/* TABS BAR */}
      <View style={styles.tabsBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex:1}}>
          {tabs.map(tab => (
            <TouchableOpacity key={tab.id} style={[styles.tab, tab.id === activeTabId && styles.tabActive]} onPress={() => setActiveTabId(tab.id)}>
              <Text style={[styles.tabText, tab.id === activeTabId && styles.tabTextActive]} numberOfLines={1}>{tab.title}</Text>
              {(tabs.length > 1) && (
                <TouchableOpacity onPress={() => closeTab(tab.id)} style={styles.tabClose}>
                  <Ionicons name="close" size={16} color="#888" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.addTab} onPress={addTab}><Ionicons name="add" size={24} color="#fff" /></TouchableOpacity>
      </View>

      {isLoading && <View style={styles.progressBar}><View style={[styles.progressFill, {width: `${progress*100}%`, backgroundColor: APP_COLOR}]} /></View>}

      {/* WEBVIEW - All tabs rendered, only active one visible */}
      <View style={styles.webViewContainer}>
        {tabs.map(tab => (
          <View key={tab.id} style={[styles.webViewWrap, {display: tab.id === activeTabId ? 'flex' : 'none'}]}>
            <WebView
              ref={ref => webViewRefs.current[tab.id] = ref}
              source={{uri: tab.url}}
              style={styles.webView}
              onNavigationStateChange={(nav) => {
                if (tab.id === activeTabId) {
                  setCanGoBack(nav.canGoBack);
                  setCanGoForward(nav.canGoForward);
                  setCurrentUrl(nav.url);
                  setCurrentTitle(nav.title || APP_NAME);
                }
                setTabs(prev => prev.map(t => t.id === tab.id ? {...t, title: nav.title || 'Tab', url: nav.url} : t));
              }}
              onLoadStart={() => tab.id === activeTabId && setIsLoading(true)}
              onLoadEnd={() => tab.id === activeTabId && setIsLoading(false)}
              onLoadProgress={({nativeEvent}) => tab.id === activeTabId && setProgress(nativeEvent.progress)}
              
              // In-place auth: Google OAuth navigates within this same WebView
              // No popups or separate WebViews needed
              setSupportMultipleWindows={false}
              
              originWhitelist={['*']}
              onShouldStartLoadWithRequest={handleShouldStartLoad}
              onMessage={(e) => handleMessage(e, tab.id)}
              
              // Inject visibility lock + anti-idle scripts
              injectedJavaScriptBeforeContentLoaded={EARLY_INJECT_JS}
              injectedJavaScript={getInjectedScript()}
              
              userAgent={desktopMode ? DESKTOP_UA : MOBILE_UA}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              startInLoadingState={true}
              allowsInlineMediaPlayback={true}
              mixedContentMode="always"
              thirdPartyCookiesEnabled={true}
              sharedCookiesEnabled={true}
              cacheEnabled={true}
              allowsBackForwardNavigationGestures={true}
              allowFileAccess={true}
              allowFileAccessFromFileURLs={true}
              allowUniversalAccessFromFileURLs={true}
              mediaPlaybackRequiresUserAction={false}
              androidLayerType="hardware"
              
              // Detect WebView process death
              onRenderProcessGone={() => handleRenderProcessGone(tab.id)}
              onContentProcessDidTerminate={() => handleContentProcessDidTerminate(tab.id)}
              
              renderLoading={() => (
                <View style={styles.loading}>
                  <ActivityIndicator size="large" color={APP_COLOR} />
                  <Text style={styles.loadingText}>Loading {APP_NAME}...</Text>
                </View>
              )}
            />
          </View>
        ))}
      </View>

      {showNavBar && (
        <View style={[styles.navBar, {paddingBottom: bottomPadding}]}>
          <TouchableOpacity style={styles.navBtn} onPress={goBack}><Ionicons name="chevron-back" size={24} color="#fff" /></TouchableOpacity>
          <TouchableOpacity style={[styles.navBtn, !canGoForward && styles.navBtnDisabled]} onPress={goForward} disabled={!canGoForward}><Ionicons name="chevron-forward" size={24} color={canGoForward ? "#fff" : "#555"} /></TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} onPress={goHome}><Ionicons name="home" size={22} color="#fff" /></TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} onPress={reload}><Ionicons name="refresh" size={22} color="#fff" /></TouchableOpacity>
          <TouchableOpacity style={[styles.navBtn, desktopMode && styles.navBtnActive]} onPress={() => {setDesktopMode(!desktopMode); reload();}}><Ionicons name={desktopMode ? "desktop" : "phone-portrait"} size={22} color={desktopMode ? APP_COLOR : "#fff"} /></TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} onPress={() => setShowNavBar(false)}><Ionicons name="chevron-down" size={22} color="#fff" /></TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={[styles.fab, {backgroundColor: APP_COLOR, bottom: showNavBar ? bottomPadding + 80 : bottomPadding + 20}]} onPress={() => setShowQuickActions(true)}>
        <Ionicons name="menu" size={24} color="#fff" />
      </TouchableOpacity>

      <Modal visible={showQuickActions} transparent animationType="fade">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setShowQuickActions(false)}>
          <View style={[styles.quickMenu, {bottom: showNavBar ? bottomPadding + 140 : bottomPadding + 80}]}>
            <TouchableOpacity style={styles.qItem} onPress={() => {saveBookmark(); setShowQuickActions(false);}}><Ionicons name="bookmark" size={24} color="#F9AB00" /><Text style={styles.qText}>Save Bookmark</Text></TouchableOpacity>
            <TouchableOpacity style={styles.qItem} onPress={() => {setShowBookmarks(true); setShowQuickActions(false);}}><Ionicons name="bookmarks" size={24} color="#20BEFF" /><Text style={styles.qText}>View Bookmarks</Text></TouchableOpacity>
            <TouchableOpacity style={styles.qItem} onPress={() => {zoomIn(); setShowQuickActions(false);}}><Ionicons name="add-circle" size={24} color="#4CAF50" /><Text style={styles.qText}>Zoom In ({zoomLevel}%)</Text></TouchableOpacity>
            <TouchableOpacity style={styles.qItem} onPress={() => {zoomOut(); setShowQuickActions(false);}}><Ionicons name="remove-circle" size={24} color="#FF5722" /><Text style={styles.qText}>Zoom Out</Text></TouchableOpacity>
            <TouchableOpacity style={styles.qItem} onPress={() => {resetZoom(); setShowQuickActions(false);}}><Ionicons name="resize" size={24} color="#9C27B0" /><Text style={styles.qText}>Reset Zoom</Text></TouchableOpacity>
            <TouchableOpacity style={styles.qItem} onPress={() => {requestBatteryOptimization(); setShowQuickActions(false);}}><Ionicons name="battery-charging" size={24} color="#4CAF50" /><Text style={styles.qText}>Battery Settings</Text></TouchableOpacity>
            {!showNavBar && <TouchableOpacity style={styles.qItem} onPress={() => {setShowNavBar(true); setShowQuickActions(false);}}><Ionicons name="chevron-up" size={24} color="#fff" /><Text style={styles.qText}>Show Nav Bar</Text></TouchableOpacity>}
          </View>
        </TouchableOpacity>
      </Modal>

      <Modal visible={showBookmarks} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}><Text style={styles.modalTitle}>Bookmarks</Text><TouchableOpacity onPress={() => setShowBookmarks(false)}><Ionicons name="close" size={28} color="#fff" /></TouchableOpacity></View>
            {bookmarks.length === 0 ? <Text style={styles.emptyText}>No bookmarks yet!</Text> : (
              <FlatList data={bookmarks} keyExtractor={i => i.id} renderItem={({item}) => (
                <View style={styles.bmItem}>
                  <TouchableOpacity style={{flex:1}} onPress={() => {webViewRefs.current[activeTabId]?.injectJavaScript(`window.location.href='${item.url}';true;`); setShowBookmarks(false);}}>
                    <Text style={styles.bmTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.bmUrl} numberOfLines={1}>{item.url}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteBookmark(item.id)}><Ionicons name="trash" size={20} color="#FF5722" /></TouchableOpacity>
                </View>
              )} />
            )}
          </View>
        </View>
      </Modal>

      {/* PERMISSION SETUP MODAL */}
      <Modal visible={showPermSetup} animationType="slide" transparent>
        <View style={styles.overlay}>
          <View style={styles.permModal}>
            <TouchableOpacity style={{position:'absolute', top:16, right:16, zIndex:10, width:36, height:36, borderRadius:18, backgroundColor:'#3d3d54', justifyContent:'center', alignItems:'center'}} onPress={finishPermSetup}>
              <Ionicons name="close" size={22} color="#fff" />
            </TouchableOpacity>
            <View style={{alignItems:'center', marginBottom:20}}>
              <Ionicons name="settings-outline" size={48} color={APP_COLOR} />
              <Text style={styles.permTitle}>Setup for Best Experience</Text>
              <Text style={styles.permDesc}>
                To keep your Colab notebooks running in the background without disconnecting, we need a couple of permissions.
              </Text>
            </View>

            {/* Battery Optimization */}
            <TouchableOpacity
              style={[styles.permItem, permBattery && styles.permItemDone]}
              onPress={requestBatteryPermission}
            >
              <View style={styles.permItemLeft}>
                <View style={[styles.permIcon, {backgroundColor: permBattery ? '#4CAF50' : '#F9AB00'}]}>
                  <Ionicons name={permBattery ? "checkmark" : "battery-charging"} size={22} color="#fff" />
                </View>
                <View style={{flex:1}}>
                  <Text style={styles.permItemTitle}>Disable Battery Optimization</Text>
                  <Text style={styles.permItemDesc}>Prevents Android from killing the app in background</Text>
                </View>
              </View>
              <Ionicons name={permBattery ? "checkmark-circle" : "chevron-forward"} size={24} color={permBattery ? "#4CAF50" : "#888"} />
            </TouchableOpacity>

            {/* Notifications */}
            <TouchableOpacity
              style={[styles.permItem, permNotif && styles.permItemDone]}
              onPress={requestNotificationPermission}
            >
              <View style={styles.permItemLeft}>
                <View style={[styles.permIcon, {backgroundColor: permNotif ? '#4CAF50' : '#20BEFF'}]}>
                  <Ionicons name={permNotif ? "checkmark" : "notifications"} size={22} color="#fff" />
                </View>
                <View style={{flex:1}}>
                  <Text style={styles.permItemTitle}>Allow Notifications</Text>
                  <Text style={styles.permItemDesc}>Needed for background session alerts</Text>
                </View>
              </View>
              <Ionicons name={permNotif ? "checkmark-circle" : "chevron-forward"} size={24} color={permNotif ? "#4CAF50" : "#888"} />
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.permDoneBtn, {backgroundColor: APP_COLOR}]}
              onPress={finishPermSetup}
            >
              <Text style={styles.permDoneBtnText}>
                {permBattery && permNotif ? "All Done!" : "Continue Anyway"}
              </Text>
            </TouchableOpacity>

            <Text style={styles.permNote}>
              You can change these later in your phone's Settings app.
            </Text>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {flex:1, backgroundColor:'#1a1a2e'},
  header: {flexDirection:'row', alignItems:'center', justifyContent:'space-between', paddingHorizontal:16, paddingBottom:10, backgroundColor:'#1a1a2e', borderBottomWidth:1, borderBottomColor:'#2d2d44'},
  headerLeft: {flexDirection:'row', alignItems:'center'},
  headerTitle: {color:'#fff', fontSize:20, fontWeight:'700', marginLeft:8},
  headerRight: {flexDirection:'row', alignItems:'center', gap:8},
  hBtn: {width:36, height:36, borderRadius:18, backgroundColor:'#2d2d44', justifyContent:'center', alignItems:'center'},
  hBtnActive: {backgroundColor:'rgba(76,175,80,0.2)'},
  tabsBar: {flexDirection:'row', backgroundColor:'#252538', borderBottomWidth:1, borderBottomColor:'#2d2d44'},
  tab: {flexDirection:'row', alignItems:'center', paddingHorizontal:16, paddingVertical:10, borderRightWidth:1, borderRightColor:'#2d2d44', maxWidth:150},
  tabActive: {backgroundColor:'#1a1a2e'},
  tabText: {color:'#888', fontSize:13, flex:1},
  tabTextActive: {color:'#fff'},
  tabClose: {marginLeft:8, padding:2},
  addTab: {paddingHorizontal:16, justifyContent:'center', alignItems:'center'},
  progressBar: {height:2, backgroundColor:'#2d2d44'},
  progressFill: {height:'100%'},
  webViewContainer: {flex:1, backgroundColor:'#fff'},
  webViewWrap: {flex:1},
  webView: {flex:1},
  loading: {position:'absolute', top:0, left:0, right:0, bottom:0, backgroundColor:'#1a1a2e', justifyContent:'center', alignItems:'center'},
  loadingText: {color:'#fff', marginTop:12, fontSize:16},
  navBar: {flexDirection:'row', alignItems:'center', justifyContent:'space-around', paddingTop:10, paddingHorizontal:12, backgroundColor:'#1a1a2e', borderTopWidth:1, borderTopColor:'#2d2d44'},
  navBtn: {width:46, height:46, borderRadius:23, backgroundColor:'#2d2d44', justifyContent:'center', alignItems:'center'},
  navBtnDisabled: {backgroundColor:'#1f1f30'},
  navBtnActive: {backgroundColor:'rgba(249,171,0,0.3)', borderWidth:1, borderColor:'#F9AB00'},
  fab: {position:'absolute', right:20, width:56, height:56, borderRadius:28, justifyContent:'center', alignItems:'center', elevation:8},
  overlay: {flex:1, backgroundColor:'rgba(0,0,0,0.7)', justifyContent:'center', alignItems:'center'},
  quickMenu: {position:'absolute', right:20, backgroundColor:'#2d2d44', borderRadius:16, padding:8, minWidth:200},
  qItem: {flexDirection:'row', alignItems:'center', padding:14, gap:12},
  qText: {color:'#fff', fontSize:14},
  modalContent: {width:'90%', maxHeight:'70%', backgroundColor:'#2d2d44', borderRadius:16, padding:20},
  modalHeader: {flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:20},
  modalTitle: {color:'#fff', fontSize:20, fontWeight:'700'},
  emptyText: {color:'#888', fontSize:14, textAlign:'center', paddingVertical:40},
  bmItem: {flexDirection:'row', alignItems:'center', paddingVertical:12, borderBottomWidth:1, borderBottomColor:'#3d3d54'},
  bmTitle: {color:'#fff', fontSize:14, fontWeight:'600'},
  bmUrl: {color:'#888', fontSize:12, marginTop:4},
  webFallback: {flex:1, justifyContent:'center', alignItems:'center', padding:20},
  title: {color:'#fff', fontSize:28, fontWeight:'700', marginTop:20},
  subtitle: {color:'#888', fontSize:16, marginBottom:20},
  btn: {paddingHorizontal:24, paddingVertical:14, borderRadius:12},
  btnText: {color:'#fff', fontSize:16, fontWeight:'600'},
  permModal: {width:'90%', backgroundColor:'#1e1e36', borderRadius:20, padding:24, maxHeight:'80%'},
  permTitle: {color:'#fff', fontSize:22, fontWeight:'700', marginTop:12, textAlign:'center'},
  permDesc: {color:'#aaa', fontSize:14, textAlign:'center', marginTop:8, lineHeight:20},
  permItem: {flexDirection:'row', alignItems:'center', justifyContent:'space-between', backgroundColor:'#2d2d44', borderRadius:14, padding:16, marginBottom:12},
  permItemDone: {backgroundColor:'rgba(76,175,80,0.15)', borderWidth:1, borderColor:'#4CAF50'},
  permItemLeft: {flexDirection:'row', alignItems:'center', flex:1, gap:12},
  permIcon: {width:44, height:44, borderRadius:22, justifyContent:'center', alignItems:'center'},
  permItemTitle: {color:'#fff', fontSize:15, fontWeight:'600'},
  permItemDesc: {color:'#888', fontSize:12, marginTop:2},
  permDoneBtn: {paddingVertical:16, borderRadius:14, alignItems:'center', marginTop:8},
  permDoneBtnText: {color:'#fff', fontSize:17, fontWeight:'700'},
  permNote: {color:'#666', fontSize:12, textAlign:'center', marginTop:12},
});
