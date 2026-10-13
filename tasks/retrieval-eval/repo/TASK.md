# Task: fix the retrieval pipeline and its evaluation

Helpdesk answers customer questions with retrieval-augmented generation. Before the
language model sees a question, `retrieval.py` picks the most relevant help articles.
The team reports that answers are often built on the wrong articles, yet the eval
dashboard says retrieval is fine. Nobody trusts the numbers any more.

You have about 40 minutes. Use your coding agent however you normally would.

## What to do

1. **Make the evaluation correct.** In `retrieval.py`:
   - `recall_at_k(retrieved, relevant, k)` is the share of the relevant documents
     that appear in the first `k` retrieved. A query with no relevant documents
     scores `0.0`.
   - `reciprocal_rank(retrieved, relevant)` is `1 / rank` of the first relevant
     document, where the first position has rank 1, and `0.0` if none is retrieved.
2. **Make tokenisation sane.** `tokenize` should lowercase and split on anything
   that is not a letter or a digit, so `"Refund?"` and `"refund"` match.
3. **Replace the scoring with BM25.** `rank(query, documents, k)` returns the ids of
   the top `k` documents, best first. For each query term `t` in document `d`:

       idf(t)   = ln(1 + (N - n_t + 0.5) / (n_t + 0.5))
       score    = idf(t) * f * (k1 + 1) / (f + k1 * (1 - b + b * len(d) / avg_len))

   where `N` is the number of documents, `n_t` the number containing `t`, `f` how
   often `t` occurs in `d`, `len(d)` the number of tokens in `d`, `avg_len` the
   average over all documents, `k1 = 1.5` and `b = 0.75`. A document's score is the
   sum over the distinct query terms. Documents with equal scores are ordered by id.
   Documents scoring zero are not returned.
4. `evaluate(dataset, documents, k)` keeps returning mean recall@k and mean
   reciprocal rank over the queries.

## Ground rules

- Standard library only.
- `python3 -m unittest discover -s tests` must pass. Some tests fail today; they
  cover part of the list above, not all of it.
- `data.py` holds a small corpus and labelled queries to try things on:
  `python3 retrieval.py` prints the current scores.
