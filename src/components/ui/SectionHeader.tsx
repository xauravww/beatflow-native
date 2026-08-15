import React from 'react';
import { Text, View } from 'react-native';

export default function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <View className="px-4 mt-7 mb-3">
      <Text className="text-white text-[21px] font-bold">{title}</Text>
      {subtitle ? (
        <Text className="text-white/50 text-sm mt-0.5">{subtitle}</Text>
      ) : null}
    </View>
  );
}
