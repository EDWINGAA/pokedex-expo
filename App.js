import 'react-native-gesture-handler';
import React, { useEffect, useMemo, useState, useCallback, useContext, createContext } from 'react';
import {
  View, Text, StyleSheet, FlatList, Image, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl, SafeAreaView, Dimensions, Platform, Alert, KeyboardAvoidingView, ScrollView
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ⬇️ Firebase
import { auth, db } from './firebase';
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  updateProfile,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  onSnapshot,
  collection,
  deleteDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';

const Stack = createNativeStackNavigator();

// ===== Config / APIs =====
const RAWG_API = 'https://api.rawg.io/api';
const RAWG_KEY = '5eee14f8e4454a299c2e8110d7c8589f';

// ===== Layout helpers =====
const { width: SCREEN_W } = Dimensions.get('window');
const H_PADDING = 12;
const GAP = 12;
const COLS = 2;
const CARD_W = Math.floor((SCREEN_W - H_PADDING * 2 - GAP * (COLS - 1)) / COLS);
const CARD_H = 290;

const pad3 = (n) => `#${String(n).padStart(3, '0')}`;

const PALETTE = [
  ['#2b1055', '#7597de'],
  ['#ff9966', '#ff5e62'],
  ['#7F7FD5', '#86A8E7'],
  ['#00c6ff', '#0072ff'],
  ['#43cea2', '#185a9d'],
  ['#4568dc', '#b06ab3'],
];
const gradientById = (id) => PALETTE[id % PALETTE.length];

// ====== PRICING helpers ======
function pseudoRand(n) {
  let x = Math.sin(n) * 10000;
  return x - Math.floor(x);
}
function basePriceFor(id) {
  const p = 14.99 + Math.floor(pseudoRand(id) * 60);
  return parseFloat((p + 0.99).toFixed(2));
}
function saleFor(id) {
  const r = pseudoRand(id * 3.7);
  if (r < 0.35) {
    const pct = 10 + Math.floor(pseudoRand(id * 9.1) * 50); // 10..59
    return pct;
  }
  return null;
}
function priceWithSale(base, pct) {
  return parseFloat((base * (1 - pct / 100)).toFixed(2));
}

/** ======================
 *       AUTH CONTEXT (Firebase)
 *  ====================== */
const AuthContext = createContext(null);
function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}
function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (fbUser) => {
      if (!fbUser) {
        setUser(null);
        setBooting(false);
        return;
      }
      const profile = {
        uid: fbUser.uid,
        email: fbUser.email,
        name: fbUser.displayName || (fbUser.email ? fbUser.email.split('@')[0] : 'Usuario'),
      };
      setUser(profile);
      setBooting(false);
    });
    return unsub;
  }, []);

  const register = async (name, email, password) => {
    const cred = await createUserWithEmailAndPassword(auth, email, password);
    if (name) await updateProfile(cred.user, { displayName: name });
    await setDoc(doc(db, 'users', cred.user.uid), {
      email,
      name: name || email.split('@')[0],
      createdAt: serverTimestamp(),
    }, { merge: true });
  };

  const login = async (email, password) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const logout = async () => {
    await signOut(auth);
  };

  return (
    <AuthContext.Provider value={{ user, register, login, logout, booting }}>
      {children}
    </AuthContext.Provider>
  );
}

/** =========================
 *     FAVORITOS CONTEXT (Firestore + local fallback)
 *  ========================= */
const FavoritesContext = createContext(null);
const FAVORITES_KEY = 'FAVORITES_GAMES_V1';

