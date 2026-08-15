import React, { useCallback } from 'react';
import {
  Image,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { getStats } from '../../db/history';
import { useCachedData } from '../../hooks/useCachedData';
import EmptyState from '../ui/EmptyState';
import { StatsSkeleton } from '../ui/ListSkeleton';

export default function StatsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  // Session-cached stats: instant on revisit, background refresh.
  const { data: stats, loading, refresh } = useCachedData('stats', getStats, {
    persist: true,
  });

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return (
    <View className="flex-1" style={{ backgroundColor: '#0d0d0d' }}>
      <View
        className="flex-row items-center px-4 py-3"
        style={{ paddingTop: insets.top + 8 }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Icon name="chevron-back" size={28} color="#ffffff" />
        </TouchableOpacity>
        <Text className="text-white font-bold text-lg ml-2">Your Stats</Text>
      </View>

      {loading ? (
        <StatsSkeleton />
      ) : !stats || stats.totalPlays === 0 ? (
        <EmptyState
          icon="bar-chart-outline"
          message="Nothing to show yet — start playing songs and your stats will appear here."
        />
      ) : (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ padding: 24, paddingBottom: 110 }}
        >
          {/* Totals */}
          <View className="flex-row gap-3">
            <View className="flex-1 bg-[#181818] rounded-xl p-5">
              <Text className="text-white/50 text-xs font-semibold tracking-widest">
                PLAYS
              </Text>
              <Text className="text-white text-4xl font-bold mt-2">
                {stats.totalPlays}
              </Text>
            </View>
            <View className="flex-1 bg-[#181818] rounded-xl p-5">
              <Text className="text-white/50 text-xs font-semibold tracking-widest">
                MINUTES
              </Text>
              <Text className="text-white text-4xl font-bold mt-2">
                {stats.totalMinutes}
              </Text>
            </View>
          </View>

          {/* Top artists */}
          <Text className="text-white text-xl font-bold mt-8 mb-3">
            Top Artists
          </Text>
          {stats.topArtists.map((artist, i) => (
            <View
              key={artist.name}
              className="flex-row items-center py-3 border-b border-white/10"
            >
              <Text className="text-white/40 font-bold text-base w-8">
                {i + 1}
              </Text>
              <View className="w-11 h-11 rounded-full bg-[#282828] items-center justify-center mr-3">
                <Icon name="person" size={20} color="rgba(255,255,255,0.5)" />
              </View>
              <Text className="text-white font-semibold text-[15px] flex-1">
                {artist.name}
              </Text>
              <Text className="text-white/50 text-sm">
                {artist.plays} {artist.plays === 1 ? 'play' : 'plays'}
              </Text>
            </View>
          ))}

          {/* Top songs */}
          <Text className="text-white text-xl font-bold mt-8 mb-3">Top Songs</Text>
          {stats.topSongs.map((entry, i) => (
            <View
              key={entry.song.id}
              className="flex-row items-center py-3 border-b border-white/10"
            >
              <Text className="text-white/40 font-bold text-base w-8">
                {i + 1}
              </Text>
              <Image
                source={{ uri: entry.song.cover }}
                className="w-11 h-11 rounded mr-3"
              />
              <View className="flex-1">
                <Text className="text-white font-semibold text-[15px]" numberOfLines={1}>
                  {entry.song.title}
                </Text>
                <Text className="text-white/50 text-xs" numberOfLines={1}>
                  {entry.song.artist}
                </Text>
              </View>
              <Text className="text-white/50 text-sm">
                {entry.plays} {entry.plays === 1 ? 'play' : 'plays'}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
