// firebase.js (para React Native / Expo)
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, initializeAuth } from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ⚠️ Usa tu configuración tal cual
const firebaseConfig = {
  apiKey: 'AIzaSyByX8WSLlWcJ96EaLrwCI6u6C8BZaR-i6A',
  authDomain: 'enebo-1c3fd.firebaseapp.com',
  projectId: 'enebo-1c3fd',
  storageBucket: 'enebo-1c3fd.firebasestorage.app',
  messagingSenderId: '267727393847',
  appId: '1:267727393847:web:e0cfe22baf34cb3ed69bb2',
  measurementId: 'G-2B7DNW530M', // en RN no se usa, pero no molesta
};

// Evita re-inicializar el app
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Inicializa Auth. Si existe el módulo RN, lo usamos; si no, fallback.
let auth;
try {
  // 👇 require dinámico: no truena si tu versión no trae este entrypoint
  const { getReactNativePersistence } = require('firebase/auth/react-native');
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch (e) {
  // Fallback a memoria (no persistente) si tu versión no tiene /react-native
  auth = getAuth(app);
}

const db = getFirestore(app);

export { app, auth, db };