function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error('useFavorites debe usarse dentro de FavoritesProvider');
  return ctx;
}
function gameToDoc(g) {
  return {
    id: g.id,
    name: g.name,
    image: g.image,
    metacritic: g.metacritic ?? null,
    released: g.released ?? null,
    price: g.price,
    salePct: g.salePct ?? null,
    finalPrice: g.finalPrice,
  };
}
function FavoritesProvider({ children }) {
  const { user } = useAuth();
  const [favorites, setFavorites] = useState([]);

  // Sin sesión: cargar/guardar en AsyncStorage
  useEffect(() => {
    if (user) return;
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(FAVORITES_KEY);
        setFavorites(raw ? JSON.parse(raw) : []);
      } catch {
        setFavorites([]);
      }
    })();
  }, [user]);

  useEffect(() => {
    if (user) return;
    AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)).catch(() => {});
  }, [favorites, user]);

  // Con sesión: escuchar Firestore
  useEffect(() => {
    if (!user) return;
    const colRef = collection(db, 'users', user.uid, 'favorites');
    const unsub = onSnapshot(colRef, (snap) => {
      const arr = snap.docs.map((d) => d.data());
      setFavorites(arr);
    });
    return unsub;
  }, [user?.uid]);

  // Migrar locales → Firestore al iniciar sesión
  useEffect(() => {
    (async () => {
      if (!user) return;
      const raw = await AsyncStorage.getItem(FAVORITES_KEY);
      if (!raw) return;
      const localFavs = JSON.parse(raw);
      await Promise.all(
        localFavs.map((g) =>
          setDoc(
            doc(db, 'users', user.uid, 'favorites', String(g.id)),
            { ...gameToDoc(g), addedAt: serverTimestamp() },
            { merge: true }
          )
        )
      );
      await AsyncStorage.removeItem(FAVORITES_KEY);
    })();
  }, [user?.uid]);

  const isFavorite = (id) => favorites.some((f) => f.id === id);

  const toggleFavorite = async (game) => {
    if (!user) {
      setFavorites((prev) => {
        const exists = prev.some((g) => g.id === game.id);
        if (exists) return prev.filter((g) => g.id !== game.id);
        return [...prev, gameToDoc(game)];
      });
      return;
    }
    const ref = doc(db, 'users', user.uid, 'favorites', String(game.id));
    if (isFavorite(game.id)) {
      await deleteDoc(ref);
    } else {
      await setDoc(ref, { ...gameToDoc(game), addedAt: serverTimestamp() });
    }
  };

  const removeFavorite = async (id) => {
    if (!user) {
      setFavorites((prev) => prev.filter((g) => g.id !== id));
      return;
    }
    await deleteDoc(doc(db, 'users', user.uid, 'favorites', String(id)));
  };

  return (
    <FavoritesContext.Provider value={{ favorites, isFavorite, toggleFavorite, removeFavorite }}>
      {children}
    </FavoritesContext.Provider>
  );
}

/** ======================
 *        HOME
 *  ====================== */
