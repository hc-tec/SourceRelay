/**
 * Compatibility export for existing extension strategies. The canonical rule
 * itself belongs to the signed shared contract so the Gateway and extension
 * cannot drift into accepting different inventory destinations.
 */
export {
  canonicalBilibiliAccountVideoInventoryUrl,
  type BilibiliAccountVideoInventoryUrlMode
} from '@intelligence/collector-contracts';
