declare module 'use-double-click' {
  import type { RefObject } from 'react';

  interface UseDoubleClickOptions {
    onSingleClick?: (e: MouseEvent) => void;
    onDoubleClick?: (e: MouseEvent) => void;
    ref: RefObject<HTMLElement | null>;
    latency?: number;
  }

  const useDoubleClick: (options: UseDoubleClickOptions) => void;
  export default useDoubleClick;
}
