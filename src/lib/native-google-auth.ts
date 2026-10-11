import { registerPlugin, Capacitor } from '@capacitor/core';
import {
  GoogleAuthProvider,
  signInWithCredential,
  signInWithPopup,
  type User as FirebaseUser,
} from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';
import { auth } from './firebase-auth.ts';

interface NativeGoogleAuthPlugin {
  signIn(options?: { clientId?: string }): Promise<{
    idToken: string;
    email?: string;
    name?: string;
    photoUrl?: string;
  }>;
  signOut(): Promise<{ success: boolean }>;
  openSystemUrl(options: { url: string }): Promise<{ success: boolean }>;
  getPendingDeepLink(): Promise<{ url?: string | null }>;
  addListener(
    eventName: 'appUrlOpen' | 'deepLinkReceived',
    listenerFunc: (data: { url?: string }) => void
  ): Promise<{ remove: () => void }>;
}

export const NativeGoogleAuth = registerPlugin<NativeGoogleAuthPlugin>('NativeGoogleAuth');

/**
 * Universal Google Sign-In helper that transparently switches between:
 * 1. Native Android Google Play Services account picker on Android (no browser redirects, no "requested action is invalid").
 * 2. Standard Firebase signInWithPopup on Desktop Web.
 * Returns the Firebase User with a valid Firebase ID token ready for backend verification.
 */
export async function performGoogleSignIn(): Promise<{ user: FirebaseUser; idToken: string }> {
  if (Capacitor.isNativePlatform()) {
    // 1. Native Android flow: get Google ID token directly from Google Play Services
    const result = await NativeGoogleAuth.signIn({
      clientId: firebaseConfig.oAuthClientId || undefined,
    });
    console.log('Native Google Sign-In succeeded', {
      hasIdToken: Boolean(result?.idToken),
    });
    if (!result?.idToken) {
      throw new Error('No ID token received from Google Play Services.');
    }

    // 2. Exchange Google ID token for Firebase user credential via direct HTTPS REST call (no popup/redirect)
    const credential = GoogleAuthProvider.credential(result.idToken);
    const userCredential = await signInWithCredential(auth, credential);
    const idToken = await userCredential.user.getIdToken();

    return { user: userCredential.user, idToken };
  } else {
    // Desktop Web flow: standard Firebase web popup
    const basicProvider = new GoogleAuthProvider();
    basicProvider.addScope('email');
    basicProvider.addScope('profile');
    const result = await signInWithPopup(auth, basicProvider);
    const idToken = await result.user.getIdToken();

    return { user: result.user, idToken };
  }
}
