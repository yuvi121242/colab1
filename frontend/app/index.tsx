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
  Image,
  useWindowDimensions,
  Modal,
  TextInput,
  FlatList,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
    description: 'Jupyter Notebooks',
  },
  kaggle: {
    name: 'Kaggle',
    url: 'https://www.kaggle.com/',
    color: '#20BEFF',
    icon: 'trophy',
    description: 'Data Science & ML',
  },
};

const BACKGROUND_FETCH_TASK = 'app-keep-alive-task';

if (Platform.OS !== 'web' && TaskManager) {
  TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
    try {
      return BackgroundFetch.BackgroundFetchResult.NewData;
    } catch (error) {
      return BackgroundFetch.BackgroundFetchResult.Failed;
    }
  });
}

const MOBILE_USER_AGENT = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';
const DESKTOP_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

type AppType = 'colab' | 'kaggle';

interface Bookmark {
  id: string;
  title: string;
  url: string;
  appType: AppType;
  createdAt: number;
}

interface Tab {
  id: string;
  url: string;
  title: string;
  isActive: boolean;
}

export default function MainApp() {
  const [selectedApp, setSelectedApp] = useState<AppType | null>(null);
  
  if (!selectedApp) {
    return <AppSelector onSelect={setSelectedApp} />;
  }
  
  return <WebViewApp appType={selectedApp} onBack={() => setSelectedApp(null)} />;
}

