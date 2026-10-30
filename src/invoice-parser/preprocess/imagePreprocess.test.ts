import test from 'node:test';
import assert from 'node:assert/strict';
import { fastAutoOrientImage } from './imagePreprocess';

test('fastAutoOrientImage skips orientation when OCR_AUTO_ORIENT is false', async () => {
  const prev = process.env.OCR_AUTO_ORIENT;
  try {
    process.env.OCR_AUTO_ORIENT = 'false';
    const result = await fastAutoOrientImage('some/path/image.png');
    assert.equal(result.angle, 0);
    assert.equal(result.imagePath, 'some/path/image.png');
  } finally {
    process.env.OCR_AUTO_ORIENT = prev;
  }
});

test('fastAutoOrientImage skips orientation on cropped invoice sections', async () => {
  const result = await fastAutoOrientImage('tmp/inv-page-1-header-ocr.png');
  assert.equal(result.angle, 0);
  assert.equal(result.imagePath, 'tmp/inv-page-1-header-ocr.png');
});
