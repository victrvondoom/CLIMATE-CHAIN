import { describe, expect, it } from 'vitest';
import { charWbNgrams, tfidfCosine } from './tfidf';

// Reference from scikit-learn 1.9.1: TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 4)),
// then cosine_similarity, over these cleaned names. Same settings as pipeline/screen.py.
const DOCS = ['azure solar', 'azure india solar', 'mato grosso reserve', 'mato grosso reserve 2', ''];
const SIM = [
  [1.0, 0.7520395333159554, 0.0, 0.0, 0.0],
  [0.7520395333159554, 1.0, 0.0, 0.0, 0.0],
  [0.0, 0.0, 1.0, 0.9761055662505059, 0.0],
  [0.0, 0.0, 0.9761055662505059, 1.0, 0.0],
  [0.0, 0.0, 0.0, 0.0, 0.0],
];

describe('char_wb n-grams (the analyzer screen.py uses)', () => {
  it('pads each word with a space and takes 3- and 4-grams inside it', () => {
    expect(charWbNgrams('ab cde')).toEqual([' ab', 'ab ', ' ab ', ' cd', 'cde', 'de ', ' cde', 'cde ']);
  });
});

describe('TF-IDF cosine similarity', () => {
  it('matches the scikit-learn cosine matrix for the reference names', () => {
    const sim = tfidfCosine(DOCS);
    for (let i = 0; i < DOCS.length; i++) {
      for (let j = 0; j < DOCS.length; j++) {
        expect(sim[i][j], `[${i}][${j}]`).toBeCloseTo(SIM[i][j], 12);
      }
    }
  });

  it('scores identical names as 1', () => {
    expect(tfidfCosine(['wind karnataka', 'wind karnataka'])[0][1]).toBeCloseTo(1, 12);
  });
});
