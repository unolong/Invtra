import type { DishComponent } from '@/services/anthropic';

export type PendingVoiceResult = {
  dishName: string;
  components: DishComponent[];
};

let _pending: PendingVoiceResult | null = null;

export const voiceResult = {
  set(r: PendingVoiceResult) { _pending = r; },
  consume(): PendingVoiceResult | null {
    const r = _pending;
    _pending = null;
    return r;
  },
};
