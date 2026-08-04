import {
  listUserBrowserBilibiliCapabilities,
  type UserBrowserBilibiliCapabilityDescriptor
} from './user-browser-bilibili-capabilities';
import {
  listUserBrowserXiaohongshuCapabilities,
  type UserBrowserXiaohongshuCapabilityDescriptor
} from './user-browser-xiaohongshu-capabilities';
import {
  listOfficialSourceCapabilities,
  type OfficialSourceCapabilityDescriptor
} from './user-browser-official-source-capabilities';

export type UserBrowserCapabilityDescriptor =
  | UserBrowserBilibiliCapabilityDescriptor
  | UserBrowserXiaohongshuCapabilityDescriptor
  | OfficialSourceCapabilityDescriptor;

/**
 * Public capability truth for upper applications. A catalog entry describes
 * its readiness state; it does not automatically grant a work-dispatch path.
 */
export function listUserBrowserCapabilities(): UserBrowserCapabilityDescriptor[] {
  return [
    ...listUserBrowserBilibiliCapabilities(),
    ...listUserBrowserXiaohongshuCapabilities(),
    ...listOfficialSourceCapabilities()
  ];
}
