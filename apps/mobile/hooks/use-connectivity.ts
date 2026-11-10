import { useNetworkState } from 'expo-network';

export type Connectivity = 'online' | 'offline' | 'unknown';

/**
 * Device connectivity. "online" requires the OS to report the internet as reachable, not just a
 * connected Wi-Fi/cellular interface (common with captive portals and exhausted data bundles).
 */
export function useConnectivity(): Connectivity {
  const state = useNetworkState();
  if (state.isConnected === false || state.isInternetReachable === false) return 'offline';
  if (state.isConnected && state.isInternetReachable) return 'online';
  return 'unknown';
}
