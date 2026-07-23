import { describe, expect, test } from 'vitest';
import {
  deduplicateBilibiliDanmakuRows,
  projectBilibiliDanmakuDom
} from '../src/shared/bilibili-danmaku-capture';

const base = {
  schemaVersion: 1,
  bvid: 'BV1qZSLBYEpa',
  playerVisible: true,
  danmakuOverlayVisible: true,
  danmakuEnabled: true,
  overlayItems: [{ text: '公开弹幕', top: 4, color: '#ffffff', fontSize: 17.7 }],
  listControlVisible: true,
  listOpen: true,
  listRows: [
    { index: 0, time: '00:01', content: '第一条', sentAt: '07-23 12:00' },
    { index: 1, time: '00:03', content: '第二条', sentAt: '07-23 12:01' }
  ],
  listTotalEstimate: 199,
  listOffset: 720,
  listContainerVisible: true,
  loginGateVisible: true,
  risk: { verificationRequired: false, rateLimited: false, sourceUnavailable: false }
} as const;

describe('Bilibili danmaku DOM projection', () => {
  test('keeps the public list shape and virtual-list metadata', () => {
    expect(projectBilibiliDanmakuDom(base)).toEqual(base);
  });

  test('drops malformed rows and caps unsafe overlay values', () => {
    const result = projectBilibiliDanmakuDom({
      ...base,
      overlayItems: [
        { text: 'ok', top: 2, color: '#fff', fontSize: 18 },
        { text: '', top: 1, color: '#fff', fontSize: 18 },
        { text: 'bad-color', top: 1, color: 'rgb(0,0,0)', fontSize: 18 }
      ],
      listRows: [
        ...base.listRows,
        { index: -1, time: '00:04', content: 'bad', sentAt: '07-23 12:02' },
        { index: 2, time: '', content: 'missing time', sentAt: '07-23 12:03' }
      ]
    });
    expect(result?.overlayItems).toEqual([
      { text: 'ok', top: 2, color: '#fff', fontSize: 18 },
      { text: 'bad-color', top: 1, color: null, fontSize: 18 }
    ]);
    expect(result?.listRows).toHaveLength(2);
  });

  test('deduplicates virtual-list rows by stable data-index', () => {
    expect(deduplicateBilibiliDanmakuRows([
      base.listRows[0],
      base.listRows[1],
      { ...base.listRows[0], content: 'same index after scroll' }
    ])).toEqual(base.listRows);
  });

  test('rejects a payload with the wrong schema', () => {
    expect(projectBilibiliDanmakuDom({ ...base, schemaVersion: 2 })).toBeNull();
  });
});
