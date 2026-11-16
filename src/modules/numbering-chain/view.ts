import { readMaskProgress } from "@/modules/numbering-catalog/decorate";
import { chainSlot } from "@/modules/numbering-chain/gate";
import { buildChainView, type ChainView } from "@/modules/numbering-chain/text";

export type { ChainView };

export function getChainView(): ChainView {
  const slot = chainSlot();
  return buildChainView({
    running: slot.running,
    index: slot.index,
    mode: slot.mode,
    progress: readMaskProgress(),
  });
}
