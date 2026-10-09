import { Redirect } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';

WebBrowser.maybeCompleteAuthSession();

/**
 * OAuth redirect target (dumpr://auth/callback). The code exchange happens in
 * `signInWithProvider()`; if the OS also delivers the link to the router, just go home.
 */
export default function AuthCallback() {
  return <Redirect href="/" />;
}
