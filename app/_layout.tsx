import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import 'react-native-reanimated';

import { FoodLogProvider } from '@/context/food-log-context';
import { InventoryProvider } from '@/context/inventory-context';
import { useColorScheme } from '@/hooks/use-color-scheme';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export const unstable_settings = {
  anchor: '(tabs)',
};

export default function RootLayout() {
  const colorScheme = useColorScheme();

  useEffect(() => {
    Notifications.requestPermissionsAsync();
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <FoodLogProvider>
        <InventoryProvider>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="log-food" options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="cook" options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="settings" options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="body-data" options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="goals-edit" options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="add-inventory-item" options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="inventory-add-food" options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="camera" options={{ headerShown: false, animation: 'fade' }} />
            <Stack.Screen name="ai-result" options={{ headerShown: false }} />
            <Stack.Screen name="ai-inventory" options={{ headerShown: false }} />
            <Stack.Screen name="meal-entries" options={{ presentation: 'modal', headerShown: false }} />
            <Stack.Screen name="inventory-barcode" options={{ headerShown: false }} />
            <Stack.Screen name="recipe-detail" options={{ headerShown: false }} />
            <Stack.Screen name="cook-mode" options={{ headerShown: false }} />
            <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
          </Stack>
          <StatusBar style="auto" />
        </InventoryProvider>
      </FoodLogProvider>
    </ThemeProvider>
    </GestureHandlerRootView>
  );
}
