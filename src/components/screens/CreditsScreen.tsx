import React, { useRef } from 'react';
import {
  Linking,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { RootStackParamList } from '../../navigation/types';
import { colors } from '../../theme/colors';

const FEATURES: { icon: string; title: string; subtitle: string }[] = [
  {
    icon: 'musical-notes',
    title: 'Unlimited streaming',
    subtitle: 'Every song, free — straight from YouTube',
  },
  {
    icon: 'phone-portrait-outline',
    title: 'No backend needed',
    subtitle: 'Search & stream resolve on your phone',
  },
  {
    icon: 'download-outline',
    title: 'Offline downloads',
    subtitle: 'Save songs forever, no expiry, no ads',
  },
  {
    icon: 'mic-outline',
    title: 'Synced lyrics',
    subtitle: 'Highlighted only when the timing really matches',
  },
  {
    icon: 'headset-outline',
    title: 'Background play',
    subtitle: 'Lock-screen controls while you do other things',
  },
  {
    icon: 'albums-outline',
    title: 'Playlists & Library',
    subtitle: 'Save, organize, and queue anything',
  },
  {
    icon: 'logo-spotify',
    title: 'Spotify import',
    subtitle: 'Bring in playlists, albums & artists',
  },
  {
    icon: 'bar-chart-outline',
    title: 'Listening stats',
    subtitle: 'See your most-played tracks & artists',
  },
  {
    icon: 'shield-checkmark-outline',
    title: 'No login, no tracking',
    subtitle: 'Your data never leaves your device',
  },
];

/** How a tap on a song actually becomes audio — the current pipeline. */
const PIPELINE: { step: string; detail: string }[] = [
  {
    step: 'Search on device',
    detail: 'YouTube Music is queried straight from the app (ytmusic-api).',
  },
  {
    step: 'Resolve the stream',
    detail:
      "YouTube's InnerTube player API is called with the Android client and " +
      'returns a progressive itag-18 media URL.',
  },
  {
    step: 'Proxy it locally',
    detail:
      'A Kotlin HTTP server inside the app (127.0.0.1) serves that URL with ' +
      'correct range/length semantics and a pinned client User-Agent.',
  },
  {
    step: 'Play it',
    detail:
      'Media3 / ExoPlayer streams from the local URL via ' +
      'react-native-track-player, so playback survives URL expiry.',
  },
];

const LINKS: { icon: string; label: string; value: string; url: string }[] = [
  {
    icon: 'logo-github',
    label: 'Source code',
    value: 'github.com/xauravww/beatflow-native',
    url: 'https://github.com/xauravww/beatflow-native',
  },
  {
    icon: 'logo-discord',
    label: 'Discord community',
    value: 'discord.gg/jcaVcarRU5',
    url: 'https://discord.gg/jcaVcarRU5',
  },
  {
    icon: 'mail-outline',
    label: 'Email',
    value: 'sauravmaheshwari8@gmail.com',
    url: 'mailto:sauravmaheshwari8@gmail.com',
  },
  {
    icon: 'globe-outline',
    label: 'Portfolio',
    value: 'xauravww.vercel.app',
    url: 'https://xauravww.vercel.app',
  },
];

const CREDITS: { name: string; role: string }[] = [
  { name: 'ytmusic-api', role: 'On-device YouTube Music search' },
  {
    name: 'YouTube InnerTube player API',
    role: 'Direct stream extraction (Android client, itag 18)',
  },
  {
    name: 'In-app Kotlin stream server',
    role: 'Local HTTP range proxy — no backend involved',
  },
  {
    name: 'react-native-track-player + Media3',
    role: 'Background playback engine',
  },
  { name: 'LRCLIB', role: 'Synced (LRC) lyrics provider' },
  { name: 'AZLyrics', role: 'Plain-text lyrics fallback' },
  { name: 'Spotify Web API', role: 'Playlist / album / artist import' },
  {
    name: 'react-native-sqlite-storage',
    role: 'Library, lyrics cache & listening stats',
  },
  { name: 'react-native-fs', role: 'Offline downloads' },
  { name: 'React Native + NativeWind', role: 'App framework & styling' },
];

export default function CreditsScreen() {
  const navigation =
    useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();

  // Hidden developer settings access: tap the logo 5× quickly.
  const logoTaps = useRef(0);
  const logoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleLogoPress = () => {
    logoTaps.current += 1;
    if (logoTimer.current) {
      clearTimeout(logoTimer.current);
    }
    logoTimer.current = setTimeout(() => {
      logoTaps.current = 0;
    }, 2000);
    if (logoTaps.current >= 5) {
      logoTaps.current = 0;
      navigation.navigate('Settings');
    }
  };

  return (
    <View className="flex-1" style={{ backgroundColor: '#0d0d0d' }}>
      <View
        className="flex-row items-center px-4 py-3"
        style={{ paddingTop: insets.top + 8 }}
      >
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12}>
          <Icon name="chevron-back" size={28} color="#ffffff" />
        </TouchableOpacity>
        <Text className="text-white font-bold text-lg ml-2">Credits</Text>
      </View>

      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
      >
        {/* ---- Hero ---- */}
        <View className="items-center px-8 pt-8 pb-6">
          <Pressable
            onPress={handleLogoPress}
            className="w-24 h-24 rounded-full bg-[#1ed760] items-center justify-center shadow-2xl"
          >
            <Icon name="musical-notes" size={48} color="#000000" />
          </Pressable>
          <Text className="text-white text-4xl font-bold mt-6 tracking-tight">
            BeatFlow
          </Text>
          <Text className="text-white/50 text-sm mt-2 text-center leading-5">
            A Spotify-style music player that resolves and streams{' '}
            <Text className="text-[#1ed760]">entirely on your device</Text> —
            no backend server.
          </Text>

          {/* No ads badge */}
          <View className="flex-row items-center bg-[#1ed760]/15 border border-[#1ed760]/40 rounded-full px-4 py-2 mt-5">
            <Icon name="ban-outline" size={16} color="#1ed760" />
            <Text className="text-[#1ed760] text-[13px] font-bold ml-2">
              100% Free · No Ads · No Login
            </Text>
          </View>
        </View>

        {/* ---- Everything included ---- */}
        <View className="px-5">
          <Text className="text-white/50 text-xs font-semibold tracking-[0.2em] mb-4">
            EVERYTHING INCLUDED
          </Text>
          <View className="flex-row flex-wrap justify-between">
            {FEATURES.map((f) => (
              <View
                key={f.title}
                className="w-[48%] bg-[#181818] rounded-xl p-4 mb-3"
              >
                <View className="w-9 h-9 rounded-full bg-[#1ed760]/15 items-center justify-center">
                  <Icon name={f.icon} size={18} color="#1ed760" />
                </View>
                <Text className="text-white font-bold text-[14px] mt-3">
                  {f.title}
                </Text>
                <Text className="text-white/50 text-xs mt-1 leading-4">
                  {f.subtitle}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* ---- How a song plays ---- */}
        <View className="px-5 mt-4">
          <Text className="text-white/50 text-xs font-semibold tracking-[0.2em] mb-4">
            HOW A SONG PLAYS
          </Text>
          <View className="bg-[#181818] rounded-2xl p-4">
            {PIPELINE.map((p, i) => (
              <View key={p.step} className="flex-row">
                {/* step number + connecting rail */}
                <View className="items-center w-7">
                  <View className="w-6 h-6 rounded-full bg-[#1ed760]/15 items-center justify-center">
                    <Text className="text-[#1ed760] text-[11px] font-bold">
                      {i + 1}
                    </Text>
                  </View>
                  {i < PIPELINE.length - 1 && (
                    <View className="flex-1 w-[1px] bg-white/10 my-1" />
                  )}
                </View>
                <View
                  className="flex-1 ml-3"
                  style={{
                    paddingBottom: i < PIPELINE.length - 1 ? 16 : 0,
                  }}
                >
                  <Text className="text-white font-semibold text-[14px]">
                    {p.step}
                  </Text>
                  <Text className="text-white/50 text-xs mt-1 leading-5">
                    {p.detail}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ---- Connect ---- */}
        <View className="px-5 mt-4">
          <Text className="text-white/50 text-xs font-semibold tracking-[0.2em] mb-4">
            CONNECT WITH THE MAKER
          </Text>
          <View className="bg-[#181818] rounded-2xl px-2">
            {LINKS.map((link, i) => (
              <TouchableOpacity
                key={link.label}
                onPress={() => Linking.openURL(link.url).catch(() => {})}
                className={`flex-row items-center px-3 py-4 active:bg-white/5 ${
                  i < LINKS.length - 1 ? 'border-b border-white/10' : ''
                }`}
              >
                <View className="w-10 h-10 rounded-full bg-[#282828] items-center justify-center">
                  <Icon name={link.icon} size={19} color="#ffffff" />
                </View>
                <View className="flex-1 ml-3">
                  <Text className="text-white font-semibold text-[15px]">
                    {link.label}
                  </Text>
                  <Text className="text-white/50 text-xs mt-0.5">
                    {link.value}
                  </Text>
                </View>
                <Icon
                  name="open-outline"
                  size={16}
                  color="rgba(255,255,255,0.4)"
                />
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ---- Legal ---- */}
        <View className="px-5 mt-6">
          <Text className="text-white/50 text-xs font-semibold tracking-[0.2em] mb-4">
            LEGAL & DISCLAIMER
          </Text>
          <View className="bg-[#181818] rounded-2xl p-5">
            <Text className="text-white/70 text-[13px] leading-6">
              BeatFlow is built <Text className="text-white font-semibold">for educational purposes</Text>{' '}
              and for music lovers who can't afford paid streaming. We
              encourage you to{' '}
              <Text className="text-white font-semibold">
                support the artists
              </Text>{' '}
              you love by buying or streaming their music on official
              platforms.
            </Text>
            <Text className="text-white/70 text-[13px] leading-6 mt-4">
              Please{' '}
              <Text className="text-[#1ed760] font-semibold">
                don't resell this app
              </Text>{' '}
              or claim it as your own. It relies on unofficial APIs and
              scraping — use it responsibly, and don't harm or abuse the
              services it connects to.
            </Text>
            <Text className="text-white/40 text-xs leading-5 mt-4">
              No copyright infringement is intended. All music remains the
              property of its respective owners.
            </Text>
          </View>
        </View>

        {/* ---- Powered by ---- */}
        <View className="px-5 mt-6">
          <Text className="text-white/50 text-xs font-semibold tracking-[0.2em] mb-4">
            POWERED BY
          </Text>
          <View className="bg-[#181818] rounded-2xl px-2">
            {CREDITS.map((credit, i) => (
              <View
                key={credit.name}
                className={`flex-row items-center px-3 py-3.5 ${
                  i < CREDITS.length - 1 ? 'border-b border-white/10' : ''
                }`}
              >
                <Icon name="code-slash" size={18} color={colors.greenBright} />
                <View className="ml-3">
                  <Text className="text-white font-semibold text-[14px]">
                    {credit.name}
                  </Text>
                  <Text className="text-white/50 text-xs mt-0.5">
                    {credit.role}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        </View>

        {/* ---- Footer ---- */}
        <View className="items-center mt-10 mb-4 px-8">
          <Text className="text-white/40 text-sm text-center leading-6">
            Built with ❤️ by{' '}
            <Text className="text-white font-bold">xauravww</Text>
            {'\n'}Streaming music is hard — enjoy the ride 🎧
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
