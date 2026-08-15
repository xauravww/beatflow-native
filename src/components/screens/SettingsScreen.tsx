import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { setCustomBackendBaseUrl, LOCAL_BASE_URL } from '../../api/client';
import {
  getBackendBaseUrlSetting,
  setBackendBaseUrlSetting,
} from '../../db/settings';
import { usePlayer } from '../../context/PlayerContext';

export default function SettingsScreen() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { showToast } = usePlayer();

  const [input, setInput] = useState('');
  const [savedUrl, setSavedUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const url = (await getBackendBaseUrlSetting().catch(() => null)) ?? null;
      if (mounted) {
        setSavedUrl(url);
        setInput(url ?? '');
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const effectiveUrl = savedUrl ?? LOCAL_BASE_URL;

  const handleSave = async () => {
    const url = input.trim();
    if (!url) {
      setError('Enter a URL, e.g. http://192.168.1.10:3000');
      return;
    }
    if (!/^https?:\/\/.+/.test(url)) {
      setError('URL must start with http:// or https://');
      return;
    }
    setError(null);
    setSaving(true);
    try {
      setCustomBackendBaseUrl(url);
      await setBackendBaseUrlSetting(url);
      setSavedUrl(url);
      showToast('Backend URL updated');
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    setCustomBackendBaseUrl(null);
    await setBackendBaseUrlSetting(null);
    setInput('');
    setSavedUrl(null);
    setError(null);
    showToast('Backend reset to defaults');
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
        <Text className="text-white font-bold text-lg ml-2">Settings</Text>
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          className="flex-1"
          contentContainerStyle={{ paddingBottom: 110 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* ---- Backend server ---- */}
          <View className="px-5 mt-4">
            <Text className="text-white/50 text-xs font-semibold tracking-[0.2em] mb-4">
              BACKEND SERVER
            </Text>
            <View className="bg-[#181818] rounded-2xl p-5">
              <View className="flex-row items-center mb-4">
                <View className="w-10 h-10 rounded-full bg-[#1ed760]/15 items-center justify-center">
                  <Icon name="server-outline" size={19} color="#1ed760" />
                </View>
                <View className="flex-1 ml-3">
                  <Text className="text-white font-bold text-[15px]">
                    Custom backend URL
                  </Text>
                  <Text className="text-white/50 text-xs mt-0.5">
                    Override the server used for search, streaming & downloads
                  </Text>
                </View>
              </View>

              <TextInput
                value={input}
                onChangeText={(t) => {
                  setInput(t);
                  setError(null);
                }}
                placeholder="http://192.168.1.10:3000"
                placeholderTextColor="rgba(255,255,255,0.35)"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                className="bg-white/10 rounded-xl px-4 py-3 text-white text-[15px]"
              />
              {error && (
                <Text className="text-[#f15e5e] text-xs mt-2">{error}</Text>
              )}

              <View className="flex-row mt-3">
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={saving}
                  className="flex-1 bg-[#1ed760] rounded-full px-4 py-3 items-center"
                >
                  {saving ? (
                    <ActivityIndicator size="small" color="#000" />
                  ) : (
                    <Text className="text-black font-bold text-sm">Save</Text>
                  )}
                </TouchableOpacity>
                {savedUrl && (
                  <TouchableOpacity
                    onPress={handleClear}
                    className="px-4 py-3 ml-3 rounded-full bg-white/10"
                  >
                    <Text className="text-white/80 font-semibold text-sm">
                      Reset
                    </Text>
                  </TouchableOpacity>
                )}
              </View>

              <View className="mt-4 pt-4 border-t border-white/10">
                {savedUrl ? (
                  <View className="flex-row justify-between py-1">
                    <Text className="text-white/50 text-xs">In use</Text>
                    <Text
                      numberOfLines={1}
                      className="text-white/80 text-xs font-semibold ml-3"
                    >
                      {effectiveUrl}
                    </Text>
                  </View>
                ) : (
                  <Text className="text-white/50 text-xs py-1">
                    Using built-in default servers
                  </Text>
                )}
              </View>
            </View>
          </View>

          {/* ---- Self-host instructions ---- */}
          <View className="px-5 mt-6">
            <Text className="text-white/50 text-xs font-semibold tracking-[0.2em] mb-4">
              SELF-HOST YOUR OWN BACKEND
            </Text>
            <View className="bg-[#181818] rounded-2xl p-5">
              <Text className="text-white/70 text-[13px] leading-6">
                BeatFlow ships with a Node/Express backend in the{' '}
                <Text className="text-white font-semibold">backend/</Text> folder.
                Host it yourself for full control:
              </Text>
              {[
                '1.  cd backend && npm install && npm start',
                '2.  Find your PC’s IP:',
              ].map((step) => (
                <View key={step} className="flex-row items-start mt-3">
                  <View className="w-1.5 h-1.5 rounded-full bg-[#1ed760] mt-2" />
                  <Text className="text-white text-[13px] ml-3 flex-1 leading-5">
                    {step}
                  </Text>
                </View>
              ))}
              <View className="bg-white/5 rounded-lg px-3 py-2.5 ml-5 mt-2">
                <Text className="text-white/70 text-xs leading-5">
                  <Text className="text-[#1ed760] font-semibold">Windows:</Text>
                  {'  '}open Command Prompt (Win + R → type{' '}
                  <Text className="text-white font-mono">cmd</Text>) and run{' '}
                  <Text className="text-white font-mono">ipconfig</Text> — look
                  for “IPv4 Address” (starts with{' '}
                  <Text className="text-[#1ed760]">192.168</Text>)
                </Text>
                <Text className="text-white/70 text-xs leading-5 mt-2">
                  <Text className="text-[#1ed760] font-semibold">Mac:</Text>
                  {'  '}open Terminal and run{' '}
                  <Text className="text-white font-mono">ipconfig getifaddr en0</Text>
                  {' '}— it prints the IP directly
                </Text>
                <Text className="text-white/70 text-xs leading-5 mt-2">
                  <Text className="text-[#1ed760] font-semibold">Linux:</Text>
                  {'  '}open a terminal and run{' '}
                  <Text className="text-white font-mono">ip a</Text> — look for
                  the <Text className="text-white font-mono">inet</Text> line
                  (starts with <Text className="text-[#1ed760]">192.168</Text>)
                </Text>
              </View>
              {[
                '3.  Enter http://<your-ip>:3000 above and tap Save',
              ].map((step) => (
                <View key={step} className="flex-row items-start mt-3">
                  <View className="w-1.5 h-1.5 rounded-full bg-[#1ed760] mt-2" />
                  <Text className="text-white text-[13px] ml-3 flex-1 leading-5">
                    {step}
                  </Text>
                </View>
              ))}

              {/* Same-network tip */}
              <View className="mt-4 pt-4 border-t border-white/10">
                <Text className="text-white/80 text-[13px] font-semibold">
                  ⚠️ Same network required
                </Text>
                <Text className="text-white/50 text-xs leading-5 mt-1">
                  Your PC and your phone must be connected to the{' '}
                  <Text className="text-white/80">same Wi-Fi network</Text>. The IP
                  usually looks like <Text className="text-[#1ed760]">192.168.x.x</Text> —
                  never use localhost/127.0.0.1 from the phone.
                </Text>
              </View>

              {/* Remote server tip */}
              <View className="mt-3">
                <Text className="text-white/80 text-[13px] font-semibold">
                  🖥 Prefer a remote server?
                </Text>
                <Text className="text-white/50 text-xs leading-5 mt-1">
                  You can deploy the backend on any always-on machine — a VPS,
                  home PC, or Raspberry Pi — and enter its IP or domain here.
                  Avoid{' '}
                  <Text className="text-white/80">serverless platforms like Vercel</Text>
                  {' '}— streaming needs a real running process and may not work there.
                </Text>
              </View>

              {/* Help links */}
              <TouchableOpacity
                onPress={() =>
                  Linking.openURL(
                    'https://github.com/xauravww/beatflow-native',
                  ).catch(() => {})
                }
                className="flex-row items-center mt-4 active:bg-white/5 rounded-lg"
              >
                <View className="w-9 h-9 rounded-full bg-[#282828] items-center justify-center">
                  <Icon name="logo-github" size={17} color="#ffffff" />
                </View>
                <View className="flex-1 ml-3">
                  <Text className="text-white font-semibold text-[13px]">
                    Source code & full guide
                  </Text>
                  <Text className="text-white/50 text-xs mt-0.5">
                    github.com/xauravww/beatflow-native
                  </Text>
                </View>
                <Icon
                  name="open-outline"
                  size={15}
                  color="rgba(255,255,255,0.4)"
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() =>
                  Linking.openURL(
                    'mailto:sauravmaheshwari8@gmail.com',
                  ).catch(() => {})
                }
                className="flex-row items-center mt-2 active:bg-white/5 rounded-lg"
              >
                <View className="w-9 h-9 rounded-full bg-[#282828] items-center justify-center">
                  <Icon name="mail-outline" size={17} color="#ffffff" />
                </View>
                <View className="flex-1 ml-3">
                  <Text className="text-white font-semibold text-[13px]">
                    Still having issues? Contact me
                  </Text>
                  <Text className="text-white/50 text-xs mt-0.5">
                    sauravmaheshwari8@gmail.com
                  </Text>
                </View>
                <Icon
                  name="open-outline"
                  size={15}
                  color="rgba(255,255,255,0.4)"
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() =>
                  Linking.openURL('https://discord.gg/jcaVcarRU5').catch(() => {})
                }
                className="flex-row items-center mt-2 active:bg-white/5 rounded-lg"
              >
                <View className="w-9 h-9 rounded-full bg-[#282828] items-center justify-center">
                  <Icon name="logo-discord" size={17} color="#ffffff" />
                </View>
                <View className="flex-1 ml-3">
                  <Text className="text-white font-semibold text-[13px]">
                    Join the Discord server
                  </Text>
                  <Text className="text-white/50 text-xs mt-0.5">
                    discord.gg/jcaVcarRU5
                  </Text>
                </View>
                <Icon
                  name="open-outline"
                  size={15}
                  color="rgba(255,255,255,0.4)"
                />
              </TouchableOpacity>
              <Text className="text-white/40 text-xs leading-5 mt-4">
                Full instructions live in backend/README.md. Streams need a
                non-serverless host (yt-dlp is bundled automatically).
              </Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}
