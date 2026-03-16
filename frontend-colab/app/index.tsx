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
  Linking,
  ScrollView,
  useWindowDimensions,
  Modal,
  FlatList,
} from 'react-native';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

const APP_URL = 'https://colab.research.google.com/';
const APP_NAME = 'Google Colab';
const APP_COLOR = '#F9AB00';
const BACKGROUND_FETCH_TASK = 'colab-keep-alive';

if (Platform.OS !== 'web' && TaskManager) {
  TaskManager.defineTask(BACKGROUND_FETCH_TASK, async () => {
    try { return BackgroundFetch.BackgroundFetchResult.NewData; }
    catch (e) { return BackgroundFetch.BackgroundFetchResult.Failed; }
  });
}

const MOBILE_UA = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/125.0.0.0 Mobile Safari/537.36';
const DESKTOP_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36';

interface Tab { id: string; url: string; title: string; }
interface Bookmark { id: string; title: string; url: string; createdAt: number; }

export default function ColabApp() {
  const insets = useSafeAreaInsets();
  const webViewRefs = useRef<{ [key: string]: WebView | null }>({});
  
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

  useEffect(() => { loadBookmarks(); }, []);
  
  const loadBookmarks = async () => {
    try {
      const saved = await AsyncStorage.getItem('colab_bookmarks');
      if (saved) setBookmarks(JSON.parse(saved));
    } catch (e) {}
  };

  const saveBookmark = async () => {
    const bm: Bookmark = { id: Date.now().toString(), title: currentTitle, url: currentUrl, createdAt: Date.now() };
    const updated = [...bookmarks, bm];
    setBookmarks(updated);
    await AsyncStorage.setItem('colab_bookmarks', JSON.stringify(updated));
    Alert.alert('Saved!', 'Bookmark added');
  };

  const deleteBookmark = async (id: string) => {
    const updated = bookmarks.filter(b => b.id !== id);
    setBookmarks(updated);
    await AsyncStorage.setItem('colab_bookmarks', JSON.stringify(updated));
  };

  useEffect(() => {
    if (Platform.OS !== 'web' && keepAwake && activateKeepAwakeAsync) activateKeepAwakeAsync('colab');
    return () => { if (Platform.OS !== 'web' && deactivateKeepAwake) deactivateKeepAwake('colab'); };
  }, [keepAwake]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const handler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (canGoBack) { webViewRefs.current[activeTabId]?.goBack(); return true; }
      return false;
    });
    return () => handler.remove();
  }, [canGoBack, activeTabId]);

  const addTab = () => {
    const t: Tab = { id: Date.now().toString(), url: APP_URL, title: 'New Tab' };
    setTabs([...tabs, t]);
    setActiveTabId(t.id);
  };

  const closeTab = (id: string) => {
    if (tabs.length === 1) return;
    const newTabs = tabs.filter(t => t.id !== id);
    if (id === activeTabId) setActiveTabId(newTabs[0].id);
    setTabs(newTabs);
  };

  const goBack = () => webViewRefs.current[activeTabId]?.goBack();
  const goForward = () => webViewRefs.current[activeTabId]?.goForward();
  const reload = () => webViewRefs.current[activeTabId]?.reload();
  const goHome = () => webViewRefs.current[activeTabId]?.injectJavaScript(`window.location.href='${APP_URL}';true;`);

  const zoomIn = () => { const z = Math.min(zoomLevel + 25, 200); setZoomLevel(z); webViewRefs.current[activeTabId]?.injectJavaScript(`document.body.style.zoom='${z}%';true;`); };
  const zoomOut = () => { const z = Math.max(zoomLevel - 25, 50); setZoomLevel(z); webViewRefs.current[activeTabId]?.injectJavaScript(`document.body.style.zoom='${z}%';true;`); };
  const resetZoom = () => { setZoomLevel(100); webViewRefs.current[activeTabId]?.injectJavaScript(`document.body.style.zoom='100%';true;`); };

  const antiIdleScript = `
    (function() {
      let antiIdleTimeout;
      
      function safeActivity() {
        // SAFE actions only - no clicks, no key presses
        
        // 1. Mouse movement (safe)
        const x = Math.floor(Math.random() * window.innerWidth);
        const y = Math.floor(Math.random() * window.innerHeight);
        document.dispatchEvent(new MouseEvent('mousemove', {clientX: x, clientY: y, bubbles: true}));
        
        // 2. Small scroll (safe, -25 to +25 pixels)
        window.scrollBy({ top: Math.floor(Math.random() * 50) - 25, behavior: 'smooth' });
        
        // 3. Focus events (safe)
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('focus'));
        
        // 4. Mouseover on body (safe)
        document.body.dispatchEvent(new MouseEvent('mouseover', {clientX: x, clientY: y, bubbles: true}));
        
        console.log('[AntiIdle] Safe activity at ' + new Date().toLocaleTimeString());
        
        // Schedule next at random 30-90 seconds
        antiIdleTimeout = setTimeout(safeActivity, 30000 + Math.random() * 60000);
      }
      
      if(${antiIdle}) {
        setTimeout(safeActivity, 5000 + Math.random() * 10000);
        console.log('[AntiIdle] SAFE mode started');
      }
      
      var meta = document.querySelector('meta[name="viewport"]') || document.createElement('meta');
      meta.name = 'viewport';
      meta.content = ${desktopMode} ? 'width=1200,initial-scale=0.5,maximum-scale=3,user-scalable=yes' : 'width=device-width,initial-scale=1,maximum-scale=3,user-scalable=yes';
      if(!document.querySelector('meta[name="viewport"]')) document.head.appendChild(meta);
      window.onbeforeunload = null;
      true;
    })();
  `;

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

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" translucent />
      
      <View style={[styles.header, {paddingTop: topPadding}]}>
        <View style={styles.headerLeft}>
          <Ionicons name="logo-google" size={24} color={APP_COLOR} />
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

      <View style={styles.tabsBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{flex:1}}>
          {tabs.map(tab => (
            <TouchableOpacity key={tab.id} style={[styles.tab, tab.id === activeTabId && styles.tabActive]} onPress={() => setActiveTabId(tab.id)}>
              <Text style={[styles.tabText, tab.id === activeTabId && styles.tabTextActive]} numberOfLines={1}>{tab.title}</Text>
              {tabs.length > 1 && <TouchableOpacity onPress={() => closeTab(tab.id)} style={styles.tabClose}><Ionicons name="close" size={16} color="#888" /></TouchableOpacity>}
            </TouchableOpacity>
          ))}
        </ScrollView>
        <TouchableOpacity style={styles.addTab} onPress={addTab}><Ionicons name="add" size={24} color="#fff" /></TouchableOpacity>
      </View>

      {isLoading && <View style={styles.progressBar}><View style={[styles.progressFill, {width: `${progress*100}%`, backgroundColor: APP_COLOR}]} /></View>}

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
                  setTabs(prev => prev.map(t => t.id === tab.id ? {...t, title: nav.title || 'Tab', url: nav.url} : t));
                }
              }}
              onLoadStart={() => tab.id === activeTabId && setIsLoading(true)}
              onLoadEnd={() => tab.id === activeTabId && setIsLoading(false)}
              onLoadProgress={({nativeEvent}) => tab.id === activeTabId && setProgress(nativeEvent.progress)}
              injectedJavaScript={antiIdleScript}
              userAgent={desktopMode ? DESKTOP_UA : MOBILE_UA}
              javaScriptEnabled domStorageEnabled startInLoadingState allowsInlineMediaPlayback
              mixedContentMode="always" thirdPartyCookiesEnabled sharedCookiesEnabled cacheEnabled allowsBackForwardNavigationGestures
              renderLoading={() => <View style={styles.loading}><ActivityIndicator size="large" color={APP_COLOR} /><Text style={styles.loadingText}>Loading...</Text></View>}
            />
          </View>
        ))}
      </View>

      {showNavBar && (
        <View style={[styles.navBar, {paddingBottom: bottomPadding}]}>
          <TouchableOpacity style={[styles.navBtn, !canGoBack && styles.navBtnDisabled]} onPress={goBack} disabled={!canGoBack}><Ionicons name="chevron-back" size={24} color={canGoBack ? "#fff" : "#555"} /></TouchableOpacity>
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
            <TouchableOpacity style={styles.qItem} onPress={() => {Linking.openSettings(); setShowQuickActions(false);}}><Ionicons name="battery-charging" size={24} color="#4CAF50" /><Text style={styles.qText}>Battery Settings</Text></TouchableOpacity>
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
});
