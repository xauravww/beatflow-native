import React, { useEffect, useRef, useState } from 'react';
import { Animated, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { usePlayer } from '../../context/PlayerContext';

/** Transient status banner (e.g. "Stream unavailable — skipping"). */
export default function Toast() {
  const insets = useSafeAreaInsets();
  const { toast } = usePlayer();
  const opacity = useRef(new Animated.Value(0)).current;
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!toast) {
      return;
    }
    opacity.setValue(0);
    setVisible(true);
    Animated.sequence([
      Animated.timing(opacity, {
        toValue: 1,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.delay(2300),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(({ finished }) => {
      if (finished) {
        setVisible(false);
      }
    });
  }, [toast, opacity]);

  if (!visible) {
    return null;
  }

  return (
    <View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: insets.top + 8,
        left: 0,
        right: 0,
        alignItems: 'center',
        zIndex: 1000,
      }}
    >
      <Animated.View
        style={{ opacity }}
        className="bg-[#2a2a2a] border border-white/10 rounded-full px-4 py-2.5 flex-row items-center max-w-[92%]"
      >
        <Icon name="alert-circle-outline" size={18} color="#1ed760" />
        <Text className="text-white text-[13px] font-medium ml-2 flex-1">
          {toast}
        </Text>
      </Animated.View>
    </View>
  );
}
