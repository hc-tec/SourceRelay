import { describe, expect, test } from 'vitest';
import { matchesBilibiliVideoDiscussionPageIdentity } from '../src/page-ledger/bilibili-video-discussion-page-identity';

const bvid = 'BV1qZSLBYEpa';
const vdSource = '6b3d0e6973059f202bf441d103fce535';

describe('Bilibili discussion page identity aliases', () => {
  test('accepts the same BVID with observed Bilibili player URL variants', () => {
    expect(matchesBilibiliVideoDiscussionPageIdentity(`https://www.bilibili.com/video/${bvid}`, bvid)).toBe(true);
    expect(matchesBilibiliVideoDiscussionPageIdentity(`https://www.bilibili.com/video/${bvid}/`, bvid)).toBe(true);
    expect(matchesBilibiliVideoDiscussionPageIdentity(
      `https://www.bilibili.com/video/${bvid}/?vd_source=${vdSource}`,
      bvid
    )).toBe(true);
    expect(matchesBilibiliVideoDiscussionPageIdentity(
      `https://www.bilibili.com/video/${bvid}?vd_source=${vdSource}&spm_id_from=333.788.player.switch&p=4`,
      bvid
    )).toBe(true);
    expect(matchesBilibiliVideoDiscussionPageIdentity(
      `https://www.bilibili.com/video/${bvid}?p=2`,
      bvid
    )).toBe(true);
  });

  test('rejects a different BVID, unknown query, invalid part, hash, or host', () => {
    expect(matchesBilibiliVideoDiscussionPageIdentity(
      'https://www.bilibili.com/video/BV1BoKD6ZEir',
      bvid
    )).toBe(false);
    expect(matchesBilibiliVideoDiscussionPageIdentity(
      `https://www.bilibili.com/video/${bvid}?redirect=https%3A%2F%2Fevil.invalid`,
      bvid
    )).toBe(false);
    expect(matchesBilibiliVideoDiscussionPageIdentity(
      `https://www.bilibili.com/video/${bvid}?p=0`,
      bvid
    )).toBe(false);
    expect(matchesBilibiliVideoDiscussionPageIdentity(
      `https://www.bilibili.com/video/${bvid}?p=2&p=3`,
      bvid
    )).toBe(false);
    expect(matchesBilibiliVideoDiscussionPageIdentity(
      `https://www.bilibili.com/video/${bvid}#comments`,
      bvid
    )).toBe(false);
    expect(matchesBilibiliVideoDiscussionPageIdentity(
      `https://bilibili.com/video/${bvid}`,
      bvid
    )).toBe(false);
  });
});
