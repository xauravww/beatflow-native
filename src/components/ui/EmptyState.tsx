import React from 'react';
import { Text, View } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

export default function EmptyState({
  icon,
  message,
}: {
  icon: string;
  message: string;
}) {
  return (
    <View className="items-center justify-center py-20 px-10">
      <Icon name={icon} size={48} color="rgba(255,255,255,0.25)" />
      <Text className="text-white/50 text-center mt-4 text-sm leading-5">
        {message}
      </Text>
    </View>
  );
}
