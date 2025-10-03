import 'react-native-gesture-handler';
import React, { useEffect, useMemo, useState, useCallback, useContext, createContext } from 'react';
import {
  View, Text, StyleSheet, FlatList, Image, TouchableOpacity, TextInput,
  ActivityIndicator, RefreshControl, SafeAreaView, Dimensions, Platform, Alert,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';

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

// ====== FAVORITOS (Context + Persistencia, en JS) ======
/** Estructura GameCard (referencia):
 * { id, name, image, metacritic, released, price, salePct, finalPrice }
 */
const FavoritesContext = createContext(null);
const FAVORITES_KEY = 'FAVORITES_GAMES_V1';

function useFavorites() {
  const ctx = useContext(FavoritesContext);
  if (!ctx) throw new Error('useFavorites debe usarse dentro de FavoritesProvider');
  return ctx;
}

function FavoritesProvider({ children }) {
  const [favorites, setFavorites] = useState([]);

  // cargar al inicio
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(FAVORITES_KEY);
        if (raw) setFavorites(JSON.parse(raw));
      } catch {}
    })();
  }, []);

  // persistir cambios
  useEffect(() => {
    AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)).catch(() => {});
  }, [favorites]);

  const isFavorite = (id) => favorites.some((f) => f.id === id);

  const toggleFavorite = (game) => {
    setFavorites((prev) => {
      const exists = prev.some((g) => g.id === game.id);
      if (exists) return prev.filter((g) => g.id !== game.id);
      return [
        ...prev,
        {
          id: game.id,
          name: game.name,
          image: game.image,
          metacritic: game.metacritic,
          released: game.released,
          price: game.price,
          salePct: game.salePct,
          finalPrice: game.finalPrice,
        },
      ];
    });
  };

  const removeFavorite = (id) => setFavorites((prev) => prev.filter((g) => g.id !== id));

  return (
    <FavoritesContext.Provider value={{ favorites, isFavorite, toggleFavorite, removeFavorite }}>
      {children}
    </FavoritesContext.Provider>
  );
}

// ====== HOME ======
function HomeScreen({ navigation }) {
  const [all, setAll] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [showOffers, setShowOffers] = useState(false);

  const { favorites, isFavorite, toggleFavorite } = useFavorites();

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

  useEffect(() => {
    fetchGames();
  }, []);

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
    Alert.alert(
      'Comprar en ENEBO',
      `${game.name}\n\nPrecio: $${game.finalPrice.toFixed(2)} USD`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: () => Alert.alert('¡Listo!', 'Compra simulada 😄') },
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
        <HomeHeader
          navigation={navigation}
          showOffers={showOffers}
          onToggleOffers={() => setShowOffers((s) => !s)}
          favCount={favCount}
        />
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
        <HomeHeader
          navigation={navigation}
          showOffers={showOffers}
          onToggleOffers={() => setShowOffers((s) => !s)}
          favCount={favCount}
        />
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
      <HomeHeader
        navigation={navigation}
        showOffers={showOffers}
        onToggleOffers={() => setShowOffers((s) => !s)}
        favCount={favCount}
      />

      <View style={styles.searchWrap}>
        <MaterialCommunityIcons name="magnify" size={20} color="#98a2b3" style={{ marginRight: 8 }} />
        <TextInput
          placeholder="Buscar juegos (ej. Elden Ring, Hades, GTA)"
          placeholderTextColor="#98a2b3"
          value={query}
          onChangeText={(t) => {
            setQuery(t);
            fetchGames(t);
          }}
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

// ===== Header =====
function HomeHeader({ showOffers, onToggleOffers, navigation, favCount = 0 }) {
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

        <View style={[styles.tag, { backgroundColor: '#2dd4bf22', borderColor: '#2dd4bf55' }]}>
          <MaterialCommunityIcons name="shield-star" size={14} color="#2dd4bf" />
          <Text style={[styles.tagTxt, { color: '#2dd4bf' }]}>Top</Text>
        </View>

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

// ===== DETAILS =====
function DetailsScreen({ route }) {
  const { id, name } = route.params;
  const [details, setDetails] = useState(null);
  const [loading, setLoading] = useState(true);

  const price = basePriceFor(id);
  const off = saleFor(id);
  const finalPrice = off ? priceWithSale(price, off) : price;

  const { isFavorite, toggleFavorite } = useFavorites();
  const fav = isFavorite(id);

  const handleBuy = () => {
    Alert.alert(
      'Comprar en ENEBO',
      `${name}\n\nPrecio: $${finalPrice.toFixed(2)} USD`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Confirmar', onPress: () => Alert.alert('¡Listo!', 'Compra simulada 😄') },
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
    id,
    name,
    image: img,
    metacritic: details?.game?.metacritic,
    released: details?.game?.released,
    price,
    salePct: off,
    finalPrice,
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
            <InfoBlock
              label="Plataformas"
              value={(details.game.platforms || []).map((p) => p.platform.name).join(', ') || '—'}
            />
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

// ===== FAVORITES SCREEN =====
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

// ===== UI bits =====
function InfoBlock({ label, value }) {
  return (
    <View style={styles.infoBlock}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
    </View>
  );
}

// ===== Root =====
export default function App() {
  return (
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
        </Stack.Navigator>
      </NavigationContainer>
    </FavoritesProvider>
  );
}

// ===== Styles =====
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
});
