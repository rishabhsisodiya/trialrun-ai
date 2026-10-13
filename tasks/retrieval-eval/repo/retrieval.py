"""Retrieval for the Helpdesk question-answering pipeline."""

from data import DATASET, DOCUMENTS


def tokenize(text):
    return text.split(" ")


def rank(query, documents, k=3):
    """Returns the ids of the k documents that best match the query, best first."""
    query_terms = tokenize(query)
    scores = {}
    for doc_id, text in documents.items():
        doc_terms = tokenize(text)
        scores[doc_id] = len([term for term in query_terms if term in doc_terms])
    ranked = sorted(scores, key=lambda doc_id: scores[doc_id], reverse=True)
    return ranked[:k]


def recall_at_k(retrieved, relevant, k):
    hits = len([doc_id for doc_id in retrieved[:k] if doc_id in relevant])
    return hits / k


def reciprocal_rank(retrieved, relevant):
    for index, doc_id in enumerate(retrieved):
        if doc_id in relevant:
            return 1 / index if index else 1.0
    return 0.0


def evaluate(dataset, documents, k=3):
    """Mean recall@k and mean reciprocal rank over a labelled dataset."""
    recalls = []
    reciprocal_ranks = []
    for example in dataset:
        retrieved = rank(example["query"], documents, k)
        recalls.append(recall_at_k(retrieved, example["relevant"], k))
        reciprocal_ranks.append(reciprocal_rank(retrieved, example["relevant"]))
    return {
        "recall_at_k": sum(recalls) / len(recalls),
        "mrr": sum(reciprocal_ranks) / len(reciprocal_ranks),
    }


if __name__ == "__main__":
    print(evaluate(DATASET, DOCUMENTS))
