import * as React from 'react';

import { AudioTrimmerViewProps } from './AudioTrimmer.types';

export default function AudioTrimmerView(props: AudioTrimmerViewProps) {
  return (
    <div>
      <iframe
        style={{ flex: 1 }}
        src={props.url}
        onLoad={() => props.onLoad({ nativeEvent: { url: props.url } })}
      />
    </div>
  );
}
