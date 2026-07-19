/**
 * MessageStrip — pocket binding of the shared MessageStrip (SC2).
 *
 * The queue-drop + min-dwell + cross-fade logic lives in
 * `@shared/display/MessageStrip`; this binds pocket's `pk-` class scheme
 * (`pk-strip` / `pk-strip__text`). Re-exports the type + timing constants so
 * existing pocket imports are unchanged.
 */
import {
  MessageStrip as SharedMessageStrip,
  type StripMessage,
} from '@shared/display/MessageStrip';

export { MIN_DWELL_MS, FADE_MS } from '@shared/display/MessageStrip';
export type { StripMessage };

export function MessageStrip({ message }: { message: StripMessage | null }) {
  return <SharedMessageStrip message={message} classPrefix="pk" />;
}

export default MessageStrip;
