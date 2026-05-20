import { requireNativeView } from 'expo';
import * as React from 'react';

import { AudioTrimmerViewProps } from './AudioTrimmer.types';

const NativeView: React.ComponentType<AudioTrimmerViewProps> =
  requireNativeView('AudioTrimmer');

export default function AudioTrimmerView(props: AudioTrimmerViewProps) {
  return <NativeView {...props} />;
}
