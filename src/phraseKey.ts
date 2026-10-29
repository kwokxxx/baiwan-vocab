// Match spelling variants only; different tenses and different wording stay distinct.
const contractions: Record<string, string> = {
  "i'm": "i am",
  "you're": "you are",
  "we're": "we are",
  "they're": "they are",
  "don't": "do not",
  "can't": "cannot",
  "won't": "will not",
  "isn't": "is not",
  "aren't": "are not",
  "wasn't": "was not",
  "weren't": "were not",
  "didn't": "did not",
  "doesn't": "does not",
  "haven't": "have not",
  "hasn't": "has not",
  "hadn't": "had not",
  "shouldn't": "should not",
  "couldn't": "could not",
  "wouldn't": "would not",
  "mustn't": "must not",
};

export function phraseKey(term: string) {
  return term
    .normalize("NFKC")
    .toLowerCase()
    .trim()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐‑–—]/g, "-")
    .replace(/-/g, " ")
    .replace(/["“”]/g, "")
    .replace(/[,，]/g, " ")
    .replace(/\b[\w]+'[\w]+\b/g, (word) => contractions[word] ?? word)
    .replace(/\b(\w+)'ve\b/g, "$1 have")
    .replace(/\b(\w+)'ll\b/g, "$1 will")
    .replace(/\b(it|that|what|who|where|how|when|there|here)'s\b/g, "$1 is")
    .replace(/\bcan not\b/g, "cannot")
    .replace(/[.!?。！？]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
