import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';

export default function Skeleton({ className }: { className?: string }) {
  const opacity = useRef(new Animated.Value(0.45)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 1,
          duration: 650,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 0.45,
          duration: 650,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity]);

  return (
    <Animated.View
      className={`bg-[#282828] rounded-md ${className ?? ''}`}
      style={{ opacity }}
    />
  );
}
