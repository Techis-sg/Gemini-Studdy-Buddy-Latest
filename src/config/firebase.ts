import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, GithubAuthProvider, signInWithPopup } from "firebase/auth";
import { initializeFirestore, memoryLocalCache, setLogLevel } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

// Silence non-critical Firestore internal logs
setLogLevel("error");

// Initialize Firebase App
const app = initializeApp({
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  storageBucket: firebaseConfig.storageBucket,
  messagingSenderId: firebaseConfig.messagingSenderId,
  appId: firebaseConfig.appId,
});

export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  localCache: memoryLocalCache(),
}, firebaseConfig.firestoreDatabaseId || "(default)");

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
