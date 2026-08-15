import React, { useRef } from 'react';
import { Animated, Pressable, StyleProp, ViewStyle } from 'react-native';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = Omit<React.ComponentProps<typeof Pressable>, 'style'> & {
  /** How far the element scales down while pressed. Default 0.9. */
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
};

/**
 * A Pressable that springs down while pressed and bounces back on release —
 * the tactile micro-interaction Spotify uses on its player controls.
 */
export default function PressableScale({
  scaleTo = 0.9,
  children,
  onPressIn,
  onPressOut,
  style,
  ...rest
}: Props) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = (e: any) => {
    Animated.spring(scale, {
      toValue: scaleTo,
      useNativeDriver: true,
      speed: 50,
      bounciness: 0,
    }).start();
    onPressIn?.(e);
  };

  const handlePressOut = (e: any) => {
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 30,
      bounciness: 10,
    }).start();
    onPressOut?.(e);
  };

  return (
    <AnimatedPressable
      {...rest}
      style={[style, { transform: [{ scale }] }]}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
    >
      {children}
    </AnimatedPressable>
  );
}
