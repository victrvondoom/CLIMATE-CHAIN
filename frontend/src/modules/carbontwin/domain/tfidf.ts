// TF-IDF over character n-grams and cosine similarity, as pipeline/screen.py computes
// name_sim with scikit-learn: TfidfVectorizer(analyzer="char_wb", ngram_range=(3, 4)) with
// its defaults (lowercase, smooth idf, idf = ln((1+N)/(1+df)) + 1, l2-normalised rows).

// sklearn's _char_wb_ngrams: each whitespace-separated word is padded with one space on
// each side, and n-grams are taken inside the padded word.
export function charWbNgrams(text: string, minN = 3, maxN = 4): string[] {
  const grams: string[] = [];
  const words = text.toLowerCase().replace(/\s\s+/g, ' ').split(/\s+/).filter(Boolean);
  for (const word of words) {
    const padded = ` ${word} `;
    for (let n = minN; n <= maxN; n++) {
      let offset = 0;
      grams.push(padded.slice(offset, offset + n));
      while (offset + n < padded.length) {
        offset += 1;
        grams.push(padded.slice(offset, offset + n));
      }
      if (offset === 0) break; // a short word is counted once
    }
  }
  return grams;
}

type SparseVector = Map<string, number>;

function dot(a: SparseVector, b: SparseVector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let sum = 0;
  for (const [term, weight] of small) sum += weight * (large.get(term) ?? 0);
  return sum;
}

// Full cosine matrix over the documents. An empty document has a zero vector, so its
// similarity to anything is 0, as in scikit-learn.
export function tfidfCosine(docs: readonly string[]): number[][] {
  const grams = docs.map((doc) => charWbNgrams(doc));
  const docFreq = new Map<string, number>();
  for (const g of grams) {
    for (const term of new Set(g)) docFreq.set(term, (docFreq.get(term) ?? 0) + 1);
  }
  const n = docs.length;
  const vectors: SparseVector[] = grams.map((g) => {
    const counts = new Map<string, number>();
    for (const term of g) counts.set(term, (counts.get(term) ?? 0) + 1);
    const weights: SparseVector = new Map();
    let norm = 0;
    for (const [term, count] of counts) {
      const idf = Math.log((1 + n) / (1 + (docFreq.get(term) ?? 0))) + 1;
      const w = count * idf;
      weights.set(term, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm);
    if (norm > 0) for (const [term, w] of weights) weights.set(term, w / norm);
    return weights;
  });
  return vectors.map((a) => vectors.map((b) => dot(a, b)));
}
