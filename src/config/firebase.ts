import { initializeApp, getApps, getApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider, signInWithPopup } from "firebase/auth";
import { initializeFirestore, getFirestore, memoryLocalCache, setLogLevel } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Silence non-critical Firestore internal logs
setLogLevel("error");

// Initialize Firebase App as Singleton
const app = getApps().length === 0
  ? initializeApp({
      apiKey: firebaseConfig.apiKey,
      authDomain: firebaseConfig.authDomain,
      projectId: firebaseConfig.projectId,
      storageBucket: firebaseConfig.storageBucket,
      messagingSenderId: firebaseConfig.messagingSenderId,
      appId: firebaseConfig.appId,
    })
  : getApp();

export const auth = getAuth(app);

const serverDatabaseId = (firebaseConfig as any).firestoreDatabaseId || "(default)";

let firestoreInstance;
try {
  firestoreInstance = initializeFirestore(app, {
    localCache: memoryLocalCache(),
  }, serverDatabaseId);
} catch (e) {
  firestoreInstance = getFirestore(app, serverDatabaseId);
}

export const db = firestoreInstance;

export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope("openid");
googleProvider.addScope("email");
googleProvider.addScope("profile");
googleProvider.setCustomParameters({
  prompt: "select_account",
});

export const githubProvider = new GithubAuthProvider();
githubProvider.addScope("user:email");
githubProvider.addScope("read:user");

export { signInWithPopup };