// App Selector Screen
function AppSelector({ onSelect }: { onSelect: (app: AppType) => void }) {
  const insets = useSafeAreaInsets();
  const statusBarHeight = Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 0;
  const topPadding = Math.max(insets.top, statusBarHeight, 24);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [showBookmarks, setShowBookmarks] = useState(false);

  useEffect(() => {
    loadBookmarks();
  }, []);

  const loadBookmarks = async () => {
    try {
      const saved = await AsyncStorage.getItem('bookmarks');
      if (saved) setBookmarks(JSON.parse(saved));
    } catch (e) {}
  };

  return (
    <View style={[styles.selectorContainer, { paddingTop: topPadding }]}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" translucent />
      
      <View style={styles.selectorHeader}>
        <Text style={styles.selectorTitle}>Choose Your App</Text>
        <TouchableOpacity onPress={() => setShowBookmarks(true)} style={styles.bookmarkBtn}>
          <Ionicons name="bookmarks" size={24} color="#F9AB00" />
          {bookmarks.length > 0 && (
            <View style={styles.bookmarkBadge}>
              <Text style={styles.bookmarkBadgeText}>{bookmarks.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
      
      <View style={styles.appCards}>
        <TouchableOpacity style={[styles.appCard, { borderColor: APPS.colab.color }]} onPress={() => onSelect('colab')}>
          <View style={[styles.appIconContainer, { backgroundColor: APPS.colab.color + '20' }]}>
            <Image source={require('../assets/images/colab_logo.png')} style={styles.appLogo} resizeMode="contain" />
          </View>
          <Text style={styles.appCardTitle}>{APPS.colab.name}</Text>
          <Text style={styles.appCardDesc}>{APPS.colab.description}</Text>
          <View style={[styles.openButton, { backgroundColor: APPS.colab.color }]}>
            <Text style={styles.openButtonText}>Open</Text>
            <Ionicons name="arrow-forward" size={18} color="#fff" />
          </View>
        </TouchableOpacity>
        
        <TouchableOpacity style={[styles.appCard, { borderColor: APPS.kaggle.color }]} onPress={() => onSelect('kaggle')}>
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
        {['Multi-tab browsing', 'Bookmarks & Favorites', 'Anti-idle (keeps notebooks running)', 'Zoom controls', 'Desktop mode'].map((f, i) => (
          <View key={i} style={styles.featureRow}>
            <Ionicons name="checkmark-circle" size={20} color="#4CAF50" />
            <Text style={styles.featureText}>{f}</Text>
          </View>
        ))}
      </View>

      {/* Bookmarks Modal */}
      <Modal visible={showBookmarks} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Saved Bookmarks</Text>
              <TouchableOpacity onPress={() => setShowBookmarks(false)}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>
            {bookmarks.length === 0 ? (
              <Text style={styles.emptyText}>No bookmarks yet. Save pages from Colab or Kaggle!</Text>
            ) : (
              <FlatList
                data={bookmarks}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity 
                    style={styles.bookmarkItem}
                    onPress={() => {
                      setShowBookmarks(false);
                      onSelect(item.appType);
                    }}
                  >
                    <Ionicons name={item.appType === 'colab' ? 'code-working' : 'trophy'} size={24} color={APPS[item.appType].color} />
                    <View style={styles.bookmarkInfo}>
                      <Text style={styles.bookmarkTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.bookmarkUrl} numberOfLines={1}>{item.url}</Text>
                    </View>
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

// WebView App with Tabs
function WebViewApp({ appType, onBack }: { appType: AppType; onBack: () => void }) {
  const app = APPS[appType];
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const webViewRefs = useRef<{ [key: string]: WebView | null }>({});
  
  // States
  const [tabs, setTabs] = useState<Tab[]>([{ id: '1', url: app.url, title: app.name, isActive: true }]);
  const [activeTabId, setActiveTabId] = useState('1');
  const [canGoBack, setCanGoBack] = useState(false);
  const [canGoForward, setCanGoForward] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [showNavBar, setShowNavBar] = useState(true);
  const [keepAwakeEnabled, setKeepAwakeEnabled] = useState(true);
  const [progress, setProgress] = useState(0);
  const [desktopMode, setDesktopMode] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(100);
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showBookmarkModal, setShowBookmarkModal] = useState(false);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [currentUrl, setCurrentUrl] = useState(app.url);
  const [currentTitle, setCurrentTitle] = useState(app.name);
  const [antiIdleEnabled, setAntiIdleEnabled] = useState(true);

  const statusBarHeight = Platform.OS === 'android' ? StatusBar.currentHeight || 24 : 0;
  const topPadding = Math.max(insets.top, statusBarHeight, 24);
  const bottomPadding = Math.max(insets.bottom, 10);

  // Load bookmarks
  useEffect(() => {
    loadBookmarks();
  }, []);

  const loadBookmarks = async () => {
    try {
      const saved = await AsyncStorage.getItem('bookmarks');
      if (saved) setBookmarks(JSON.parse(saved));
    } catch (e) {}
  };

  const saveBookmark = async () => {
    const newBookmark: Bookmark = {
      id: Date.now().toString(),
      title: currentTitle || 'Untitled',
      url: currentUrl,
      appType,
      createdAt: Date.now(),
    };
    const updated = [...bookmarks, newBookmark];
    setBookmarks(updated);
    await AsyncStorage.setItem('bookmarks', JSON.stringify(updated));
    Alert.alert('Saved!', 'Bookmark added successfully');
  };

  const deleteBookmark = async (id: string) => {
    const updated = bookmarks.filter(b => b.id !== id);
    setBookmarks(updated);
    await AsyncStorage.setItem('bookmarks', JSON.stringify(updated));
  };

  // Background task & keep awake
  useEffect(() => {
    if (Platform.OS !== 'web' && keepAwakeEnabled && activateKeepAwakeAsync) {
      activateKeepAwakeAsync('app-session');
    }
    return () => {
      if (Platform.OS !== 'web' && deactivateKeepAwake) deactivateKeepAwake('app-session');
    };
  }, [keepAwakeEnabled]);

  // Android back button
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) {
        webViewRefs.current[activeTabId]?.goBack();
        return true;
      }
      return false;
    });
    return () => backHandler.remove();
  }, [canGoBack, activeTabId]);

  // Tab management
  const addTab = () => {
    const newTab: Tab = {
      id: Date.now().toString(),
      url: app.url,
      title: 'New Tab',
      isActive: true,
    };
    setTabs(prev => prev.map(t => ({ ...t, isActive: false })).concat(newTab));
    setActiveTabId(newTab.id);
  };

  const closeTab = (tabId: string) => {
    if (tabs.length === 1) return;
    const newTabs = tabs.filter(t => t.id !== tabId);
    if (tabId === activeTabId) {
      setActiveTabId(newTabs[0].id);
    }
    setTabs(newTabs);
  };

  const switchTab = (tabId: string) => {
    setActiveTabId(tabId);
    setTabs(prev => prev.map(t => ({ ...t, isActive: t.id === tabId })));
  };

  // Navigation functions
  const goBack = () => webViewRefs.current[activeTabId]?.goBack();
  const goForward = () => webViewRefs.current[activeTabId]?.goForward();
  const reload = () => webViewRefs.current[activeTabId]?.reload();
  const goHome = () => webViewRefs.current[activeTabId]?.injectJavaScript(`window.location.href = '${app.url}'; true;`);

  // Zoom functions
  const zoomIn = () => {
    const newZoom = Math.min(zoomLevel + 25, 200);
    setZoomLevel(newZoom);
    webViewRefs.current[activeTabId]?.injectJavaScript(`document.body.style.zoom = '${newZoom}%'; true;`);
  };

  const zoomOut = () => {
    const newZoom = Math.max(zoomLevel - 25, 50);
    setZoomLevel(newZoom);
    webViewRefs.current[activeTabId]?.injectJavaScript(`document.body.style.zoom = '${newZoom}%'; true;`);
  };

  const resetZoom = () => {
    setZoomLevel(100);
    webViewRefs.current[activeTabId]?.injectJavaScript(`document.body.style.zoom = '100%'; true;`);
  };

  const toggleDesktopMode = () => {
    setDesktopMode(!desktopMode);
    reload();
  };

  const toggleKeepAwake = () => {
    if (keepAwakeEnabled && deactivateKeepAwake) deactivateKeepAwake('app-session');
    else if (activateKeepAwakeAsync) activateKeepAwakeAsync('app-session');
    setKeepAwakeEnabled(!keepAwakeEnabled);
  };

  const openBatterySettings = () => {
    if (Platform.OS === 'android') {
      Alert.alert('Keep App Running', 'Go to Settings > Battery > Unrestricted', [
        { text: 'Later' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
    }
  };

  // Anti-idle script - SAFE version (no clicks, no key presses)
  const antiIdleScript = `
    (function() {
      let antiIdleInterval;
      let lastScrollY = 0;
      
      function safeSimulateActivity() {
        // Only safe actions - no clicks, no key presses
        
        // 1. Mouse movement simulation (completely safe)
        const mouseX = Math.floor(Math.random() * window.innerWidth);
        const mouseY = Math.floor(Math.random() * window.innerHeight);
        const moveEvent = new MouseEvent('mousemove', {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: mouseX,
          clientY: mouseY
        });
        document.dispatchEvent(moveEvent);
        
        // 2. Small random scroll (up or down, very small amount)
        const scrollAmount = Math.floor(Math.random() * 50) - 25; // -25 to +25 pixels
        window.scrollBy({ top: scrollAmount, behavior: 'smooth' });
        
        // 3. Focus events (safe, just tells page we're active)
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('focus'));
        
        // 4. Mouseover on body (safe, doesn't click anything)
        const overEvent = new MouseEvent('mouseover', {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: mouseX,
          clientY: mouseY
        });
        document.body.dispatchEvent(overEvent);
        
        // 5. Touch simulation for mobile detection (safe)
        if ('ontouchstart' in window) {
          const touchEvent = new TouchEvent('touchstart', {
            bubbles: true,
            cancelable: true,
            view: window
          });
          try { document.body.dispatchEvent(touchEvent); } catch(e) {}
        }
        
        // Log activity (visible in browser console)
        console.log('[AntiIdle] Safe activity simulated at ' + new Date().toLocaleTimeString() + ' - Mouse: ' + mouseX + ',' + mouseY + ' Scroll: ' + scrollAmount + 'px');
      }
      
      function startAntiIdle() {
        if (antiIdleInterval) clearInterval(antiIdleInterval);
        
        // Random interval between 30-90 seconds
        const runActivity = () => {
          safeSimulateActivity();
          // Schedule next activity at random interval (30-90 seconds)
          const nextInterval = 30000 + Math.floor(Math.random() * 60000);
          antiIdleInterval = setTimeout(runActivity, nextInterval);
        };
        
        // Start first activity after random delay (5-15 seconds)
        setTimeout(runActivity, 5000 + Math.random() * 10000);
        console.log('[AntiIdle] Started - SAFE mode (no clicks/keypresses)');
      }
      
      // Start if enabled
      if (${antiIdleEnabled}) {
        startAntiIdle();
      }
      
      // Viewport setup
      var meta = document.querySelector('meta[name="viewport"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.name = 'viewport';
        document.getElementsByTagName('head')[0].appendChild(meta);
      }
      meta.content = ${desktopMode} 
        ? 'width=1200, initial-scale=0.5, maximum-scale=3.0, user-scalable=yes'
        : 'width=device-width, initial-scale=1.0, maximum-scale=3.0, user-scalable=yes';
      
      // Prevent beforeunload prompts
      window.onbeforeunload = null;
      
      true;
    })();
  `;

  const currentUserAgent = desktopMode ? DESKTOP_USER_AGENT : MOBILE_USER_AGENT;

  // Web fallback
  if (Platform.OS === 'web') {
    return (
      <View style={[styles.container, { paddingTop: topPadding }]}>
        <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" translucent />
        <View style={styles.header}>
          <TouchableOpacity onPress={onBack} style={styles.backButton}>
            <Ionicons name="arrow-back" size={24} color="#fff" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>{app.name}</Text>
        </View>
        <View style={styles.webFallback}>
          <Ionicons name={app.icon as any} size={80} color={app.color} />
          <Text style={styles.appTitle}>Use Expo Go on your phone!</Text>
          <TouchableOpacity style={[styles.openBtn, { backgroundColor: app.color }]} onPress={() => Linking.openURL(app.url)}>
            <Text style={styles.openBtnText}>Open in Browser</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" translucent />
      
      {/* Header */}
      <View style={[styles.header, { paddingTop: topPadding }]}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Ionicons name="apps" size={22} color="#fff" />
        </TouchableOpacity>
        <View style={styles.headerLeft}>
          <Ionicons name={app.icon as any} size={20} color={app.color} />
          <Text style={styles.headerTitle} numberOfLines={1}>{app.name}</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerBtn} onPress={() => setAntiIdleEnabled(!antiIdleEnabled)}>
            <Ionicons name={antiIdleEnabled ? "shield-checkmark" : "shield-outline"} size={20} color={antiIdleEnabled ? "#4CAF50" : "#888"} />
          </TouchableOpacity>
          <TouchableOpacity style={[styles.headerBtn, keepAwakeEnabled && styles.headerBtnActive]} onPress={toggleKeepAwake}>
            <Ionicons name="flash" size={20} color={keepAwakeEnabled ? "#4CAF50" : "#888"} />
          </TouchableOpacity>
        </View>
      </View>

      {/* Tabs Bar */}
      <View style={styles.tabsBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabsScroll}>
          {tabs.map(tab => (
            <TouchableOpacity
              key={tab.id}
              style={[styles.tab, tab.id === activeTabId && styles.tabActive]}
              onPress={() => switchTab(tab.id)}
            >
              <Text style={[styles.tabText, tab.id === activeTabId && styles.tabTextActive]} numberOfLines={1}>
                {tab.title}
              </Text>
              {tabs.length > 1 && (
                <TouchableOpacity onPress={() => closeTab(tab.id)} style={styles.tabClose}>
                  <Ionicons name="close" size={16} color="#888" />
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.addTabBtn} onPress={addTab}>
          <Ionicons name="add" size={24} color="#fff" />
        </TouchableOpacity>
      </View>

      {/* Progress Bar */}
      {isLoading && (
        <View style={styles.progressContainer}>
          <View style={[styles.progressBar, { width: `${progress * 100}%`, backgroundColor: app.color }]} />
        </View>
      )}

      {/* WebViews */}
      <View style={styles.webViewContainer}>
        {tabs.map(tab => (
          <View key={tab.id} style={[styles.webViewWrapper, { display: tab.id === activeTabId ? 'flex' : 'none' }]}>
            <WebView
              ref={ref => webViewRefs.current[tab.id] = ref}
              source={{ uri: tab.url }}
              style={styles.webView}
              onNavigationStateChange={(navState) => {
                if (tab.id === activeTabId) {
                  setCanGoBack(navState.canGoBack);
                  setCanGoForward(navState.canGoForward);
                  setCurrentUrl(navState.url);
                  setCurrentTitle(navState.title || app.name);
                  setTabs(prev => prev.map(t => t.id === tab.id ? { ...t, title: navState.title || 'Tab', url: navState.url } : t));
                }
              }}
              onLoadStart={() => tab.id === activeTabId && setIsLoading(true)}
              onLoadEnd={() => tab.id === activeTabId && setIsLoading(false)}
              onLoadProgress={({ nativeEvent }) => tab.id === activeTabId && setProgress(nativeEvent.progress)}
              injectedJavaScript={antiIdleScript}
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
                  <ActivityIndicator size="large" color={app.color} />
                  <Text style={styles.loadingText}>Loading...</Text>
                </View>
              )}
            />
          </View>
        ))}
      </View>

      {/* Navigation Bar */}
      {showNavBar && (
        <View style={[styles.navBar, { paddingBottom: bottomPadding }]}>
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
            <Ionicons name={desktopMode ? "desktop" : "phone-portrait"} size={22} color={desktopMode ? app.color : "#fff"} />
          </TouchableOpacity>
          <TouchableOpacity style={styles.navButton} onPress={() => setShowNavBar(false)}>
            <Ionicons name="chevron-down" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      )}

      {/* Floating Action Button */}
      <TouchableOpacity 
        style={[styles.fab, { backgroundColor: app.color, bottom: showNavBar ? bottomPadding + 80 : bottomPadding + 20 }]}
        onPress={() => setShowQuickActions(true)}
      >
        <Ionicons name="menu" size={24} color="#fff" />
      </TouchableOpacity>

      {/* Quick Actions Modal */}
      <Modal visible={showQuickActions} transparent animationType="fade">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShowQuickActions(false)}>
          <View style={[styles.quickActionsMenu, { bottom: showNavBar ? bottomPadding + 140 : bottomPadding + 80 }]}>
            <TouchableOpacity style={styles.quickAction} onPress={() => { saveBookmark(); setShowQuickActions(false); }}>
              <Ionicons name="bookmark" size={24} color="#F9AB00" />
              <Text style={styles.quickActionText}>Save Bookmark</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickAction} onPress={() => { setShowBookmarkModal(true); setShowQuickActions(false); }}>
              <Ionicons name="bookmarks" size={24} color="#20BEFF" />
              <Text style={styles.quickActionText}>View Bookmarks</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickAction} onPress={() => { zoomIn(); setShowQuickActions(false); }}>
              <Ionicons name="add-circle" size={24} color="#4CAF50" />
              <Text style={styles.quickActionText}>Zoom In ({zoomLevel}%)</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickAction} onPress={() => { zoomOut(); setShowQuickActions(false); }}>
              <Ionicons name="remove-circle" size={24} color="#FF5722" />
              <Text style={styles.quickActionText}>Zoom Out</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickAction} onPress={() => { resetZoom(); setShowQuickActions(false); }}>
              <Ionicons name="resize" size={24} color="#9C27B0" />
              <Text style={styles.quickActionText}>Reset Zoom</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickAction} onPress={() => { openBatterySettings(); setShowQuickActions(false); }}>
              <Ionicons name="battery-charging" size={24} color="#4CAF50" />
              <Text style={styles.quickActionText}>Battery Settings</Text>
            </TouchableOpacity>
            {!showNavBar && (
              <TouchableOpacity style={styles.quickAction} onPress={() => { setShowNavBar(true); setShowQuickActions(false); }}>
                <Ionicons name="chevron-up" size={24} color="#fff" />
                <Text style={styles.quickActionText}>Show Nav Bar</Text>
              </TouchableOpacity>
            )}
          </View>
        </TouchableOpacity>
      </Modal>

      {/* Bookmarks Modal */}
      <Modal visible={showBookmarkModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Bookmarks</Text>
              <TouchableOpacity onPress={() => setShowBookmarkModal(false)}>
                <Ionicons name="close" size={28} color="#fff" />
              </TouchableOpacity>
            </View>
            {bookmarks.filter(b => b.appType === appType).length === 0 ? (
              <Text style={styles.emptyText}>No bookmarks for {app.name} yet!</Text>
            ) : (
              <FlatList
                data={bookmarks.filter(b => b.appType === appType)}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <View style={styles.bookmarkItem}>
                    <TouchableOpacity 
                      style={styles.bookmarkContent}
                      onPress={() => {
                        webViewRefs.current[activeTabId]?.injectJavaScript(`window.location.href = '${item.url}'; true;`);
                        setShowBookmarkModal(false);
                      }}
                    >
                      <Text style={styles.bookmarkTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.bookmarkUrl} numberOfLines={1}>{item.url}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => deleteBookmark(item.id)}>
                      <Ionicons name="trash" size={20} color="#FF5722" />
                    </TouchableOpacity>
                  </View>
                )}
              />
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  // Selector styles
  selectorContainer: { flex: 1, backgroundColor: '#1a1a2e' },
  selectorHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 20 },
  selectorTitle: { color: '#fff', fontSize: 28, fontWeight: '700' },
  bookmarkBtn: { position: 'relative', padding: 8 },
  bookmarkBadge: { position: 'absolute', top: 0, right: 0, backgroundColor: '#FF5722', borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center' },
  bookmarkBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  appCards: { flexDirection: 'row', paddingHorizontal: 16, gap: 12 },
  appCard: { flex: 1, backgroundColor: '#2d2d44', borderRadius: 16, padding: 20, alignItems: 'center', borderWidth: 2 },
  appIconContainer: { width: 80, height: 80, borderRadius: 40, justifyContent: 'center', alignItems: 'center', marginBottom: 12 },
  appLogo: { width: 50, height: 50 },
  appCardTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  appCardDesc: { color: '#888', fontSize: 12, textAlign: 'center', marginBottom: 16 },
  openButton: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 20, gap: 6 },
  openButtonText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  featuresBox: { margin: 16, backgroundColor: '#2d2d44', borderRadius: 16, padding: 20 },
  featuresTitle: { color: '#fff', fontSize: 18, fontWeight: '600', marginBottom: 16 },
  featureRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12, gap: 10 },
  featureText: { color: '#ccc', fontSize: 14 },

  // App styles
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 8, backgroundColor: '#1a1a2e', borderBottomWidth: 1, borderBottomColor: '#2d2d44' },
  backButton: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#2d2d44', justifyContent: 'center', alignItems: 'center', marginRight: 8 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: '700', marginLeft: 8 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headerBtn: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#2d2d44', justifyContent: 'center', alignItems: 'center' },
  headerBtnActive: { backgroundColor: 'rgba(76, 175, 80, 0.2)' },

  // Tabs
  tabsBar: { flexDirection: 'row', backgroundColor: '#252538', borderBottomWidth: 1, borderBottomColor: '#2d2d44' },
  tabsScroll: { flex: 1 },
  tab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRightWidth: 1, borderRightColor: '#2d2d44', maxWidth: 150 },
  tabActive: { backgroundColor: '#1a1a2e' },
  tabText: { color: '#888', fontSize: 13, flex: 1 },
  tabTextActive: { color: '#fff' },
  tabClose: { marginLeft: 8, padding: 2 },
  addTabBtn: { paddingHorizontal: 16, justifyContent: 'center', alignItems: 'center' },

  // WebView
  webViewContainer: { flex: 1, backgroundColor: '#fff' },
  webViewWrapper: { flex: 1 },
  webView: { flex: 1 },
  loadingContainer: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#fff', marginTop: 12, fontSize: 16 },
  progressContainer: { height: 2, backgroundColor: '#2d2d44' },
  progressBar: { height: '100%' },

  // Navigation
  navBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 10, paddingHorizontal: 12, backgroundColor: '#1a1a2e', borderTopWidth: 1, borderTopColor: '#2d2d44' },
  navButton: { width: 46, height: 46, borderRadius: 23, backgroundColor: '#2d2d44', justifyContent: 'center', alignItems: 'center' },
  navButtonDisabled: { backgroundColor: '#1f1f30' },
  navButtonActive: { backgroundColor: 'rgba(249, 171, 0, 0.3)', borderWidth: 1, borderColor: '#F9AB00' },

  // FAB
  fab: { position: 'absolute', right: 20, width: 56, height: 56, borderRadius: 28, justifyContent: 'center', alignItems: 'center', elevation: 8, shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.3, shadowRadius: 4 },

  // Quick Actions
  quickActionsMenu: { position: 'absolute', right: 20, backgroundColor: '#2d2d44', borderRadius: 16, padding: 8, minWidth: 200 },
  quickAction: { flexDirection: 'row', alignItems: 'center', padding: 14, gap: 12 },
  quickActionText: { color: '#fff', fontSize: 14 },

  // Modals
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { width: '90%', maxHeight: '70%', backgroundColor: '#2d2d44', borderRadius: 16, padding: 20 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: '700' },
  emptyText: { color: '#888', fontSize: 14, textAlign: 'center', paddingVertical: 40 },
  bookmarkItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#3d3d54' },
  bookmarkContent: { flex: 1 },
  bookmarkInfo: { flex: 1, marginLeft: 12 },
  bookmarkTitle: { color: '#fff', fontSize: 14, fontWeight: '600' },
  bookmarkUrl: { color: '#888', fontSize: 12, marginTop: 4 },

  // Web fallback
  webFallback: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  appTitle: { color: '#fff', fontSize: 24, fontWeight: '700', marginTop: 20, marginBottom: 20 },
  openBtn: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 12 },
  openBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});