function HomeScreen({ navigation }) {
  const [all, setAll] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [showOffers, setShowOffers] = useState(false);

  const { isFavorite, toggleFavorite } = useFavorites();
  const { user } = useAuth();

  const fetchGames = async (searchText = '') => {
    setError(null);
    try {
      const params = new URLSearchParams({
        key: RAWG_KEY,
        page_size: '60',
        ordering: '-metacritic',
      });
      if (searchText.trim()) params.set('search', searchText.trim());

      const res = await fetch(`${RAWG_API}/games?${params.toString()}`);
      if (!res.ok) throw new Error('No se pudo obtener la lista');
      const json = await res.json();

      const mapped = (json.results || []).map((g) => {
        const price = basePriceFor(g.id);
        const off = saleFor(g.id);
        const final = off ? priceWithSale(price, off) : price;
        return {
          id: g.id,
          name: g.name,
          image: g.background_image,
          metacritic: g.metacritic,
          released: g.released,
          price,
          salePct: off,
          finalPrice: final,
        };
      });
      setAll(mapped);
    } catch (e) {
      setError(e.message || 'Error de red');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchGames(); }, []);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchGames(query);
    setRefreshing(false);
  }, [query]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let arr = all;
    if (q) arr = arr.filter((g) => g.name.toLowerCase().includes(q) || String(g.id) === q);
    if (showOffers) arr = arr.filter((g) => g.salePct && g.salePct > 0);
    return arr;
  }, [all, query, showOffers]);

  const handleBuy = (game) => {
    if (!user) {
      Alert.alert(
        'Necesitas iniciar sesión',
        'Para comprar debes iniciar sesión.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Iniciar sesión', onPress: () => navigation.navigate('Login') },
        ]
      );
      return;
    }
    Alert.alert(
      'Comprar en ENEBO',
      `${game.name}\n\nPrecio: $${game.finalPrice.toFixed(2)} USD`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: async () => {
            try {
              await addDoc(collection(db, 'users', user.uid, 'purchases'), {
                gameId: game.id,
                name: game.name,
                price: game.finalPrice,
                meta: {
                  metacritic: game.metacritic ?? null,
                  released: game.released ?? null,
                },
                purchasedAt: serverTimestamp(),
              });
              Alert.alert('¡Listo!', `Gracias ${user.name} 😄`);
            } catch (e) {
              Alert.alert('Error', 'No se pudo registrar la compra');
            }
          }
        },
      ]
    );
  };

  const renderItem = ({ item }) => {
    const [c1, c2] = gradientById(item.id);
    const fav = isFavorite(item.id);

    return (
      <TouchableOpacity
        activeOpacity={0.9}
        onPress={() => navigation.navigate('Details', { id: item.id, name: item.name })}
        style={{ width: CARD_W }}
      >
        <View style={styles.card}>
          <LinearGradient colors={[c1, c2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardBanner}>
            <View style={styles.metacriticPill}>
              <MaterialCommunityIcons name="star-circle" size={14} color="#fff" />
              <Text style={styles.metacriticTxt}>{item.metacritic ?? '—'}</Text>
            </View>

            {item.salePct ? (
              <View style={styles.offerPill}>
                <MaterialCommunityIcons name="tag" size={12} color="#10b981" />
                <Text style={styles.offerTxt}>-{item.salePct}%</Text>
              </View>
            ) : null}

            <Text style={styles.cardId}>{pad3(item.id)}</Text>
          </LinearGradient>

          <View>
            <Image source={{ uri: item.image }} style={styles.cardImage} resizeMode="cover" />
            {/* Botón corazón */}
            <TouchableOpacity onPress={() => toggleFavorite(item)} activeOpacity={0.8} style={styles.heartBtn}>
              <MaterialCommunityIcons
                name={fav ? 'heart' : 'heart-outline'}
                size={20}
                color={fav ? '#ef4444' : '#e5e7eb'}
              />
            </TouchableOpacity>
          </View>

          <View style={styles.cardInfo}>
            <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.cardReleased} numberOfLines={1}>{item.released || '—'}</Text>

            <View style={styles.priceRow}>
              {item.salePct ? (
                <>
                  <Text style={styles.priceStriked}>${item.price.toFixed(2)}</Text>
                  <Text style={styles.priceFinal}>${item.finalPrice.toFixed(2)}</Text>
                </>
              ) : (
                <Text style={styles.priceFinal}>${item.finalPrice.toFixed(2)}</Text>
              )}
            </View>

            <TouchableOpacity style={styles.buyBtn} onPress={() => handleBuy(item)}>
              <MaterialCommunityIcons name="cart" size={16} color="#0b0b0e" />
              <Text style={styles.buyTxt}>Comprar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  const favCount = useFavorites().favorites.length;

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <HomeHeader navigation={navigation} showOffers={showOffers} onToggleOffers={() => setShowOffers((s) => !s)} favCount={favCount} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" />
          <Text style={{ marginTop: 12, color: '#bbb' }}>Cargando juegos…</Text>
        </View>
        <StatusBar style="light" />
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <HomeHeader navigation={navigation} showOffers={showOffers} onToggleOffers={() => setShowOffers((s) => !s)} favCount={favCount} />
        <View style={{ padding: 16 }}>
          <Text style={{ color: '#ff7b7b', fontWeight: '700', marginBottom: 8 }}>Error: {error}</Text>
          <TouchableOpacity onPress={() => fetchGames(query)} style={styles.retryBtn}>
            <Text style={styles.retryTxt}>Reintentar</Text>
          </TouchableOpacity>
        </View>
        <StatusBar style="light" />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <HomeHeader navigation={navigation} showOffers={showOffers} onToggleOffers={() => setShowOffers((s) => !s)} favCount={favCount} />

      <View style={styles.searchWrap}>
        <MaterialCommunityIcons name="magnify" size={20} color="#98a2b3" style={{ marginRight: 8 }} />
        <TextInput
          placeholder="Buscar juegos (ej. Elden Ring, Hades, GTA)"
          placeholderTextColor="#98a2b3"
          value={query}
          onChangeText={(t) => { setQuery(t); fetchGames(t); }}
          style={styles.search}
          autoCapitalize="none"
          autoCorrect={false}
          clearButtonMode="while-editing"
          returnKeyType="search"
        />
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(item) => String(item.id)}
        numColumns={COLS}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: H_PADDING }}
        contentContainerStyle={{ paddingBottom: 24, paddingTop: 8, gap: GAP }}
        renderItem={renderItem}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <View style={{ padding: 24, alignItems: 'center' }}>
            <Text style={{ color: '#98a2b3' }}>
              {showOffers ? 'No hay ofertas disponibles ahora.' : 'No se encontraron resultados.'}
            </Text>
          </View>
        }
      />
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

