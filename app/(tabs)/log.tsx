import { Redirect } from 'expo-router';

// This screen exists only so Expo Router registers the route.
// The tab button in _layout.tsx overrides navigation to open /log-food instead.
export default function LogTab() {
  return <Redirect href="/(tabs)" />;
}
