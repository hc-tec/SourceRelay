// The projector must extract per-note media references (imageUrls/videoUrls)
// from REAL Xiaohongshu network payload shapes — snake_case envelopes as
// served by the web search/homefeed/feed endpoints (field-verified against
// the working Go/XHS integrations: cover.{url,url_default,info_list[].url},
// image_list[].url_default, video.media.stream.h264[].master_url).

import { describe, expect, test } from 'vitest';
import {
  createXiaohongshuSearchPayloadProjector
} from '../src/content/xiaohongshu-search-payload-projector';

const clean = (value: unknown, maximum: number): string =>
  (typeof value === 'string' || typeof value === 'number' ? String(value) : '')
    .replace(/\s+/g, ' ').trim().slice(0, maximum);
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const jsonObject = (): Record<string, unknown> | null => null;

const projector = createXiaohongshuSearchPayloadProjector({
  clean, object, jsonObject, maximumItems: 200, maximumComments: 80
});

// Realistic snake_case search/homefeed payload: one video note (streams in
// the payload) and one image note (image_list with url_default variants).
const SEARCH_PAYLOAD = {
  data: {
    items: [
      {
        id: 'video-note-1',
        model_type: 'note',
        note_card: {
          type: 'video',
          display_title: '咖啡拉花视频教程',
          user: { user_id: 'u1', nick_name: '作者一', avatar: 'https://sns-avatar-qc.xhscdn.com/avatar/1.jpg' },
          interact_info: { liked_count: '1.2万' },
          cover: {
            url: 'https://sns-webpic-qc.xhscdn.com/202609/video_cover.jpg',
            url_default: 'https://sns-webpic-qc.xhscdn.com/202609/video_cover_default.jpg',
            info_list: [{ image_scene: 'WB_PRV', url: 'https://sns-webpic-qc.xhscdn.com/202609/video_cover_prv.jpg' }],
          },
          video: { capa: { duration: 96 } },
        },
      },
      {
        id: 'image-note-1',
        model_type: 'note',
        note_card: {
          type: 'normal',
          display_title: '拉花图文笔记',
          user: { user_id: 'u2', nick_name: '作者二' },
          interact_info: { liked_count: '3021' },
          cover: { url: 'https://sns-webpic-qc.xhscdn.com/202609/img_cover.jpg' },
          image_list: [
            { url_default: 'https://sns-webpic-qc.xhscdn.com/202609/img_a.jpg', url_pre: 'https://sns-webpic-qc.xhscdn.com/202609/img_a_pre.jpg' },
            { url_default: 'https://sns-webpic-qc.xhscdn.com/202609/img_b.jpg' },
          ],
        },
      },
    ],
  },
};

// Feed/detail payload: full note body with desc and media lists.
const FEED_PAYLOAD = {
  data: {
    items: [
      {
        id: 'video-note-1',
        note_card: {
          type: 'video',
          display_title: '咖啡拉花视频教程',
          desc: '手把手教你打奶泡和拉花。',
          user: { user_id: 'u1', nick_name: '作者一' },
          image_list: [],
          video: {
            media: {
              stream: {
                h264: [{ master_url: 'https://sns-video-v.xhscdn.com/202609/latte_art.mp4' }],
              },
            },
          },
        },
      },
    ],
  },
};

describe('xiaohongshu payload projector: media references from network payloads', () => {
  test('projects note items from the real card envelope', () => {
    const result = projector(SEARCH_PAYLOAD);
    expect(result.items.map((item) => item.noteId)).toEqual(['video-note-1', 'image-note-1']);
    const first = result.items[0]!;
    expect(first.title).toBe('咖啡拉花视频教程');
    expect(first.likedCountText).toBe('1.2万');
  });

  test('collects cover and image_list references per note', () => {
    const result = projector(SEARCH_PAYLOAD);
    const imageNote = result.media['image-note-1']!;
    expect(imageNote.imageUrls).toContain('https://sns-webpic-qc.xhscdn.com/202609/img_cover.jpg');
    expect(imageNote.imageUrls).toContain('https://sns-webpic-qc.xhscdn.com/202609/img_a.jpg');
    expect(imageNote.imageUrls).toContain('https://sns-webpic-qc.xhscdn.com/202609/img_b.jpg');
  });

  test('search payloads carry no video streams; covers still exist for video notes', () => {
    const result = projector(SEARCH_PAYLOAD);
    const videoNote = result.media['video-note-1']!;
    expect(videoNote.imageUrls.length).toBeGreaterThan(0);
    expect(videoNote.videoUrls ?? []).toEqual([]);
  });

  test('feed payloads yield master_url video sources', () => {
    const result = projector(FEED_PAYLOAD);
    const feedVideoNote = result.media['video-note-1']!;
    expect(feedVideoNote.videoUrls)
      .toContain('https://sns-video-v.xhscdn.com/202609/latte_art.mp4');
  });

  test('feed details carry text plus their media references', () => {
    const result = projector(FEED_PAYLOAD);
    const detail = result.details.find((entry) => entry.noteId === 'video-note-1');
    expect(detail).toBeDefined();
    expect(detail!.publicText).toContain('手把手教你打奶泡和拉花。');
    expect(detail!.videoUrls).toContain('https://sns-video-v.xhscdn.com/202609/latte_art.mp4');
  });

  test('never classifies avatars as note media', () => {
    const result = projector(SEARCH_PAYLOAD);
    for (const media of Object.values(result.media)) {
      for (const url of media.imageUrls) {
        expect(url.includes('sns-avatar')).toBe(false);
      }
    }
  });
});
