import React from 'react';
import { View } from 'react-native';
import Skeleton from './Skeleton';

/** Skeleton track rows — used by Library, Playlist and Artist screens. */
export function ListSkeleton({
  rows = 8,
  showHeader = false,
  padded = true,
}: {
  rows?: number;
  showHeader?: boolean;
  padded?: boolean;
}) {
  return (
    <View className={padded ? 'px-4 pt-4' : 'pt-2'}>
      {showHeader && <Skeleton className="h-7 w-44 mb-4" />}
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} className="flex-row items-center py-2.5">
          <Skeleton className="w-12 h-12 rounded" />
          <View className="flex-1 ml-3">
            <Skeleton className="h-3.5 w-3/5" />
            <Skeleton className="h-3 w-2/5 mt-2" />
          </View>
        </View>
      ))}
    </View>
  );
}

/** Skeleton for the Stats screen — totals cards + ranked rows. */
export function StatsSkeleton() {
  return (
    <View className="p-6">
      <View className="flex-row gap-3">
        <Skeleton className="flex-1 h-24 rounded-xl" />
        <Skeleton className="flex-1 h-24 rounded-xl" />
      </View>
      <Skeleton className="h-6 w-36 mt-8 mb-4" />
      {Array.from({ length: 6 }).map((_, i) => (
        <View key={i} className="flex-row items-center py-3">
          <Skeleton className="w-8 h-5" />
          <Skeleton className="w-11 h-11 rounded-full ml-2" />
          <View className="flex-1 ml-3">
            <Skeleton className="h-3.5 w-2/3" />
          </View>
        </View>
      ))}
    </View>
  );
}
