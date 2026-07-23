import { describe, expect, test } from 'vitest';
import {
  isBilibiliNativeSearchBlockingLoginElement,
  isBilibiliNativeSearchEmptyStateElement
} from '../src/background/strategies/bilibili-native-search-dom-projection.js';

describe('Bilibili native-search DOM state classifiers', () => {
  test('recognizes the real no-data container used by the video search page', () => {
    expect(isBilibiliNativeSearchEmptyStateElement('search-nodata-container p_relative', 'empty copy', true))
      .toBe(true);
    expect(isBilibiliNativeSearchEmptyStateElement('no-data p_center text_center', 'empty copy', true))
      .toBe(true);
    expect(isBilibiliNativeSearchEmptyStateElement('search-content', 'empty copy', true))
      .toBe(false);
    expect(isBilibiliNativeSearchEmptyStateElement('no-data', '', true)).toBe(false);
    expect(isBilibiliNativeSearchEmptyStateElement('no-data', 'empty copy', false)).toBe(false);
  });

  test('does not classify the anonymous header login tooltip as a blocking modal', () => {
    expect(isBilibiliNativeSearchBlockingLoginElement({
      className: 'login-panel-popover',
      role: null,
      ariaModal: null,
      visible: true,
      width: 359,
      height: 235
    })).toBe(false);
    expect(isBilibiliNativeSearchBlockingLoginElement({
      className: 'bili-mini-mask',
      role: null,
      ariaModal: null,
      visible: true,
      width: 1280,
      height: 720
    })).toBe(true);
    expect(isBilibiliNativeSearchBlockingLoginElement({
      className: 'modal',
      role: 'dialog',
      ariaModal: 'true',
      visible: true,
      width: 400,
      height: 300
    })).toBe(true);
  });
});
