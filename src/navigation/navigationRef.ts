import { createNavigationContainerRef } from '@react-navigation/native';
import { RootStackParamList } from './types';

export const navigationRef =
  createNavigationContainerRef<RootStackParamList>();

/** Navigate to the full player (no-op if the navigator isn't mounted). */
export function openFullPlayer() {
  if (navigationRef.isReady()) {
    navigationRef.navigate('FullPlayer');
  }
}

/** Dismiss the full player if it's currently on top of the stack. */
export function closeFullPlayer() {
  if (navigationRef.isReady() && navigationRef.canGoBack()) {
    navigationRef.goBack();
  }
}
