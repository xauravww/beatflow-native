import React from 'react';
import { Text, TouchableOpacity, View } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';

export type Tab = 'home' | 'search' | 'library';

const TABS: { key: Tab; label: string; icon: string; iconOutline: string }[] = [
  { key: 'home', label: 'Home', icon: 'home', iconOutline: 'home-outline' },
  {
    key: 'search',
    label: 'Search',
    icon: 'search',
    iconOutline: 'search-outline',
  },
  {
    key: 'library',
    label: 'Library',
    icon: 'library',
    iconOutline: 'library-outline',
  },
];

export default function BottomNav({
  active,
  onChange,
}: {
  active: Tab;
  onChange: (tab: Tab) => void;
}) {
  return (
    <View className="bg-black border-t border-white/10 flex-row pt-2 pb-1">
      {TABS.map((tab) => {
        const isActive = active === tab.key;
        return (
          <TouchableOpacity
            key={tab.key}
            onPress={() => onChange(tab.key)}
            className="flex-1 items-center py-1"
          >
            <Icon
              name={isActive ? tab.icon : tab.iconOutline}
              size={24}
              color={isActive ? '#ffffff' : 'rgba(255,255,255,0.6)'}
            />
            <Text
              className={`text-[11px] mt-0.5 font-semibold ${
                isActive ? 'text-white' : 'text-white/60'
              }`}
            >
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}
