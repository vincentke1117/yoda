import { afterEach, describe, expect, it } from 'vitest';
import {
  DREAM_SKIN_CSS_DATA_URL_MAX_CHARS,
  dreamSkinBackgroundImage,
  releaseAllDreamSkinAssets,
  releaseDreamSkinAsset,
  resolveDreamSkinAsset,
} from '@renderer/lib/providers/dream-skin-assets';

function createOversizedImageDataUrl(): string {
  const prefix = 'data:image/png;base64,';
  const minimumPayloadLength = DREAM_SKIN_CSS_DATA_URL_MAX_CHARS - prefix.length + 1;
  const base64Length = Math.ceil(minimumPayloadLength / 4) * 4;
  return `${prefix}${'A'.repeat(base64Length)}`;
}

afterEach(() => {
  document.documentElement.style.removeProperty('--dream-skin-test-art');
  releaseAllDreamSkinAssets();
});

describe('Dream Skin image assets', () => {
  it('keeps compact image data URLs inline', () => {
    const image = 'data:image/png;base64,aA==';

    expect(resolveDreamSkinAsset(image)).toBe(image);
  });

  it('uses a cached Blob URL when an image exceeds Chromium CSS limits', () => {
    const image = createOversizedImageDataUrl();
    const firstUrl = resolveDreamSkinAsset(image);
    const secondUrl = resolveDreamSkinAsset(image);
    const backgroundImage = dreamSkinBackgroundImage(image);

    expect(firstUrl).toMatch(/^blob:/);
    expect(secondUrl).toBe(firstUrl);
    expect(backgroundImage).toContain(firstUrl);

    const root = document.documentElement;
    root.style.setProperty('--dream-skin-test-art', backgroundImage);
    expect(root.style.getPropertyValue('--dream-skin-test-art')).toContain(firstUrl);
  });

  it('revokes an image Blob URL so a future render creates a fresh one', () => {
    const image = createOversizedImageDataUrl();
    const firstUrl = resolveDreamSkinAsset(image);

    releaseDreamSkinAsset(image);

    expect(resolveDreamSkinAsset(image)).toMatch(/^blob:/);
    expect(resolveDreamSkinAsset(image)).not.toBe(firstUrl);
  });
});
