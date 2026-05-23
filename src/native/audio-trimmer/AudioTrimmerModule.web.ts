import { registerWebModule, NativeModule } from 'expo';

import { ChangeEventPayload } from './AudioTrimmer.types';

type AudioTrimmerModuleEvents = {
  onChange: (params: ChangeEventPayload) => void;
}

class AudioTrimmerModule extends NativeModule<AudioTrimmerModuleEvents> {
  PI = Math.PI;
  async setValueAsync(value: string): Promise<void> {
    this.emit('onChange', { value });
  }
  hello() {
    return 'Hello world! 👋';
  }
};

export default registerWebModule(AudioTrimmerModule, 'AudioTrimmer');