/** ======================
 *        HEADER
 *  ====================== */
function HomeHeader({ showOffers, onToggleOffers, navigation, favCount = 0 }) {
  const { user, logout } = useAuth();

  const onPressAccount = () => {
    if (!user) {
      navigation.navigate('Login');
    } else {
      Alert.alert(
        'Cuenta',
        `${user.email}`,
        [
          { text: 'Cerrar sesión', style: 'destructive', onPress: logout },
          { text: 'Cancelar', style: 'cancel' },
        ]
      );
    }
  };

  return (
    <LinearGradient colors={['#0f0c29', '#302b63', '#24243e']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.headerGrad}>
      <View style={styles.headerLeft}>
        <View style={styles.logoCircle}>
          <MaterialCommunityIcons name="controller-classic" size={22} color="#fff" />
        </View>
        <Text style={styles.brandTitle}>ENEBO</Text>
      </View>

      <View style={styles.headerRight}>
        <TouchableOpacity
          activeOpacity={0.9}
          onPress={onToggleOffers}
          style={[styles.tag, showOffers && { backgroundColor: '#22c55e22', borderColor: '#22c55e66' }]}
        >
          <MaterialCommunityIcons name="tag-multiple" size={14} color={showOffers ? '#22c55e' : '#fff'} />
          <Text style={[styles.tagTxt, showOffers && { color: '#22c55e' }]}>Ofertas</Text>
        </TouchableOpacity>

        {/* Login/Cuenta */}
        <TouchableOpacity activeOpacity={0.9} style={styles.tag} onPress={onPressAccount}>
          <MaterialCommunityIcons name="account" size={16} color="#fff" />
          <Text style={styles.tagTxt}>{user ? 'Cuenta' : 'Entrar'}</Text>
        </TouchableOpacity>

        {/* Favoritos */}
        <TouchableOpacity activeOpacity={0.9} style={styles.favHeaderBtn} onPress={() => navigation.navigate('Favorites')}>
          <MaterialCommunityIcons name="heart" size={18} color="#fff" />
          {favCount > 0 && (
            <View style={styles.favBadge}>
              <Text style={styles.favBadgeTxt}>{favCount > 99 ? '99+' : favCount}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

/** ======================
 *       DETAILS
 *  ====================== */
function DetailsScreen({ route, navigation }) {
  const { id, name } = route.params;
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  const price = basePriceFor(id);
  const off = saleFor(id);
  const finalPrice = off ? priceWithSale(price, off) : price;

  const { isFavorite, toggleFavorite } = useFavorites();
  const { user } = useAuth();
  const fav = isFavorite(id);

  const handleBuy = () => {
    if (!user) {
      Alert.alert(
        'Necesitas iniciar sesión',
        'Para comprar debes iniciar sesión.',
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Iniciar sesión', onPress: () => navigation.navigate('Login') },
        ]
      );
      return;
    }
    const compactGame = {
      id, name,
      metacritic: details?.game?.metacritic ?? null,
      released: details?.game?.released ?? null,
      finalPrice,
    };
    Alert.alert(
      'Comprar en ENEBO',
      `${name}\n\nPrecio: $${finalPrice.toFixed(2)} USD`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Confirmar',
          onPress: async () => {
            try {
              await addDoc(collection(db, 'users', user.uid, 'purchases'), {
                gameId: compactGame.id,
                name: compactGame.name,
                price: compactGame.finalPrice,
                meta: {
                  metacritic: compactGame.metacritic,
                  released: compactGame.released,
                },
                purchasedAt: serverTimestamp(),
              });
              Alert.alert('¡Listo!', `Gracias ${user.name} 😄`);
            } catch (e) {
              Alert.alert('Error', 'No se pudo registrar la compra');
            }
          }
        },
      ]
    );
  };

  const fetchDetails = async () => {
    try {
      const res = await fetch(`${RAWG_API}/games/${id}?key=${RAWG_KEY}`);
      if (!res.ok) throw new Error('No se pudo obtener el detalle');
      const game = await res.json();
      setDetails({ game });
    } catch (e) {
      setDetails(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchDetails(); }, [id]);

  const [c1, c2] = gradientById(id);
  const img = details?.game?.background_image || details?.game?.background_image_additional;

  const compactGame = {
    id, name, image: img,
    metacritic: details?.game?.metacritic,
    released: details?.game?.released,
    price, salePct: off, finalPrice,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0b0b0e' }}>
      <LinearGradient colors={[c1, c2]} style={styles.detailHeader}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={styles.detailTitle}>
            {name} <Text style={styles.detailId}>{pad3(id)}</Text>
          </Text>

          <TouchableOpacity onPress={() => toggleFavorite(compactGame)} style={styles.detailHeartBtn} activeOpacity={0.8}>
            <MaterialCommunityIcons name={fav ? 'heart' : 'heart-outline'} size={22} color={fav ? '#ef4444' : '#fff'} />
          </TouchableOpacity>
        </View>

        {img ? (
          <Image source={{ uri: img }} style={styles.detailImage} resizeMode="cover" />
        ) : (
          <View style={[styles.detailImage, { alignItems: 'center', justifyContent: 'center' }]}>
            <Text style={{ color: '#bbb' }}>Sin imagen</Text>
          </View>
        )}
      </LinearGradient>

      {loading ? (
        <View style={{ padding: 20, alignItems: 'center' }}>
          <ActivityIndicator color="#fff" />
          <Text style={{ marginTop: 8, color: '#bbb' }}>Cargando detalles…</Text>
        </View>
      ) : details?.game ? (
        <View style={{ paddingHorizontal: 16, paddingVertical: 16 }}>
          <View style={styles.detailPriceRow}>
            {off ? (
              <>
                <Text style={styles.priceStriked}>${price.toFixed(2)}</Text>
                <Text style={styles.priceFinal}>${finalPrice.toFixed(2)}</Text>
                <View style={styles.offerPillBig}>
                  <MaterialCommunityIcons name="tag" size={14} color="#10b981" />
                  <Text style={styles.offerTxtBig}>-{off}%</Text>
                </View>
              </>
            ) : (
              <Text style={styles.priceFinal}>${finalPrice.toFixed(2)}</Text>
            )}
          </View>

          <TouchableOpacity style={[styles.buyBtn, { alignSelf: 'flex-start', paddingHorizontal: 18 }]} onPress={handleBuy}>
            <MaterialCommunityIcons name="cart" size={18} color="#0b0b0e" />
            <Text style={styles.buyTxt}>Comprar</Text>
          </TouchableOpacity>

          <Text style={[styles.sectionTitle, { marginTop: 18 }]}>Información</Text>
          <View style={styles.infoGrid}>
            <InfoBlock label="Lanzamiento" value={details.game.released || '—'} />
            <InfoBlock label="Metacritic" value={String(details.game.metacritic ?? '—')} />
            <InfoBlock label="Plataformas" value={(details.game.platforms || []).map((p) => p.platform.name).join(', ') || '—'} />
            <InfoBlock label="Rating RAWG" value={String(details.game.rating ?? '—')} />
          </View>

          <Text style={[styles.sectionTitle, { marginTop: 16 }]}>Géneros</Text>
          <View style={styles.genresWrap}>
            {(details.game.genres || []).map((g) => (
              <View key={g.id} style={styles.genreChip}>
                <Text style={styles.genreTxt}>{g.name}</Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

/** ======================
 *      FAVORITES
 *  ====================== */
function FavoritesScreen({ navigation }) {
  const { favorites, toggleFavorite } = useFavorites();

  const renderItem = ({ item }) => {
    const [c1, c2] = gradientById(item.id);
    const onBuy = () =>
      Alert.alert(
        'Comprar en ENEBO',
        `${item.name}\n\nPrecio: $${item.finalPrice.toFixed(2)} USD`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Confirmar', onPress: () => Alert.alert('¡Listo!', 'Compra simulada 😄') },
        ]
      );

    return (
      <TouchableOpacity activeOpacity={0.9} onPress={() => navigation.navigate('Details', { id: item.id, name: item.name })} style={{ width: CARD_W }}>
        <View style={styles.card}>
          <LinearGradient colors={[c1, c2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.cardBanner}>
            <View style={styles.metacriticPill}>
              <MaterialCommunityIcons name="star-circle" size={14} color="#fff" />
              <Text style={styles.metacriticTxt}>{item.metacritic ?? '—'}</Text>
            </View>
            {item.salePct ? (
              <View style={styles.offerPill}>
                <MaterialCommunityIcons name="tag" size={12} color="#10b981" />
                <Text style={styles.offerTxt}>-{item.salePct}%</Text>
              </View>
            ) : null}
            <Text style={styles.cardId}>{pad3(item.id)}</Text>
          </LinearGradient>

          <View>
            <Image source={{ uri: item.image }} style={styles.cardImage} resizeMode="cover" />
            <TouchableOpacity onPress={() => toggleFavorite(item)} activeOpacity={0.8} style={styles.heartBtn}>
              <MaterialCommunityIcons name="heart" size={20} color="#ef4444" />
            </TouchableOpacity>
          </View>

          <View style={styles.cardInfo}>
            <Text style={styles.cardName} numberOfLines={1}>{item.name}</Text>
            <Text style={styles.cardReleased} numberOfLines={1}>{item.released || '—'}</Text>

            <View style={styles.priceRow}>
              {item.salePct ? (
                <>
                  <Text style={styles.priceStriked}>${item.price.toFixed(2)}</Text>
                  <Text style={styles.priceFinal}>${item.finalPrice.toFixed(2)}</Text>
                </>
              ) : (
                <Text style={styles.priceFinal}>${item.finalPrice.toFixed(2)}</Text>
              )}
            </View>

            <TouchableOpacity style={styles.buyBtn} onPress={onBuy}>
              <MaterialCommunityIcons name="cart" size={16} color="#0b0b0e" />
              <Text style={styles.buyTxt}>Comprar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient colors={['#0f0c29', '#302b63', '#24243e']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={styles.headerGrad}>
        <View style={styles.headerLeft}>
          <View style={styles.logoCircle}>
            <MaterialCommunityIcons name="heart" size={20} color="#fff" />
          </View>
          <Text style={styles.brandTitle}>Favoritos</Text>
        </View>
      </LinearGradient>

      {favorites.length === 0 ? (
        <View style={{ padding: 24, alignItems: 'center' }}>
          <Text style={{ color: '#98a2b3', textAlign: 'center' }}>
            Aún no tienes favoritos. Toca el corazón en cualquier juego para guardarlo aquí.
          </Text>
        </View>
      ) : (
        <FlatList
          data={favorites}
          keyExtractor={(item) => String(item.id)}
          numColumns={COLS}
          columnWrapperStyle={{ gap: GAP, paddingHorizontal: H_PADDING }}
          contentContainerStyle={{ paddingBottom: 24, paddingTop: 8, gap: GAP }}
          renderItem={renderItem}
        />
      )}
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

/** ======================
 *        LOGIN (login + registro)
 *  ====================== */
function LoginScreen({ navigation }) {
  const { user, register, login } = useAuth();
  const [mode, setMode] = useState('login'); // 'login' | 'register'
  const [name, setName] = useState('');
  const [email, setEmail] = useState(user?.email || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const onSubmit = async () => {
    setErr(null);
    try {
      setBusy(true);
      if (mode === 'register') {
        await register(name.trim(), email.trim(), password);
      } else {
        await login(email.trim(), password);
      }
      Alert.alert('¡Listo!', mode === 'register' ? 'Cuenta creada' : 'Sesión iniciada', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch (e) {
      setErr(e.message || 'Error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#0b0b0e' }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          <LinearGradient colors={['#0f0c29', '#302b63', '#24243e']} style={styles.detailHeader}>
            <Text style={styles.detailTitle}>{mode === 'register' ? 'Crear cuenta' : 'Iniciar sesión'}</Text>
          </LinearGradient>

          <View style={{ marginTop: 16, backgroundColor: '#0f1222', borderRadius: 12, padding: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: '#1f2540' }}>
            {mode === 'register' && (
              <>
                <Text style={{ color: '#94a3b8', marginBottom: 6, fontWeight: '700' }}>Nombre</Text>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="Tu nombre"
                  placeholderTextColor="#6b7280"
                  style={styles.input}
                />
              </>
            )}

            <Text style={{ color: '#94a3b8', marginTop: 12, marginBottom: 6, fontWeight: '700' }}>Email</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              keyboardType="email-address"
              placeholder="tu@correo.com"
              placeholderTextColor="#6b7280"
              style={styles.input}
            />

            <Text style={{ color: '#94a3b8', marginTop: 12, marginBottom: 6, fontWeight: '700' }}>Contraseña</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              placeholder="••••"
              placeholderTextColor="#6b7280"
              style={styles.input}
            />

            {err ? <Text style={{ color: '#ff7b7b', marginTop: 10, fontWeight: '700' }}>{err}</Text> : null}

            <TouchableOpacity
              style={[styles.buyBtn, { alignSelf: 'flex-start', marginTop: 16, paddingHorizontal: 18 }]}
              onPress={onSubmit}
              disabled={busy}
            >
              {busy ? <ActivityIndicator /> : <MaterialCommunityIcons name={mode === 'register' ? 'account-plus' : 'login'} size={18} color="#0b0b0e" />}
              <Text style={styles.buyTxt}>{busy ? 'Procesando…' : (mode === 'register' ? 'Crear cuenta' : 'Entrar')}</Text>
            </TouchableOpacity>

            <TouchableOpacity onPress={() => setMode(mode === 'register' ? 'login' : 'register')} style={{ marginTop: 12 }}>
              <Text style={{ color: '#94a3b8' }}>
                {mode === 'register' ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      <StatusBar style="light" />
    </SafeAreaView>
  );
}

/** ======================
 *         UI bits
 *  ====================== */
function InfoBlock({ label, value }) {
  return (
    <View style={styles.infoBlock}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

/** ======================
 *          ROOT
 *  ====================== */
export default function App() {
  return (
    <AuthProvider>
      <FavoritesProvider>
        <NavigationContainer>
          <Stack.Navigator
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: '#0b0b0e' },
              animation: Platform.select({ ios: 'default', android: 'fade' }),
            }}
          >
            <Stack.Screen name="Home" component={HomeScreen} />
            <Stack.Screen
              name="Details"
              component={DetailsScreen}
              options={({ route }) => ({
                headerShown: true,
                title: route.params?.name || 'Detalle',
                headerTitleAlign: 'center',
                headerBackTitleVisible: false,
                headerShadowVisible: false,
                headerStyle: { backgroundColor: '#fff' },
                headerTintColor: '#111',
                headerTitleStyle: { fontWeight: '700' },
                gestureEnabled: true,
              })}
            />
            <Stack.Screen name="Favorites" component={FavoritesScreen} options={{ headerShown: false }} />
            <Stack.Screen
              name="Login"
              component={LoginScreen}
              options={{
                headerShown: true,
                title: 'Login',
                headerTitleAlign: 'center',
                headerBackTitleVisible: false,
                headerShadowVisible: false,
                headerStyle: { backgroundColor: '#fff' },
                headerTintColor: '#111',
                headerTitleStyle: { fontWeight: '700' },
                gestureEnabled: true,
              }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </FavoritesProvider>
    </AuthProvider>
  );
}

/** ======================
 *        STYLES
 *  ====================== */
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0b0b0e' },

  headerGrad: {
    paddingTop: 10, paddingBottom: 14, paddingHorizontal: 16,
    borderBottomLeftRadius: 18, borderBottomRightRadius: 18,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, elevation: 6,
  },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoCircle: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: '#ffffff22',
    alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth, borderColor: '#ffffff55',
  },
  brandTitle: { color: '#fff', fontWeight: '900', fontSize: 20, letterSpacing: 0.5 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#ffffff22',
    borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: '#ffffff44',
  },
  tagTxt: { color: '#fff', fontWeight: '700', fontSize: 12 },

  favHeaderBtn: {
    marginLeft: 4, paddingHorizontal: 10, paddingVertical: 6,
    backgroundColor: '#ffffff22', borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#ffffff44',
    position: 'relative',
  },
  favBadge: {
    position: 'absolute', top: -4, right: -4, backgroundColor: '#ef4444',
    minWidth: 18, height: 18, borderRadius: 9, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
  },
  favBadgeTxt: { color: '#fff', fontWeight: '900', fontSize: 10 },

  searchWrap: {
    marginTop: 12, marginHorizontal: H_PADDING, backgroundColor: '#111827',
    borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: '#1f2937',
    paddingHorizontal: 10, paddingVertical: Platform.select({ ios: 10, android: 2 }),
    flexDirection: 'row', alignItems: 'center',
  },
  search: { flex: 1, color: '#e5e7eb', fontSize: 16, paddingVertical: 8 },

  card: {
    width: CARD_W, height: CARD_H, backgroundColor: '#0f1222', borderRadius: 14, overflow: 'hidden',
    marginBottom: GAP, borderWidth: StyleSheet.hairlineWidth, borderColor: '#1f2540',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, elevation: 4,
  },
  cardBanner: {
    height: 38, paddingHorizontal: 10, alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between',
  },
  metacriticPill: {
    flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#00000033',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#ffffff55',
  },
  metacriticTxt: { color: '#fff', fontWeight: '800', fontSize: 12 },
  offerPill: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#062e27',
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#0d9488',
    position: 'absolute', right: 50,
  },
  offerTxt: { color: '#10b981', fontWeight: '800', fontSize: 12 },
  cardId: { color: '#fff', fontWeight: '800', opacity: 0.85, fontSize: 12 },

  cardImage: { width: '100%', height: 130, backgroundColor: '#0b0b0e' },

  heartBtn: {
    position: 'absolute', right: 8, top: 8, backgroundColor: '#00000066',
    borderRadius: 16, padding: 6, borderWidth: StyleSheet.hairlineWidth, borderColor: '#ffffff55',
  },

  cardInfo: { flex: 1, paddingHorizontal: 10, paddingTop: 8 },
  cardName: { color: '#e5e7eb', fontSize: 14, fontWeight: '800' },
  cardReleased: { color: '#94a3b8', fontSize: 12, marginTop: 2 },

  priceRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 8 },
  priceStriked: { color: '#94a3b8', textDecorationLine: 'line-through', fontWeight: '700' },
  priceFinal: { color: '#22c55e', fontWeight: '900' },

  buyBtn: {
    marginTop: 'auto', backgroundColor: '#22c55e', alignSelf: 'flex-start',
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 10, flexDirection: 'row', alignItems: 'center', gap: 6,
  },
  buyTxt: { color: '#0b0b0e', fontWeight: '900' },

  retryBtn: { backgroundColor: '#4f46e5', alignSelf: 'flex-start', paddingVertical: 10, paddingHorizontal: 16, borderRadius: 10 },
  retryTxt: { color: '#fff', fontWeight: '700' },

  detailHeader: {
    paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12,
    borderBottomLeftRadius: 24, borderBottomRightRadius: 24,
  },
  detailTitle: { fontSize: 26, fontWeight: '900', color: '#fff' },
  detailId: { fontSize: 16, color: '#e2e8f0', opacity: 0.8 },
  detailImage: { width: '100%', height: 240, marginTop: 12, borderRadius: 12, backgroundColor: '#0b0b0e' },

  detailHeartBtn: {
    padding: 6, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, borderColor: '#ffffff55', backgroundColor: '#00000033',
  },

  sectionTitle: { color: '#e2e8f0', fontWeight: '900', fontSize: 16, marginBottom: 10 },

  infoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  infoBlock: {
    width: '48%', backgroundColor: '#0f1222', borderRadius: 12, padding: 12,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#1f2540',
  },
  infoLabel: { color: '#94a3b8', fontWeight: '700', marginBottom: 4, fontSize: 12 },
  infoValue: { color: '#e5e7eb', fontWeight: '800' },

  genresWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  genreChip: {
    backgroundColor: '#1f2540', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#2c335b',
  },
  genreTxt: { color: '#cbd5e1', fontWeight: '700', fontSize: 12 },

  detailPriceRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  offerPillBig: {
    flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#062e27',
    paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth, borderColor: '#0d9488',
  },
  offerTxtBig: { color: '#10b981', fontWeight: '900' },

  // Login inputs
  input: {
    backgroundColor: '#0b0b0e',
    color: '#e5e7eb',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#1f2540',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: Platform.select({ ios: 12, android: 8 }),
  },
});
