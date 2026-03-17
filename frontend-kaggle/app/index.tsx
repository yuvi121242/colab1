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
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

let activateKeepAwakeAsync: any = null;
let deactivateKeepAwake: any = null;

if (Platform.OS !== 'web') {
  const keepAwake = require('expo-keep-awake');
  activateKeepAwakeAsync = keepAwake.activateKeepAwakeAsync;
  deactivateKeepAwake = keepAwake.deactivateKeepAwake;
}

const APP_URL = 'https://www.kaggle.com/';
const APP_NAME = 'Kaggle';
const APP_COLOR = '#20BEFF';
const STORAGE_KEY = 'kaggle_app_state';

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36';

interface Tab { id: string; url: string; title: string; isPopup?: boolean; parentTabId?: string; }
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

// JS injected BEFORE page loads - suppresses "are you sure you want to leave" dialogs
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
      return true; // Auto-accept navigation
    }
    return _origConfirm.call(window, msg);
  };
  true;
})();
`;

export default function KaggleApp() {
  const insets = useSafeAreaInsets();
  const webViewRefs = useRef<{ [key: string]: WebView | null }>({});
  const appState = useRef(AppState.currentState);
  const stateLoaded = useRef(false);
  const saveTimeout = useRef<any>(null);
  
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

  const statusBarHeight = Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 0;
  const topPadding = Math.max(insets.top, statusBarHeight, 24);
  const bottomPadding = Math.max(insets.bottom, 10);

  // ============================================
  // STATE PERSISTENCE
  // ============================================
  const saveState = useCallback(async () => {
    try {
      // Don't save popup tabs - they're temporary
      const persistTabs = tabs.filter(t => !t.isPopup).map(t => ({...t, isPopup: undefined, parentTabId: undefined}));
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
  // APP STATE - Save on background
  // ============================================
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (nextAppState === 'background' || nextAppState === 'inactive') {
        saveState();
      }
      if (appState.current.match(/inactive|background/) && nextAppState === 'active') {
        if (keepAwake && activateKeepAwakeAsync) activateKeepAwakeAsync('kaggle');
        if (antiIdle && webViewRefs.current[activeTabId]) {
          webViewRefs.current[activeTabId]?.injectJavaScript(`
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('focus'));
            true;
          `);
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
    if (Platform.OS !== 'web' && keepAwake && activateKeepAwakeAsync) activateKeepAwakeAsync('kaggle');
    return () => { if (Platform.OS !== 'web' && deactivateKeepAwake) deactivateKeepAwake('kaggle'); };
  }, [keepAwake]);

  // ============================================
  // NATIVE-SIDE ANTI-IDLE: Re-inject activity into ALL tabs periodically
  // This ensures even if JS timers get killed, activity continues
  // ============================================
  useEffect(() => {
    if (!antiIdle || Platform.OS === 'web') return;
    const nativeAntiIdle = setInterval(() => {
      // Inject activity into ALL non-popup tabs (keeps them all alive)
      tabs.forEach(tab => {
        if (!tab.isPopup && webViewRefs.current[tab.id]) {
          webViewRefs.current[tab.id]?.injectJavaScript(`
            (function() {
              var x = 200 + Math.floor(Math.random() * 400);
              var y = 300 + Math.floor(Math.random() * 400);
              document.dispatchEvent(new MouseEvent('mousemove', {clientX: x, clientY: y, bubbles: true}));
              window.dispatchEvent(new Event('focus'));
              document.dispatchEvent(new Event('focus'));
              try {
                Object.defineProperty(document, 'hidden', { get: function() { return false; }, configurable: true });
                Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; }, configurable: true });
              } catch(e) {}
              true;
            })();
          `);
        }
      });
    }, 20000); // Every 20 seconds from native side
    return () => clearInterval(nativeAntiIdle);
  }, [antiIdle, tabs]);

  // ============================================
  // BACK BUTTON HANDLER
  // ============================================
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      // If on a popup tab, close it and go back to parent
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab?.isPopup && activeTab?.parentTabId) {
        closePopupTab(activeTabId, activeTab.parentTabId);
        return true;
      }
      if (canGoBack) { webViewRefs.current[activeTabId]?.goBack(); return true; }
      return false;
    });
    return () => handler.remove();
  }, [canGoBack, activeTabId, tabs]);

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

  // Close a popup tab and return to parent
  const closePopupTab = useCallback((popupId: string, parentId: string) => {
    setTabs(prev => prev.filter(t => t.id !== popupId));
    setActiveTabId(parentId);
  }, []);

  // ============================================
  // NAVIGATION
  // ============================================
  const goBack = () => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab?.isPopup && activeTab?.parentTabId) {
      closePopupTab(activeTabId, activeTab.parentTabId);
    } else {
      webViewRefs.current[activeTabId]?.goBack();
    }
  };
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
  // HANDLE POPUP WINDOWS (OAuth, Google login)
  // Opens in a NEW in-app tab, preserving the original Kaggle page
  // ============================================
  const handleOpenWindow = useCallback((syntheticEvent: any) => {
    const url = syntheticEvent?.nativeEvent?.targetUrl;
    if (url) {
      // Create a new popup tab for OAuth
      const popupTab: Tab = {
        id: 'popup_' + Date.now().toString(),
        url: url,
        title: 'Authenticating...',
        isPopup: true,
        parentTabId: activeTabId,
      };
      setTabs(prev => [...prev, popupTab]);
      setActiveTabId(popupTab.id);
    }
  }, [activeTabId]);

  // ============================================
  // INJECTED JAVASCRIPT - Aggressive anti-idle for hours of use
  // ============================================
  const getInjectedScript = (isPopup: boolean = false) => `
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

      ${isPopup ? `
        // POPUP TAB: Watch for "close this tab" message
        function checkCloseMessage() {
          var text = document.body ? document.body.innerText : '';
          if (text.indexOf('close this tab') !== -1 || text.indexOf('close this window') !== -1 || text.indexOf('Please close this') !== -1) {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({type: 'CLOSE_POPUP'}));
            }
          }
        }
        setInterval(checkCloseMessage, 1000);
        if (typeof MutationObserver !== 'undefined') {
          new MutationObserver(checkCloseMessage).observe(document, {childList: true, subtree: true, characterData: true});
        }
        setTimeout(checkCloseMessage, 500);
      ` : `
        // ====== AGGRESSIVE ANTI-IDLE SYSTEM ======
        // Keeps Kaggle alive for hours by simulating real user activity
        
        // Clear any previous timers
        if (window._aiTimers) window._aiTimers.forEach(function(t){ clearInterval(t); clearTimeout(t); });
        window._aiTimers = [];

        if (${antiIdle}) {
          // --- Layer 1: Mouse activity every 15-25 seconds ---
          window._aiTimers.push(setInterval(function() {
            var x = 100 + Math.floor(Math.random() * (window.innerWidth - 200));
            var y = 100 + Math.floor(Math.random() * (window.innerHeight - 200));
            var events = ['mousemove', 'mouseover', 'mouseenter'];
            events.forEach(function(type) {
              document.dispatchEvent(new MouseEvent(type, {clientX: x, clientY: y, bubbles: true, cancelable: true}));
            });
            // Also dispatch on body and document element
            if (document.body) document.body.dispatchEvent(new MouseEvent('mousemove', {clientX: x, clientY: y, bubbles: true}));
          }, 15000 + Math.random() * 10000));

          // --- Layer 2: Focus + visibility every 20 seconds ---
          window._aiTimers.push(setInterval(function() {
            window.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('focus'));
            document.dispatchEvent(new Event('visibilitychange'));
            // Fake document.hidden = false
            try {
              Object.defineProperty(document, 'hidden', { value: false, writable: true, configurable: true });
              Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: true, configurable: true });
            } catch(e) {}
          }, 20000));

          // --- Layer 3: Keyboard events every 30 seconds ---
          window._aiTimers.push(setInterval(function() {
            var keys = [16, 17, 18, 91]; // Shift, Ctrl, Alt, Meta (harmless)
            var key = keys[Math.floor(Math.random() * keys.length)];
            document.dispatchEvent(new KeyboardEvent('keydown', {keyCode: key, bubbles: true}));
            setTimeout(function() {
              document.dispatchEvent(new KeyboardEvent('keyup', {keyCode: key, bubbles: true}));
            }, 50 + Math.random() * 100);
          }, 30000 + Math.random() * 10000));

          // --- Layer 4: Scroll micro-movements every 45 seconds ---
          window._aiTimers.push(setInterval(function() {
            var scrollAmount = Math.floor(Math.random() * 6) - 3; // -3 to +3 pixels
            window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
            // Scroll back after a moment to stay in place
            setTimeout(function() {
              window.scrollBy({ top: -scrollAmount, behavior: 'smooth' });
            }, 2000);
          }, 45000 + Math.random() * 15000));

          // --- Layer 5: Touch events every 25 seconds (for mobile detection) ---
          window._aiTimers.push(setInterval(function() {
            var x = 200 + Math.floor(Math.random() * 300);
            var y = 300 + Math.floor(Math.random() * 400);
            try {
              var touch = new Touch({ identifier: 1, target: document.body, clientX: x, clientY: y });
              document.dispatchEvent(new TouchEvent('touchstart', { touches: [touch], bubbles: true }));
              setTimeout(function() {
                document.dispatchEvent(new TouchEvent('touchend', { changedTouches: [touch], bubbles: true }));
              }, 50);
            } catch(e) {}
          }, 25000 + Math.random() * 10000));

          // --- Layer 6: Kaggle-specific - Click on content area every 60 seconds ---
          window._aiTimers.push(setInterval(function() {
            // Try to click on the notebook/content area (not buttons)
            var cells = document.querySelectorAll('.cell, .kaggle-markdown, .rendered_html, [role="textbox"], .site-content');
            if (cells.length > 0) {
              var cell = cells[Math.floor(Math.random() * cells.length)];
              cell.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}));
            }
            // Also try to interact with Kaggle's own elements
            var kaggleEl = document.querySelector('.site-content, #site-content, [class*="notebook"]');
            if (kaggleEl) {
              kaggleEl.dispatchEvent(new MouseEvent('mousemove', {clientX: 400, clientY: 400, bubbles: true}));
            }
          }, 60000 + Math.random() * 15000));

          // --- Layer 7: Override Kaggle's idle detection ---
          // Sites use document.hidden and visibilityState to detect idle
          try {
            Object.defineProperty(document, 'hidden', { get: function() { return false; }, configurable: true });
            Object.defineProperty(document, 'visibilityState', { get: function() { return 'visible'; }, configurable: true });
          } catch(e) {}

          // --- Layer 8: Keep WebSocket connections alive ---
          window._aiTimers.push(setInterval(function() {
            // Prevent site from thinking connection is lost
            if (navigator.onLine !== undefined) {
              try {
                Object.defineProperty(navigator, 'onLine', { get: function() { return true; }, configurable: true });
              } catch(e) {}
            }
            // Dispatch online event
            window.dispatchEvent(new Event('online'));
          }, 30000));

          // --- Layer 9: Override setTimeout/setInterval idle detectors ---
          // Some sites use long setTimeout to detect idle - we intercept and reset them
          if (!window._idleOverrideApplied) {
            window._idleOverrideApplied = true;
            var origSetTimeout = window.setTimeout;
            window.setTimeout = function(fn, delay) {
              // If it looks like an idle timeout (>= 5 minutes), reduce it
              if (delay >= 300000) {
                delay = Math.max(delay, 600000); // Let it run but we'll keep faking activity
              }
              return origSetTimeout.apply(window, arguments);
            };
          }

          // --- Layer 10: Heartbeat logger ---
          window._aiTimers.push(setInterval(function() {
            console.log('[AntiIdle] Heartbeat - ' + new Date().toLocaleTimeString() + ' - Active for ' + Math.round((Date.now() - (window._aiStartTime || Date.now())) / 60000) + ' min');
          }, 120000));
          window._aiStartTime = window._aiStartTime || Date.now();
        }

        // Viewport
        var meta = document.querySelector('meta[name="viewport"]') || document.createElement('meta');
        meta.name = 'viewport';
        meta.content = ${desktopMode} 
          ? 'width=1200,initial-scale=0.5,maximum-scale=3,user-scalable=yes' 
          : 'width=device-width,initial-scale=1,maximum-scale=3,user-scalable=yes';
        if (!document.querySelector('meta[name="viewport"]')) document.head.appendChild(meta);
      `}
      
      true;
    })();
  `;

  // ============================================
  // HANDLE MESSAGES FROM WEBVIEW
  // ============================================
  const handleMessage = useCallback((event: any, tabId: string) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'CLOSE_POPUP') {
        // OAuth complete - close popup tab and go back to parent
        const tab = tabs.find(t => t.id === tabId);
        if (tab?.isPopup && tab?.parentTabId) {
          closePopupTab(tabId, tab.parentTabId);
        }
      }
      if (data.type === 'OPEN_URL' && data.url) {
        webViewRefs.current[activeTabId]?.injectJavaScript(`window.location.href='${data.url}';true;`);
      }
    } catch (e) {}
  }, [activeTabId, tabs, closePopupTab]);

  // ============================================
  // WEB FALLBACK
  // ============================================
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, {paddingTop: topPadding}]}>
        <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" translucent />
        <View style={styles.webFallback}>
          <Ionicons name="trophy" size={80} color={APP_COLOR} />
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
          <Ionicons name="trophy" size={24} color={APP_COLOR} />
          <Text style={styles.headerTitle}>{APP_NAME}</Text>
        </View>
        <View style={styles.headerRight}>
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
            <TouchableOpacity key={tab.id} style={[styles.tab, tab.id === activeTabId && styles.tabActive, tab.isPopup && styles.tabPopup]} onPress={() => setActiveTabId(tab.id)}>
              {tab.isPopup && <Ionicons name="lock-closed" size={12} color="#20BEFF" style={{marginRight:4}} />}
              <Text style={[styles.tabText, tab.id === activeTabId && styles.tabTextActive]} numberOfLines={1}>{tab.title}</Text>
              {(tabs.length > 1) && (
                <TouchableOpacity onPress={() => {
                  if (tab.isPopup && tab.parentTabId) {
                    closePopupTab(tab.id, tab.parentTabId);
                  } else {
                    closeTab(tab.id);
                  }
                }} style={styles.tabClose}>
                  <Ionicons name="close" size={16} color="#888" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.addTab} onPress={addTab}><Ionicons name="add" size={24} color="#fff" /></TouchableOpacity>
      </View>

      {isLoading && <View style={styles.progressBar}><View style={[styles.progressFill, {width: `${progress*100}%`, backgroundColor: APP_COLOR}]} /></View>}

      {/* WEBVIEW - All tabs rendered but only active one visible */}
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
                setTabs(prev => prev.map(t => t.id === tab.id ? {...t, title: nav.title || (t.isPopup ? 'Auth' : 'Tab'), url: nav.url} : t));
              }}
              onLoadStart={() => tab.id === activeTabId && setIsLoading(true)}
              onLoadEnd={() => tab.id === activeTabId && setIsLoading(false)}
              onLoadProgress={({nativeEvent}) => tab.id === activeTabId && setProgress(nativeEvent.progress)}
              
              // CRITICAL: Allow popups for OAuth but handle them as in-app tabs
              setSupportMultipleWindows={true}
              onOpenWindow={handleOpenWindow}
              
              originWhitelist={['*']}
              onShouldStartLoadWithRequest={handleShouldStartLoad}
              onMessage={(e) => handleMessage(e, tab.id)}
              
              // Suppress "are you sure you want to leave" BEFORE page loads
              injectedJavaScriptBeforeContentLoaded={EARLY_INJECT_JS}
              injectedJavaScript={getInjectedScript(!!tab.isPopup)}
              
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
              
              renderLoading={() => (
                <View style={styles.loading}>
                  <ActivityIndicator size="large" color={APP_COLOR} />
                  <Text style={styles.loadingText}>{tab.isPopup ? 'Authenticating...' : `Loading ${APP_NAME}...`}</Text>
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
  tabPopup: {borderBottomWidth:2, borderBottomColor:'#20BEFF'},
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
  navBtnActive: {backgroundColor:'rgba(32,190,255,0.3)', borderWidth:1, borderColor:'#20BEFF'},
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
});
