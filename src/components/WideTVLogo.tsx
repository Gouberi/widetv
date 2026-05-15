import React from 'react';
import Svg, { Rect, Circle, Line, Text, Defs, LinearGradient, Stop } from 'react-native-svg';

interface Props { size?: number; }

export default function WideTVLogo({ size = 80 }: Props) {
  const scale = size / 90;
  const w = 120 * scale;
  const h = 90 * scale;
  return (
    <Svg width={w} height={h} viewBox="0 0 120 90">
      <Defs>
        <LinearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
          <Stop offset="0%" stopColor="#1565D4" />
          <Stop offset="100%" stopColor="#00C8E8" />
        </LinearGradient>
      </Defs>
      <Rect x="4" y="16" width="112" height="74" rx="12" fill="url(#grad)" opacity={0.15} />
      <Rect x="4" y="16" width="112" height="74" rx="12" stroke="url(#grad)" strokeWidth="3" fill="none" />
      <Circle cx="48" cy="10" r="5" fill="url(#grad)" />
      <Circle cx="72" cy="10" r="5" fill="url(#grad)" />
      <Line x1="48" y1="10" x2="60" y2="16" stroke="url(#grad)" strokeWidth="2.5" />
      <Line x1="72" y1="10" x2="60" y2="16" stroke="url(#grad)" strokeWidth="2.5" />
      <Text x="60" y="68" textAnchor="middle" fontFamily="Inter" fontWeight="900" fontSize="44" fill="url(#grad)">w</Text>
    </Svg>
  );
}
